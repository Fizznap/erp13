const fetch = require('node-fetch');

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
const DEFAULT_GENERATION_MODEL = 'llama3.2';
const DEFAULT_TIMEOUT_MS = 60000;
const EXPECTED_EMBEDDING_DIMENSIONS = 768;

function getBaseUrl() {
  const url = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || DEFAULT_BASE_URL;
  return url.replace(/\/+$/, '');
}

function getTimeoutMs() {
  return Math.max(1000, Number(process.env.OLLAMA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
}

function getEmbeddingModel() {
  return process.env.OLLAMA_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

function getGenerationModel() {
  return process.env.OLLAMA_GENERATION_MODEL || process.env.OLLAMA_MODEL || DEFAULT_GENERATION_MODEL;
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function getFetch() {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  return fetch;
}

/**
 * Ollama Provider Implementation
 * Independent local provider for document embeddings, query embeddings,
 * answer generation, and metadata extraction.
 */
class OllamaProvider {
  constructor(options = {}) {
    this.name = 'ollama';
    this.dimensions = options.dimensions || EXPECTED_EMBEDDING_DIMENSIONS;
  }

  get baseUrl() {
    return getBaseUrl();
  }

  get model() {
    return getEmbeddingModel();
  }

  get generationModel() {
    return getGenerationModel();
  }

  /**
   * Safe fetch with AbortSignal timeout and detailed error classification
   */
  async _fetch(endpoint, body, timeoutMs = getTimeoutMs()) {
    const url = `${this.baseUrl}${endpoint}`;
    const cleanBaseUrl = sanitizeUrl(this.baseUrl);
    const fetchFn = getFetch();

    let response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if ((err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) && url.includes('host.docker.internal')) {
        try {
          const fallbackUrl = url.replace('host.docker.internal', '127.0.0.1');
          response = await fetchFn(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch {
          // If fallback fails, allow original error handling below to take effect
        }
      }

      if (!response) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message?.includes('timed out')) {
          const timeoutErr = new Error(`Ollama request timed out after ${timeoutMs}ms`);
          timeoutErr.name = 'TimeoutError';
          throw timeoutErr;
        }
        if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
          throw new Error(`Ollama connection failed at ${cleanBaseUrl}. Ensure Ollama is running.`);
        }
        throw new Error(`Ollama network error: ${err.message}`);
      }
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        const errJson = await response.json();
        errorBody = errJson.error || JSON.stringify(errJson);
      } catch {
        errorBody = await response.text().catch(() => '');
      }

      const lowerErr = errorBody.toLowerCase();
      // Only classify as model-not-found if the error specifically mentions the model or isn't just an endpoint 404
      if (lowerErr.includes('model') && (lowerErr.includes('not found') || lowerErr.includes('does not exist'))) {
        const modelName = body.model || 'requested';
        throw new Error(`Ollama model '${modelName}' not found. Please run 'ollama pull ${modelName}'.`);
      }

      if (response.status === 404) {
        const notFoundErr = new Error(`Ollama 404: ${errorBody || 'Endpoint not found'}`);
        notFoundErr.status = 404;
        throw notFoundErr;
      }

      throw new Error(`Ollama API error (${response.status}): ${errorBody || response.statusText}`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error('Ollama returned an invalid or malformed JSON response.');
    }
  }

  /**
   * Embed a single query string using Ollama
   */
  async embedQuery(query) {
    const embeddings = await this.embedBatch([query]);
    if (!embeddings || embeddings.length === 0) {
      throw new Error('Ollama failed to generate query embedding');
    }
    return embeddings[0];
  }

  /**
   * Embed a single text string (alias for embedQuery)
   */
  async embedText(text) {
    return this.embedQuery(text);
  }

  /**
   * Embed a batch of texts using Ollama
   * Prefers Ollama's /api/embed batch endpoint, with fallback to sequential /api/embeddings
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    const model = this.model;

    // Try modern Ollama /api/embed endpoint (supports batching)
    try {
      const data = await this._fetch('/api/embed', {
        model,
        input: texts,
      });

      if (data && Array.isArray(data.embeddings)) {
        this._validateVectors(data.embeddings, texts.length, model);
        return data.embeddings;
      }
    } catch (embedErr) {
      // If endpoint doesn't exist on older Ollama instances, fall back to /api/embeddings
      if (!embedErr.message.includes('404') && !embedErr.message.includes('Cannot POST')) {
        throw embedErr;
      }
    }

    // Fallback: sequential /api/embeddings for legacy Ollama versions
    const results = [];
    for (const text of texts) {
      const data = await this._fetch('/api/embeddings', {
        model,
        prompt: text,
      });
      if (!data || !Array.isArray(data.embedding)) {
        throw new Error(`Ollama /api/embeddings returned invalid vector format for model '${model}'.`);
      }
      results.push(data.embedding);
    }

    this._validateVectors(results, texts.length, model);
    return results;
  }

  /**
   * Validate vector dimensions against the expected column dimensions (768)
   */
  _validateVectors(vectors, expectedCount, model) {
    if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
      throw new Error(`Ollama returned ${vectors?.length || 0} vectors (expected ${expectedCount}).`);
    }

    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      if (!Array.isArray(vector)) {
        throw new Error(`Ollama vector at index ${i} is not an array.`);
      }
      if (vector.length !== this.dimensions) {
        throw new Error(
          `Embedding model '${model}' produced ${vector.length}-dimensional vectors, but the database schema requires ${this.dimensions} dimensions.`
        );
      }
      for (let j = 0; j < vector.length; j++) {
        if (!Number.isFinite(vector[j])) {
          throw new Error(`Ollama vector at index ${i} contains non-finite values at dimension ${j}.`);
        }
      }
    }
  }

  /**
   * Generate answer from numbered context using Ollama
   */
  async generateAnswer({ question, numberedContext = [], systemPrompt = null, temperature = 0.2 }) {
    const model = this.generationModel;

    const contextText = numberedContext
      .map((c) => `[${c.n}] ${c.label || ''}\n${c.text}`)
      .join('\n\n');

    const strictSystemPrompt = systemPrompt ||
      `You are an academic assistant. Answer ONLY using the provided numbered context chunks.

MANDATORY CITATION RULE:
You MUST cite your sources using square bracket notation like [1], [2] throughout your answer. For example: "...covers crimping tools [1] and networking commands [2]."
Every claim or listed point must include its bracketed citation [N].
If the answer cannot be found in the context at all, return EXACTLY: "Not in provided material."`;

    const userPrompt = contextText
      ? `CONTEXT FROM COURSE MATERIALS:\n\n${contextText}\n\n---\n\nSTUDENT QUESTION: ${question}\n\nAnswer using ONLY the context above. ALWAYS cite sources inline using bracketed numbers like [1] or [2].`
      : `QUESTION: ${question}\n\nAnswer concisely.`;

    let raw;
    let answerText = '';
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      // Use Ollama /api/chat
      const chatBody = {
        model,
        messages: [
          { role: 'system', content: strictSystemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        options: {
          temperature,
        },
      };

      raw = await this._fetch('/api/chat', chatBody);
      answerText = raw.message?.content || '';
      tokensIn = raw.prompt_eval_count || 0;
      tokensOut = raw.eval_count || 0;
    } catch (chatErr) {
      // Fallback to /api/generate if /api/chat is unavailable
      if (chatErr.message.includes('404') && !chatErr.message.includes('model')) {
        const generateBody = {
          model,
          system: strictSystemPrompt,
          prompt: userPrompt,
          stream: false,
          options: { temperature },
        };
        raw = await this._fetch('/api/generate', generateBody);
        answerText = raw.response || '';
        tokensIn = raw.prompt_eval_count || 0;
        tokensOut = raw.eval_count || 0;
      } else {
        throw chatErr;
      }
    }

    let answer = String(answerText || '').trim();
    if (!answer) {
      answer = 'Not in provided material.';
    }

    // Normalize citations if model outputted [Source 1], (Source 1), Source 1:, or (1)
    const normalized = answer
      .replace(/\[Source\s*(\d+)\]/gi, '[$1]')
      .replace(/\(Source\s*(\d+)\)/gi, '[$1]')
      .replace(/Source\s*(\d+):?/gi, '[$1]')
      .replace(/\((\d+)\)/g, '[$1]');

    const notFoundExact = 'Not in provided material.';
    // Enforce citations or exact fallback
    if (!normalized.includes(notFoundExact) && !/\[\d+\]/.test(normalized)) {
      answer = notFoundExact;
    } else {
      answer = normalized;
    }

    return {
      answer,
      raw,
      tokensIn,
      tokensOut,
      model,
      provider: 'ollama',
    };
  }

  /**
   * Generate resource metadata (summary, keyTopics, bulletPoints) using Ollama JSON mode
   */
  async generateMetadata(chunks) {
    const model = this.generationModel;
    // Take up to 3 chunks and max 4000 characters to keep prompt evaluation fast and prevent timeout
    const text = chunks.slice(0, 3).map((c) => c.content).join('\n\n').slice(0, 4000);

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

    const body = {
      model,
      format: 'json',
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
      },
    };

    let raw;
    try {
      raw = await this._fetch('/api/generate', body);
    } catch (err) {
      console.warn('[OllamaProvider] Metadata generation error:', err.message);
      return {
        summary: `Document section with ${chunks.length} content chunks.`,
        keyTopics: [],
        bulletPoints: [],
      };
    }

    const rawResponse = raw.response || '{}';
    try {
      const parsed = JSON.parse(rawResponse);
      return {
        summary: parsed.summary || 'Summary unavailable.',
        keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
        bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [],
      };
    } catch {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            summary: parsed.summary || 'Summary unavailable.',
            keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
            bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints : [],
          };
        } catch {}
      }
      return { summary: 'Unable to parse generated summary.', keyTopics: [], bulletPoints: [] };
    }
  }
}

module.exports = { OllamaProvider, EXPECTED_EMBEDDING_DIMENSIONS };
