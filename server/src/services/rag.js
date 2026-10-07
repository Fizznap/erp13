const { pool } = require('../db/pool');
require('dotenv').config();

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-2';
const GENERATION_MODEL = 'gemini-3.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Embed a single text string using Google's text-embedding-004.
 * Returns a 768-dimensional float array.
 */
async function embedText(text) {
  const response = await fetch(
    `${API_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_AI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

/**
 * Batch embed multiple texts. Google API supports batch embedding.
 */
async function embedBatch(texts) {
  const requests = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    outputDimensionality: 768
  }));

  const response = await fetch(
    `${API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${GOOGLE_AI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Batch embedding API error: ${response.status} - ${err}`);
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
 * Returns top-K chunks with similarity scores.
 */
async function vectorSearch(queryEmbedding, subjectId, topK = 5) {
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const result = await pool.query(
    `SELECT rc.*, r.original_name, r.subject_id,
            1 - (rc.embedding <=> $1::vector) AS similarity
     FROM resource_chunks rc
     JOIN resources r ON r.id = rc.resource_id
     WHERE r.subject_id = $2 AND r.status = 'ready'
     ORDER BY rc.embedding <=> $1::vector
     LIMIT $3`,
    [vectorStr, subjectId, topK]
  );

  return result.rows;
}

/**
 * Generate an answer from retrieved chunks using Gemini.
 * Strict RAG — answer ONLY from provided context.
 */
async function generateAnswer(query, chunks, subjectName) {
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

  const response = await fetch(
    `${API_BASE}/models/${GENERATION_MODEL}:generateContent?key=${GOOGLE_AI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.1, // Low temperature for factual accuracy
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Generation API error: ${response.status} - ${err}`);
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

  const response = await fetch(
    `${API_BASE}/models/${GENERATION_MODEL}:generateContent?key=${GOOGLE_AI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Metadata generation error: ${response.status} - ${err}`);
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
