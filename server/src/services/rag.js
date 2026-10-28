const { pool } = require('../db/pool');
require('dotenv').config();

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-2';
const GENERATION_MODEL = process.env.GOOGLE_AI_MODEL || 'gemini-3.1-flash-lite';
const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const API_BASE = (() => {
  const override = process.env.GOOGLE_AI_API_BASE_URL;
  if (!override) return GOOGLE_API_BASE;
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('GOOGLE_AI_API_BASE_URL is only supported in test mode');
  }
  const url = new URL(override);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Test Gemini API base must be a local HTTP URL');
  }
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
})();
const API_TIMEOUT_MS = Math.max(1000, Number(process.env.GOOGLE_AI_TIMEOUT_MS) || 30000);

function fetchGoogleApi(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
}

/**
 * Embed a single text string using Google's embedding model.
 * Returns a 768-dimensional float array.
 */
async function embedText(text) {
  if (!GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not configured');
  const response = await fetchGoogleApi(
    `${API_BASE}/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GOOGLE_AI_API_KEY },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

/**
 * Batch embed multiple texts. Google API supports batch embedding.
 */
async function embedBatch(texts) {
  if (!GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not configured');
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    outputDimensionality: 768
  }));

  const response = await fetchGoogleApi(
    `${API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GOOGLE_AI_API_KEY },
      body: JSON.stringify({ requests }),
    }
  );

  if (!response.ok) {
    throw new Error(`Batch embedding API error: ${response.status}`);
  }

  const data = await response.json();
  return data.embeddings.map((e) => e.values);
}

/**
 * Embed a query string — alias for embedText.
 */
async function embedQuery(query) {
  return embedText(query);
}

/**
 * Perform vector similarity search against resource_chunks within a subject.
 * STRICT RAG: Authorized by academic class (student) or assignment (faculty).
 */
async function vectorSearch(queryEmbedding, subjectId, userScope, topK = 5) {
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  let authFilter = '';
  let params = [vectorStr, subjectId, topK];

  if (userScope.role === 'student') {
    authFilter = `AND r.subject_offering_id IN (SELECT id FROM subject_offerings WHERE academic_class_id = $4)`;
    params.push(userScope.academicClassId);
  } else if (userScope.role === 'faculty') {
    authFilter = `AND r.subject_offering_id IN (SELECT id FROM subject_offerings WHERE faculty_id = $4)`;
    params.push(userScope.facultyId);
  }

  const result = await pool.query(
    `SELECT rc.*, r.original_name, r.subject_id,
            1 - (rc.embedding <=> $1::vector) AS similarity
     FROM resource_chunks rc
     JOIN resources r ON r.id = rc.resource_id
     WHERE r.subject_id = $2 AND r.status = 'ready'
     ${authFilter}
     ORDER BY rc.embedding <=> $1::vector
     LIMIT $3`,
    params
  );

  return result.rows;
}

/**
 * Generate an answer from retrieved chunks using Gemini.
 * Strict RAG — answer ONLY from provided context.
 */
async function generateAnswer(query, chunks, subjectName) {
  if (!GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not configured');
  // Build context from chunks
  const context = chunks
    .map((c, i) =>
      `[${i + 1}] ${c.original_name} | page:${c.page_number || 'n/a'} | chunk:${c.chunk_index}\n${c.content.slice(0, 1200)}`
    )
    .join('\n\n---\n\n');

  const systemPrompt = `You are a strict assistant. Answer ONLY using the numbered chunks in the context. If the answer cannot be found in the context, return EXACTLY: "Not in provided material." Include citations like [1] inline. Be concise.`;

  const userPrompt = `CONTEXT FROM COURSE MATERIALS:

${context}

---

STUDENT QUESTION: ${query}

Answer using ONLY the context above. Cite sources as [Source N].`;

  const response = await fetchGoogleApi(
    `${API_BASE}/models/${GENERATION_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GOOGLE_AI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Generation API error: ${response.status}`);
  }

  const data = await response.json();
  let answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Failed to generate answer.';
  const usage = data.usageMetadata || {};
  
  const notFoundExact = 'Not in provided material.';
  
  // Enforce LLM reply must reference chunk numbers or exact NOT_FOUND
  if (!answer.includes(notFoundExact) && !/\[\d+\]/.test(answer)) {
    // Treat as failure if no citation and not the exact fallback message
    answer = notFoundExact;
  }

  return {
    answer,
    model: GENERATION_MODEL,
    tokensIn: usage.promptTokenCount || 0,
    tokensOut: usage.candidatesTokenCount || 0,
  };
}

/**
 * Generate metadata (summary, key topics, bullet points) from chunks.
 */
async function generateMetadata(chunks) {
  if (!GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not configured');
  const text = chunks.slice(0, 5).map((c) => c.content).join('\n\n');

  const prompt = `Analyze this academic content and provide:
1. A concise 2-3 sentence summary
2. 5-8 key topics as a JSON array of strings
3. 5-10 bullet point highlights as a JSON array of strings

Content:
${text}

Respond ONLY in this exact JSON format:
{
  "summary": "...",
  "keyTopics": ["topic1", "topic2", ...],
  "bulletPoints": ["point1", "point2", ...]
}`;

  const response = await fetchGoogleApi(
    `${API_BASE}/models/${GENERATION_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GOOGLE_AI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Metadata generation error: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  try {
    return JSON.parse(rawText);
  } catch {
    // Try to extract JSON from text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { summary: 'Unable to generate summary.', keyTopics: [], bulletPoints: [] };
  }
}

module.exports = {
  embedText,
  embedBatch,
  embedQuery,
  vectorSearch,
  generateAnswer,
  generateMetadata,
};
