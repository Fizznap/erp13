const fetch = require('node-fetch');

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';
const DEFAULT_GENERATION_MODEL = 'gemini-3.1-flash-lite';
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

function getTimeoutMs() {
  return Math.max(1000, Number(process.env.GOOGLE_AI_TIMEOUT_MS) || 30000);
}

function getApiKey() {
  return process.env.GOOGLE_AI_API_KEY;
}

function getEmbeddingModel() {
  return process.env.GOOGLE_AI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

function getGenerationModel() {
  return process.env.GOOGLE_AI_MODEL || DEFAULT_GENERATION_MODEL;
}

function sanitizeError(message, apiKey) {
  if (!apiKey || !message) return message;
  return message.split(apiKey).join('[REDACTED_API_KEY]');
}

function getFetch() {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  return fetch;
}

async function fetchGoogleApi(url, options) {
  const timeoutMs = getTimeoutMs();
  const fetchFn = getFetch();
  return fetchFn(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Gemini Embedding Implementation
 */
class GeminiProvider {
  constructor() {
    this.name = 'gemini';
    this.dimensions = 768;
  }

  get model() {
    return getEmbeddingModel();
  }

  get generationModel() {
    return getGenerationModel();
  }

  async embedText(text) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not configured');
    const apiBase = getApiBase();
    const model = getEmbeddingModel();

    let response;
    try {
      response = await fetchGoogleApi(
        `${apiBase}/models/${model}:embedContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            outputDimensionality: this.dimensions,
          }),
        }
      );
    } catch (err) {
      if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
        throw err;
      }
      throw new Error(`Gemini embedding connection error: ${sanitizeError(err.message, apiKey)}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.embedding.values;
  }

  async embedBatch(texts) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not configured');
    const apiBase = getApiBase();
    const model = getEmbeddingModel();

    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: this.dimensions,
    }));

    let response;
    try {
      response = await fetchGoogleApi(
        `${apiBase}/models/${model}:batchEmbedContents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ requests }),
        }
      );
    } catch (err) {
      if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
        throw err;
      }
      throw new Error(`Gemini batch embedding connection error: ${sanitizeError(err.message, apiKey)}`);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Batch embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.embeddings.map((e) => e.values);
  }

  async embedQuery(query) {
    return this.embedText(query);
  }

  async generateAnswer({ question, numberedContext = [], systemPrompt = null, temperature = 0.0 }) {
    const apiKey = getApiKey();
    const model = getGenerationModel();
    const apiBase = getApiBase();
    const maxOutputTokens = Number(process.env.GOOGLE_AI_MAX_OUTPUT_TOKENS || 800);

    const contextText = numberedContext
      .map((c) => `[${c.n}] ${c.label || ''}\n${c.text}`)
      .join('\n\n');

    const strictSystemPrompt = systemPrompt ||
      `You are an academic assistant. Answer ONLY using the provided numbered context chunks. If the answer is not fully supported, return EXACTLY: "Not in provided material." Include numbered inline citations like [1]. Be concise.`;

    const userPrompt = contextText
      ? `${strictSystemPrompt}\n\nContext:\n${contextText}\n\nQuestion: ${question}\n\nAnswer:`
      : `Question: ${question}\n\nAnswer:`;

    const body = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens,
      },
    };

    let response;
    try {
      if (apiKey) {
        response = await fetchGoogleApi(
          `${apiBase}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
          }
        );
      } else {
        // Fallback to Google Application Default Credentials if in cloud environment
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const client = await auth.getClient();
        const accessTokenResponse = await client.getAccessToken();
        const accessToken = accessTokenResponse && (accessTokenResponse.token || accessTokenResponse);
        if (!accessToken) throw new Error('Failed to obtain Google access token');

        response = await fetchGoogleApi(
          `${apiBase}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(body),
          }
        );
      }
    } catch (err) {
      if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
        throw err;
      }
      throw new Error(`Google Generative API error: ${sanitizeError(err.message, apiKey)}`);
    }

    if (!response.ok) {
      const txt = await response.text().catch(() => '');
      throw new Error(`Google Generative API error ${response.status}`);
    }

    const json = await response.json();
    let answer = json.candidates?.[0]?.content?.parts?.[0]?.text || null;
    if (!answer) {
      answer = 'Not in provided material.';
    }
    answer = String(answer).trim();

    const notFoundExact = 'Not in provided material.';
    // Enforce citation or exact fallback
    if (!answer.includes(notFoundExact) && !/\[\d+\]/.test(answer)) {
      answer = notFoundExact;
    }

    const usage = json.usageMetadata || {};
    return {
      answer,
      raw: json,
      tokensIn: usage.promptTokenCount || 0,
      tokensOut: usage.candidatesTokenCount || 0,
      model,
      provider: 'google',
    };
  }

  async generateMetadata(chunks) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not configured');
    const apiBase = getApiBase();
    const model = getGenerationModel();

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
      `${apiBase}/models/${model}:generateContent`,
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
}

module.exports = { GeminiProvider };
