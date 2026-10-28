jest.mock('node-fetch', () => jest.fn());

let fetch;

describe('Google provider key handling', () => {
  const originalEnv = {
    provider: process.env.LLM_PROVIDER,
    key: process.env.GOOGLE_AI_API_KEY,
    model: process.env.GOOGLE_AI_MODEL,
  };

  beforeEach(() => {
    jest.resetModules();
    fetch = require('node-fetch');
    fetch.mockReset();
    process.env.LLM_PROVIDER = 'google';
    process.env.GOOGLE_AI_API_KEY = 'synthetic-google-key';
    process.env.GOOGLE_AI_MODEL = 'gemini-3.1-flash-lite';
  });

  afterAll(() => {
    if (originalEnv.provider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = originalEnv.provider;
    if (originalEnv.key === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = originalEnv.key;
    if (originalEnv.model === undefined) delete process.env.GOOGLE_AI_MODEL;
    else process.env.GOOGLE_AI_MODEL = originalEnv.model;
  });

  test('sends Gemini credentials in the documented header and sanitizes provider errors', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'synthetic-google-key must not appear in errors' });
    const adapter = require('../src/services/llmAdapter');
    const error = await adapter.generateAnswer({
      question: 'Synthetic question',
      numberedContext: [{ n: 1, label: 'Synthetic note', text: 'Synthetic context.' }],
    }).catch((value) => value);

    expect(error.message).toBe('Google Generative API error 401');
    expect(error.message).not.toContain('synthetic-google-key');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect(url).not.toContain('key=');
    expect(options.headers['x-goog-api-key']).toBe('synthetic-google-key');
    const body = JSON.parse(options.body);
    expect(body.contents[0].parts[0].text).toContain('Question: Synthetic question');
    expect(body.contents[0].parts[0].text).toContain('Synthetic context.');
    expect(body.generationConfig.maxOutputTokens).toBe(800);
  });

  test('respects an explicit generation model environment override', async () => {
    process.env.GOOGLE_AI_MODEL = 'synthetic-model-override';
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Synthetic grounded answer [1]' }] } }] }),
    });
    const adapter = require('../src/services/llmAdapter');
    await adapter.generateAnswer({
      question: 'Synthetic question',
      numberedContext: [{ n: 1, label: 'Synthetic note', text: 'Synthetic context.' }],
    });

    expect(fetch.mock.calls[0][0]).toContain('/models/synthetic-model-override:generateContent');
  });
});
