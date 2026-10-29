const { pool } = require('../db/pool');
const { getEmbeddingProvider, getGenerationProvider, resolveEmbeddingProviderName, resolveGenerationProviderName } = require('./providers');
require('dotenv').config();

const GOOGLE_AI_API_KEY = () => {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  return key && String(key).trim() ? String(key).trim() : undefined;
};
const EMBEDDING_MODEL = () => process.env.GOOGLE_AI_EMBEDDING_MODEL || 'gemini-embedding-2';
const GENERATION_MODEL = () => process.env.GOOGLE_AI_MODEL || 'gemini-3.1-flash-lite';
const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function getApiBase() {
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
}

function getApiTimeoutMs() {
  return Math.max(1000, Number(process.env.GOOGLE_AI_TIMEOUT_MS) || 30000);
}

function fetchGoogleApi(url, options) {
  const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : require('node-fetch');
  return fetchFn(url, { ...options, signal: AbortSignal.timeout(getApiTimeoutMs()) });
}

/**
 * Embed a single text string.
 * Routes to active provider (Gemini or Ollama).
 */
async function embedText(text) {
  const providerName = resolveEmbeddingProviderName();
  if (providerName === 'ollama') {
    return getEmbeddingProvider('ollama').embedText(text);
  }

  // Gemini implementation
  const apiKey = GOOGLE_AI_API_KEY();
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not configured');
  const apiBase = getApiBase();
  const embModel = EMBEDDING_MODEL();

  const response = await fetchGoogleApi(
    `${apiBase}/models/${embModel}:embedContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        model: `models/${embModel}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768,
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
 * Batch embed multiple texts.
 * Routes to active provider (Gemini or Ollama).
 */
async function embedBatch(texts) {
  const providerName = resolveEmbeddingProviderName();
  if (providerName === 'ollama') {
    return getEmbeddingProvider('ollama').embedBatch(texts);
  }

  // Gemini implementation
  const apiKey = GOOGLE_AI_API_KEY();
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not configured');
  const apiBase = getApiBase();
  const embModel = EMBEDDING_MODEL();

  const requests = texts.map((text) => ({
    model: `models/${embModel}`,
    content: { parts: [{ text }] },
    outputDimensionality: 768,
  }));

  const response = await fetchGoogleApi(
    `${apiBase}/models/${embModel}:batchEmbedContents`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
 * Protects embedding space compatibility by filtering on embedding_model if requested.
 */
async function vectorSearch(queryEmbedding, subjectId, userScope, topK = 5, options = {}) {
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  let authFilter = '';
  let params = [vectorStr, subjectId, topK];

  if (userScope.role === 'student') {
    authFilter = `AND (r.subject_offering_id IN (SELECT id FROM subject_offerings WHERE academic_class_id = $4) OR r.subject_offering_id IS NULL)`;
    params.push(userScope.academicClassId);
  } else if (userScope.role === 'faculty') {
    authFilter = `AND (r.subject_offering_id IN (SELECT id FROM subject_offerings WHERE faculty_id = $4) OR r.subject_offering_id IS NULL)`;
    params.push(userScope.facultyId);
  }

  // Model isolation filter to avoid mixing Gemini and Ollama embedding spaces.
  let modelFilter = '';
  const targetProvider = options.embeddingProvider;
  const targetModel = options.embeddingModel;
  if (targetProvider) {
    params.push(targetProvider);
    modelFilter += ` AND rc.embedding_provider = $${params.length}`;
  }
  if (targetModel) {
    params.push(targetModel);
    modelFilter += ` AND rc.embedding_model = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT rc.*, r.original_name, r.subject_id,
            1 - (rc.embedding <=> $1::vector) AS similarity
     FROM resource_chunks rc
     JOIN resources r ON r.id = rc.resource_id
     WHERE r.subject_id = $2 AND r.status = 'ready'
     ${authFilter}
     ${modelFilter}
     ORDER BY rc.embedding <=> $1::vector
     LIMIT $3`,
    params
  );

  return result.rows;
}

/**
 * Generate an answer from retrieved chunks.
 * Routes to active provider (Gemini or Ollama).
 * Strict RAG — answer ONLY from provided context.
 */
async function generateAnswer(query, chunks, subjectName, options = {}) {
  const genProviderName = resolveGenerationProviderName();
  if (genProviderName === 'ollama') {
    const ollama = getGenerationProvider('ollama');
    const numberedContext = chunks.map((c, i) => ({
      n: i + 1,
      label: `${c.original_name} | page:${c.page_number || 'n/a'} | chunk:${c.chunk_index}`,
      text: c.content,
    }));
    return ollama.generateAnswer({
      question: query,
      numberedContext,
      systemPrompt: `You are a strict assistant. Answer ONLY using the numbered chunks in the context. If the answer cannot be found in the context, return EXACTLY: "Not in provided material." Include citations like [1] inline. Be concise.`,
    });
  }

  // Gemini implementation
  const apiKey = GOOGLE_AI_API_KEY();
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not configured');
  const apiBase = getApiBase();
  const genModel = GENERATION_MODEL();

  const context = chunks
    .map((c, i) =>
      `[${i + 1}] ${c.original_name} | page:${c.page_number || 'n/a'} | chunk:${c.chunk_index}\n${c.content.slice(0, 1200)}`
    )
    .join('\n\n---\n\n');

  const systemPrompt = `You are a strict assistant. Answer ONLY using the numbered chunks in the context. If the answer cannot be found in the context, return EXACTLY: "Not in provided material." Include citations like [1] inline. Be concise.`;

  const userPrompt = `CONTEXT FROM COURSE MATERIALS:\n\n${context}\n\n---\n\nSTUDENT QUESTION: ${query}\n\nAnswer using ONLY the context above. Cite sources as [Source N].`;

  const response = await fetchGoogleApi(
    `${apiBase}/models/${genModel}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
    answer = notFoundExact;
  }

  return {
    answer,
    model: genModel,
    tokensIn: usage.promptTokenCount || 0,
    tokensOut: usage.candidatesTokenCount || 0,
  };
}

/**
 * Generate metadata (summary, key topics, bullet points) from chunks.
 */
async function generateMetadata(chunks) {
  const genProviderName = resolveGenerationProviderName();
  if (genProviderName === 'ollama') {
    return getGenerationProvider('ollama').generateMetadata(chunks);
  }

  // Gemini implementation
  const apiKey = GOOGLE_AI_API_KEY();
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not configured');
  const apiBase = getApiBase();
  const genModel = GENERATION_MODEL();

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
    `${apiBase}/models/${genModel}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { summary: 'Unable to generate summary.', keyTopics: [], bulletPoints: [] };
  }
}

function getActiveEmbeddingProvider() {
  return getEmbeddingProvider();
}

function getActiveGenerationProvider() {
  return getGenerationProvider();
}

const DOC_WORDS = '(?:pdf|document|doc|file|notes|manual|syllabus|book|materials?|course\\s+materials?)';

/**
 * Detects whether a query is asking for a general document summary or overview,
 * rather than a narrow factual retrieval question.
 */
function isSummaryQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.trim().toLowerCase();

  // 1. Direct patterns like "pdf contains ??", "pdf summary", "pdf overview", "document contents", "notes highlights"
  if (new RegExp(`^\\s*${DOC_WORDS}s?\\s+(?:contains?|consists?(?:\\s+of)?|covers?|summary|overview|contents?|highlights?)\\b`, 'i').test(q)) {
    return true;
  }
  // 2. "what [does] [this|the] <doc> (contain|consist|cover|have|include|say)s?"
  if (new RegExp(`\\b(?:what\\s+)?(?:does\\s+)?(?:this|the|our)?\\s*${DOC_WORDS}s?\\s+(?:contains?|consists?(?:\\s+of)?|covers?|includes?|says?|have)\\b`, 'i').test(q)) {
    return true;
  }
  // 3. "what is [this|the] <doc> about" or "tell me about this <doc>"
  if (new RegExp(`\\b(?:what\\s+is|what's|tell\\s+me\\s+about)\\s+(?:this|the)?\\s*${DOC_WORDS}s?\\s*(?:about)?\\b`, 'i').test(q)) {
    return true;
  }
  // 4. "what's in [this|the] <doc>" or "what is inside [this|the] <doc>"
  if (new RegExp(`\\bwhat(?:'s|\\s+is)?\\s+(?:in|inside)\\s+(?:this|the)?\\s*${DOC_WORDS}s?\\b`, 'i').test(q)) {
    return true;
  }
  // 5. "summarize / summary / overview / contents of [this|the] <doc>"
  if (new RegExp(`\\b(?:summarize|summary|overview|contents?|highlights?)\\s+(?:of\\s+)?(?:this|the|all)?\\s*${DOC_WORDS}s?\\b`, 'i').test(q)) {
    return true;
  }
  // 6. "give me a summary [of this pdf]" or "give me an overview"
  if (new RegExp(`\\bgive\\s+(?:me\\s+)?(?:a|an)?\\s*(?:summary|overview|brief)(?:\\s+(?:of\\s+)?(?:this|the)?\\s*${DOC_WORDS}s?)?\\b`, 'i').test(q)) {
    return true;
  }
  // 7. "what topics are covered" or "topics covered in this <doc>"
  if (new RegExp(`\\b(?:what\\s+)?topics\\s+(?:are\\s+)?covered\\b`, 'i').test(q)) {
    return true;
  }
  // 8. General standalone "summarize", "summary", "overview"
  if (/^(summarize|summary|overview|table of contents)\??$/i.test(q)) {
    return true;
  }

  return false;
}

module.exports = {
  embedText,
  embedBatch,
  embedQuery,
  vectorSearch,
  generateAnswer,
  generateMetadata,
  getActiveEmbeddingProvider,
  getActiveGenerationProvider,
  isSummaryQuery,
};
