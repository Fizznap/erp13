const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { ragLimiter } = require('../middleware/rateLimit');
const { embedQuery, vectorSearch } = require('../services/rag');
const { generateAnswer } = require('../services/llmAdapter');

const router = express.Router();

// POST /api/ask — RAG query endpoint
router.post('/', authenticate, authorize('student', 'faculty'), ragLimiter, async (req, res) => {
  try {
    const startTime = Date.now();
    const { query, subjectId } = req.body;

    if (!query || !subjectId) {
      return res.status(400).json({ error: 'Query and subjectId are required' });
    }

    if (query.length > 1000) {
      return res.status(400).json({ error: 'Query is too long (max 1000 characters)' });
    }

    // Verify subject exists and user has access, also fetch subject name
    let subjectName = 'the subject';
    let userScope = { role: req.user.role };

    if (req.user.role === 'student') {
      const userRec = await pool.query('SELECT academic_class_id FROM users WHERE id = $1', [req.user.id]);
      userScope.academicClassId = userRec.rows[0]?.academic_class_id;
      
      if (!userScope.academicClassId) {
        return res.status(403).json({ error: 'You are not assigned to an academic class' });
      }

      const offering = await pool.query(
        `SELECT s.name FROM subject_offerings so 
         JOIN subjects s ON so.subject_id = s.id 
         WHERE so.academic_class_id = $1 AND so.subject_id = $2`,
        [userScope.academicClassId, subjectId]
      );
      if (offering.rows.length === 0) {
        return res.status(403).json({ error: 'You are not enrolled in this subject' });
      }
      subjectName = offering.rows[0].name;
    } else {
      userScope.facultyId = req.user.id;
      const subj = await pool.query('SELECT name FROM subjects WHERE id = $1', [subjectId]);
      if (subj.rows.length > 0) subjectName = subj.rows[0].name;
    }

    // Check that subject has ready resources
    const resourceCheck = await pool.query(
      "SELECT COUNT(*) AS cnt FROM resources WHERE subject_id = $1 AND status = 'ready'",
      [subjectId]
    );
    if (parseInt(resourceCheck.rows[0].cnt) === 0) {
      return res.status(400).json({ error: 'No processed resources available for this subject' });
    }

    // Step 1: Embed the query
    const queryEmbedding = await embedQuery(query);

    // Step 2: Vector search with strict authorization scope
    const threshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.55;
    const topK = parseInt(process.env.TOP_K_CHUNKS) || 5;
    const chunks = await vectorSearch(queryEmbedding, subjectId, userScope, topK);

    // Calculate top scores
    const topKScores = chunks.map(c => c.similarity);
    const avgScore = topKScores.length > 0 ? topKScores.reduce((a, b) => a + b, 0) / topKScores.length : 0;
    const topScore = topKScores[0] || 0;
    
    // Hash query for audit log
    const promptHash = crypto.createHash('sha256').update(query).digest('hex');

    // Step 3: Relevance check
    if (chunks.length === 0 || topScore < threshold || (avgScore < threshold && chunks.length > 0)) {
      const latencyMs = Date.now() - startTime;
      const notFoundStr = 'Not in provided material.';

      // Log the query
      await pool.query(
        `INSERT INTO ai_audit_logs (user_id, subject_id, query, answer, chunks_used, chunk_ids, model_used, provider, response_time_ms, was_found, similarity_score, top_k_scores, prompt_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $12)`,
        [
          req.user.id, subjectId, query,
          notFoundStr,
          JSON.stringify([]),
          [],
          'none',
          'google',
          latencyMs,
          topScore,
          topKScores,
          promptHash
        ]
      );
      
      console.log(`[RAG Metrics] query.count=1, query.was_found_rate=0.0, avg_similarity=${topScore.toFixed(2)}, llm.calls=0, token_usage=0`);

      return res.json({
        answer: notFoundStr,
        wasFound: false,
        sources: [],
        latencyMs,
      });
    }

    // Step 4: Generate answer from chunks
    const numberedContext = chunks.map((c, idx) => ({
      n: idx + 1,
      label: `${c.original_name} | page ${c.page_number} | chunk ${c.chunk_index}`,
      text: c.content
    }));
    
    const llmResp = await generateAnswer({ 
      question: query, 
      numberedContext, 
      temperature: 0.2,
      systemPrompt: `You are a helpful, conversational teaching assistant for the subject "${subjectName}". Provide a comprehensive, detailed, and well-structured explanation based ONLY on the numbered chunks in the context provided. Use markdown for better readability. If the answer cannot be found in the context at all, return EXACTLY: "Not in provided material." ALWAYS include citations like [1] inline.` 
    });
    const result = {
      answer: llmResp.answer || 'Not in provided material.',
      model: llmResp.model,
      tokensIn: llmResp.tokensIn,
      tokensOut: llmResp.tokensOut,
    };

    const latencyMs = Date.now() - startTime;
    const notFoundExact = 'Not in provided material.';
    const wasFound = result.answer !== notFoundExact;

    // Build sources with rich metadata
    const sources = chunks.map((c) => ({
      resourceId: c.resource_id,
      resource_name: c.resource_name || c.original_name,
      filename: c.original_name,
      chunkIndex: c.chunk_index,
      pageNumber: c.page_number,
      similarity: parseFloat(c.similarity.toFixed(4)),
      excerpt: c.content.substring(0, 200) + '...',
    }));
    const chunkIds = chunks.map(c => c.id);

    // Log the query
    await pool.query(
      `INSERT INTO ai_audit_logs (user_id, subject_id, query, answer, chunks_used, chunk_ids, model_used, provider, tokens_in, tokens_out, response_time_ms, was_found, similarity_score, top_k_scores, prompt_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        req.user.id, subjectId, query, result.answer,
        JSON.stringify(sources.map(s => ({ resourceId: s.resourceId, chunkIndex: s.chunkIndex, similarity: s.similarity }))),
        chunkIds,
        result.model || 'gemini-2.0-flash',
        'google',
        result.tokensIn || 0,
        result.tokensOut || 0,
        latencyMs,
        wasFound,
        topScore,
        topKScores,
        promptHash
      ]
    );
    
    // Metrics alert logging
    const tokens = (result.tokensIn || 0) + (result.tokensOut || 0);
    console.log(`[RAG Metrics] query.count=1, query.was_found_rate=${wasFound ? 1.0 : 0.0}, avg_similarity=${topScore.toFixed(2)}, llm.calls=1, token_usage=${tokens}`);

    res.json({
      answer: result.answer,
      wasFound,
      sources: wasFound ? sources : [],
      latencyMs,
    });
  } catch (err) {
    console.error('Ask error:', err);
    res.status(500).json({ error: 'Failed to process query' });
  }
});

// GET /api/ask/history?subjectId=X — query history
router.get('/history', authenticate, async (req, res) => {
  try {
    const { subjectId } = req.query;
    const result = await pool.query(
      `SELECT id, query, answer, was_found, response_time_ms as latency_ms, created_at
       FROM ai_audit_logs
       WHERE user_id = $1 ${subjectId ? 'AND subject_id = $2' : ''}
       ORDER BY created_at DESC
       LIMIT 50`,
      subjectId ? [req.user.id, subjectId] : [req.user.id]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

module.exports = router;
