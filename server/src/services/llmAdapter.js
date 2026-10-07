// server/src/services/llmAdapter.js
// Pluggable LLM adapter for Snippet
// Supports: mock, openai, google (placeholder). Add providers as needed.
// Export: generateAnswer({ question, numberedContext, systemPrompt, temperature })
// Returns: { answer: string, raw: object, tokensIn: number, tokensOut: number, model: string }

const fetch = require('node-fetch');
require('dotenv').config();

const PROVIDER = process.env.LLM_PROVIDER || 'mock';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

function buildContextPrompt(question, numberedContext, systemPrompt) {
  // Build a single prompt body that we will pass to the LLM
  const contextText = numberedContext
    .map((c) => `[${c.n}] ${c.label}\n${c.text}`)
    .join('\n\n');
  // We intentionally keep the system prompt strict (non-hallucination)
  const finalPrompt = `${systemPrompt}\n\nContext:\n${contextText}\n\nQuestion: ${question}\n\nAnswer:`;
  return finalPrompt;
}

async function generateOpenAI({ question, numberedContext, systemPrompt, temperature = 0.0 }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set for OpenAI provider');

  const prompt = buildContextPrompt(question, numberedContext, systemPrompt);
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  const body = {
    model: model, // adjust as needed
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${prompt}` }
    ],
    temperature,
    max_tokens: 800
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${txt}`);
  }

  const json = await res.json();
  const answer = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    ? json.choices[0].message.content.trim()
    : 'Not in provided material.';

  return { answer, raw: json, tokensIn: json.usage?.prompt_tokens || 0, tokensOut: json.usage?.completion_tokens || 0, model };
}

async function generateGoogle({ question, numberedContext, systemPrompt, temperature = 0.0 }) {
  const promptText = buildContextPrompt(question, numberedContext, systemPrompt);
  const model = process.env.GOOGLE_AI_MODEL || 'gemini-3.5-flash';
  const maxOutputTokens = Number(process.env.GOOGLE_AI_MAX_OUTPUT_TOKENS || 800);

  const apiKey = process.env.GOOGLE_AI_API_KEY || null;

  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: Number(temperature) || 0.0,
      maxOutputTokens
    }
  };

  let res;
  if (apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } else {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const accessTokenResponse = await client.getAccessToken();
    const accessToken = accessTokenResponse && (accessTokenResponse.token || accessTokenResponse);
    if (!accessToken) throw new Error('Failed to obtain Google access token');
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google Generative API error ${res.status}: ${txt}`);
  }

  const json = await res.json();
  let answer = json.candidates?.[0]?.content?.parts?.[0]?.text || null;

  if (!answer) {
    const dump = JSON.stringify(json).slice(0, 2000);
    answer = `(unparsed response preview) ${dump}`;
  }

  answer = String(answer || '').trim();
  if (!answer) answer = 'Not in provided material.';

  const usage = json.usageMetadata || {};
  return { answer, raw: json, tokensIn: usage.promptTokenCount || 0, tokensOut: usage.candidatesTokenCount || 0, model };
}

async function generateMock({ question, numberedContext, systemPrompt, temperature = 0.0 }) {
  // Deterministic, safe dev answer. Also returns a citation to enforce format.
  const citations = numberedContext.map((c, i) => `[${i + 1}]`).join(' ');
  return { answer: `DEV-MOCK ANSWER. Sources: ${citations}\n\nShort answer for: ${question}`, raw: null, tokensIn: 10, tokensOut: 10, model: 'mock' };
}

async function generateAnswer({ question, numberedContext = [], systemPrompt = null, temperature = 0.0 }) {
  // Enforce a strict default system prompt if none provided
  const strictSystemPrompt = systemPrompt || `You are an academic assistant. Answer ONLY using the provided numbered context chunks. If the answer is not fully supported, return EXACTLY: "Not in provided material." Include numbered inline citations like [1]. Be concise.`;
  if (PROVIDER === 'openai') {
    return generateOpenAI({ question, numberedContext, systemPrompt: strictSystemPrompt, temperature });
  } else if (PROVIDER === 'google') {
    return generateGoogle({ question, numberedContext, systemPrompt: strictSystemPrompt, temperature });
  } else {
    return generateMock({ question, numberedContext, systemPrompt: strictSystemPrompt, temperature });
  }
}

module.exports = { generateAnswer };
