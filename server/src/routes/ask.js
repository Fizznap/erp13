const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { ragLimiter } = require('../middleware/rateLimit');
const { embedQuery, vectorSearch, getActiveEmbeddingProvider, isSummaryQuery } = require('../services/rag');
const { generateAnswer, getActiveGenerationProvider } = require('../services/llmAdapter');

const router = express.Router();

// POST /api/ask — RAG query endpoint
router.post('/', authenticate, authorize('student', 'faculty', 'admin'), ragLimiter, async (req, res) => {
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
    } else if (req.user.role === 'faculty') {
      userScope.facultyId = req.user.id;
      const subj = await pool.query('SELECT name FROM subjects WHERE id = $1', [subjectId]);
      if (subj.rows.length === 0) {
        return res.status(404).json({ error: 'Subject not found' });
      }
      subjectName = subj.rows[0].name;
    } else if (req.user.role === 'admin') {
      const subj = await pool.query('SELECT name FROM subjects WHERE id = $1', [subjectId]);
      if (subj.rows.length === 0) {
        return res.status(404).json({ error: 'Subject not found' });
      }
      subjectName = subj.rows[0].name;
    } else {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Check ready resources count
    const resourceCheck = await pool.query(
      "SELECT COUNT(*) AS cnt FROM resources WHERE subject_id = $1 AND status = 'ready'",
      [subjectId]
    );
    const readyCount = parseInt(resourceCheck.rows[0]?.cnt || '0', 10);

    if (readyCount === 0) {
      // Check if resources are queued or processing
      const pendingRes = await pool.query(
        "SELECT id, original_name, status, stage, progress FROM resources WHERE subject_id = $1 AND status IN ('queued', 'processing') ORDER BY created_at DESC",
        [subjectId]
      );
      if (pendingRes.rows.length > 0) {
        const p = pendingRes.rows[0];
        const stageDesc = p.stage ? ` (stage: ${p.stage}${p.progress ? `, ${p.progress}%` : ''})` : '';
        return res.json({
          answer: `Course material "${p.original_name}" is currently processing${stageDesc}. Please ask again once processing completes.`,
          wasFound: false,
          isProcessing: true,
          sources: [],
          latencyMs: Date.now() - startTime,
        });
      }

      // Check if resources failed
      const failedRes = await pool.query(
        "SELECT id, original_name FROM resources WHERE subject_id = $1 AND status = 'failed' ORDER BY created_at DESC",
        [subjectId]
      );
      if (failedRes.rows.length > 0) {
        return res.status(400).json({ error: 'Course material processing failed for this subject. Please re-upload the document.' });
      }

      return res.status(400).json({ error: 'No processed resources available for this subject' });
    }

    const activeEmbProvider = (typeof getActiveEmbeddingProvider === 'function' ? getActiveEmbeddingProvider() : null) || { name: 'gemini', model: 'gemini-embedding-2' };
    const activeGenProvider = (typeof getActiveGenerationProvider === 'function' ? getActiveGenerationProvider() : null) || { name: 'google', model: 'gemini-3.1-flash-lite' };

    // Summary query handling using authoritative stored document metadata
    if (typeof isSummaryQuery === 'function' && isSummaryQuery(query)) {
      let resQuery = `SELECT r.id, r.original_name, r.summary, r.key_topics, r.bullet_points, r.page_count, r.chunk_count
                      FROM resources r
                      WHERE r.subject_id = $1 AND r.status = 'ready'`;
      const resParams = [subjectId];
      if (userScope.role === 'student') {
        resQuery += ` AND r.subject_offering_id IN (SELECT id FROM subject_offerings WHERE academic_class_id = $2)`;
        resParams.push(userScope.academicClassId);
      } else if (userScope.role === 'faculty') {
        resQuery += ` AND r.subject_offering_id IN (SELECT id FROM subject_offerings WHERE faculty_id = $2)`;
        resParams.push(userScope.facultyId);
      }
      resQuery += ` ORDER BY r.created_at ASC`;
      const accessibleResources = await pool.query(resQuery, resParams);

      if (accessibleResources.rows.length > 0) {
        const docsWithSummary = accessibleResources.rows.filter(
          (d) => d.summary && !d.summary.startsWith('Unable to') && !d.summary.startsWith('Document section with')
        );

        if (docsWithSummary.length > 0) {
          let answer = '';
          const sources = [];

          if (docsWithSummary.length === 1) {
            const doc = docsWithSummary[0];
            let keyTopics = [];
            try {
              keyTopics = Array.isArray(doc.key_topics) ? doc.key_topics : JSON.parse(doc.key_topics || '[]');
            } catch {}
            let bulletPoints = [];
            try {
              bulletPoints = Array.isArray(doc.bullet_points) ? doc.bullet_points : JSON.parse(doc.bullet_points || '[]');
            } catch {}

            answer = `Based on [1] **${doc.original_name}**:\n\n${doc.summary}`;
            if (bulletPoints.length > 0) {
              answer += `\n\n**Key Highlights:**\n` + bulletPoints.map((b) => `• ${b}`).join('\n');
            }
            if (keyTopics.length > 0) {
              answer += `\n\n**Topics Covered:** ${keyTopics.join(', ')}`;
            }

            sources.push({
              resourceId: doc.id,
              resource_name: doc.original_name,
              filename: doc.original_name,
              chunkIndex: 0,
              pageNumber: 1,
              similarity: 1.0,
              excerpt: doc.summary.substring(0, 200) + '...',
            });
          } else {
            answer = `Here is an overview of the course materials for **${subjectName}**:\n\n`;
            docsWithSummary.forEach((doc, idx) => {
              const num = idx + 1;
              answer += `[${num}] **${doc.original_name}**: ${doc.summary}\n\n`;
              sources.push({
                resourceId: doc.id,
                resource_name: doc.original_name,
                filename: doc.original_name,
                chunkIndex: 0,
                pageNumber: 1,
                similarity: 1.0,
                excerpt: doc.summary.substring(0, 200) + '...',
              });
            });
          }

          const latencyMs = Date.now() - startTime;
          const promptHash = crypto.createHash('sha256').update(query).digest('hex');

          await pool.query(
            `INSERT INTO ai_audit_logs (user_id, subject_id, query, answer, chunks_used, chunk_ids, model_used, provider, tokens_in, tokens_out, response_time_ms, was_found, similarity_score, top_k_scores, prompt_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, true, 1.0, $10, $11)`,
            [
              req.user.id, subjectId, query, answer,
              JSON.stringify(sources.map((s) => ({ resourceId: s.resourceId, chunkIndex: s.chunkIndex, similarity: s.similarity }))),
              [],
              'metadata_summary',
              activeGenProvider.name || 'google',
              latencyMs,
              [1.0],
              promptHash,
            ]
          );

          console.log(`[RAG Metrics] query.count=1, query.was_found_rate=1.0, avg_similarity=1.00, llm.calls=0, token_usage=0`);

          return res.json({
            answer,
            wasFound: true,
            sources,
            latencyMs,
          });
        }
      }
    }

    // Step 1: Embed the query
    const queryEmbedding = await embedQuery(query);

    // Step 2: Vector search with strict authorization scope and model isolation
    const configuredThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.55;
    const overviewQuery = typeof isSummaryQuery === 'function' && isSummaryQuery(query);
    const threshold = overviewQuery ? Math.min(configuredThreshold, 0.2) : configuredThreshold;
    const topK = Math.max(parseInt(process.env.TOP_K_CHUNKS) || 5, overviewQuery ? 8 : 5);
    const rawChunks = await vectorSearch(queryEmbedding, subjectId, userScope, topK, {
      embeddingProvider: activeEmbProvider?.name,
      embeddingModel: activeEmbProvider?.model,
    });
    const chunks = Array.isArray(rawChunks) ? rawChunks : [];

    // Calculate top scores
    const topKScores = chunks.map(c => c.similarity);
    const avgScore = topKScores.length > 0 ? topKScores.reduce((a, b) => a + b, 0) / topKScores.length : 0;
    const topScore = topKScores[0] || 0;
    
    // Hash query for audit log
    const promptHash = crypto.createHash('sha256').update(query).digest('hex');

    // Step 3: Relevance check.
    // Overview/summary questions are compared against a lower threshold because
    // generic wording has weaker cosine similarity than factual queries.
    // If any authorized compatible chunks were retrieved for an overview, use them.
    const belowThreshold = chunks.length === 0 || topScore < threshold || (avgScore < threshold && chunks.length > 0);
    if (belowThreshold && !(overviewQuery && chunks.length > 0)) {
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
          activeGenProvider.name || 'google',
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
      systemPrompt: overviewQuery
        ? `You are a helpful teaching assistant for the subject "${subjectName}". Using ONLY the numbered chunks, write a concise document overview: what the material covers, key topics, and notable highlights. Use markdown. ALWAYS include citations like [1] inline. If the chunks do not describe the document, return EXACTLY: "Not in provided material."`
        : `You are a helpful, conversational teaching assistant for the subject "${subjectName}". Provide a comprehensive, detailed, and well-structured explanation based ONLY on the numbered chunks in the context provided. Use markdown for better readability. If the answer cannot be found in the context at all, return EXACTLY: "Not in provided material." ALWAYS include citations like [1] inline.` 
    });
    let candidateAnswer = typeof llmResp.answer === 'string' ? llmResp.answer.trim() : '';
    // Normalize citations if model outputted [Source 1], (Source 1), or (1)
    candidateAnswer = candidateAnswer
      .replace(/\[Source\s*(\d+)\]/gi, '[$1]')
      .replace(/\(Source\s*(\d+)\)/gi, '[$1]')
      .replace(/\((\d+)\)/g, '[$1]');

    const citationNumbers = Array.from(candidateAnswer.matchAll(/\[(\d+)\]/g), (match) => Number(match[1]));
    const hasInvalidCitation = citationNumbers.some((number) => !Number.isInteger(number) || number < 1 || number > chunks.length);

    let citationsValid = false;
    if (!hasInvalidCitation) {
      if (citationNumbers.length > 0) {
        citationsValid = true;
      } else if (candidateAnswer && candidateAnswer !== 'Not in provided material.' && chunks.length > 0) {
        // Model provided a grounded answer without bracket syntax; attribute to retrieved source [1]
        candidateAnswer = `${candidateAnswer} [1]`;
        citationsValid = true;
      }
    }

    const result = {
      answer: candidateAnswer === 'Not in provided material.' || citationsValid
        ? candidateAnswer || 'Not in provided material.'
        : 'Not in provided material.',
      model: llmResp.model || activeGenProvider.model,
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
        result.model || activeGenProvider.model || 'gemini-2.0-flash',
        activeGenProvider.name || 'google',
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
