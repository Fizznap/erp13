jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

describe('Gemini REST provider request handling', () => {
  let originalFetch;
  let originalApiKey;
  let originalTimeout;
  let originalModel;
  let rag;

  beforeEach(() => {
    jest.resetModules();
    originalFetch = global.fetch;
    originalApiKey = process.env.GOOGLE_AI_API_KEY;
    originalTimeout = process.env.GOOGLE_AI_TIMEOUT_MS;
    originalModel = process.env.GOOGLE_AI_MODEL;
    process.env.EMBEDDING_PROVIDER = 'gemini';
    process.env.LLM_PROVIDER = 'google';
    process.env.GOOGLE_AI_API_KEY = 'unit-test-key';
    process.env.GOOGLE_AI_TIMEOUT_MS = '1500';
    process.env.GOOGLE_AI_MODEL = 'gemini-3.1-flash-lite';
    rag = require('../src/services/rag');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = originalApiKey;
    if (originalTimeout === undefined) delete process.env.GOOGLE_AI_TIMEOUT_MS;
    else process.env.GOOGLE_AI_TIMEOUT_MS = originalTimeout;
    if (originalModel === undefined) delete process.env.GOOGLE_AI_MODEL;
    else process.env.GOOGLE_AI_MODEL = originalModel;
  });

  test('parses 768-dimensional embeddings and attaches a bounded abort signal', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: { values: Array(768).fill(0.25) } }),
    });

    const embedding = await rag.embedQuery('synthetic test query');

    expect(embedding).toHaveLength(768);
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    expect(global.fetch.mock.calls[0][0]).not.toContain('key=');
    expect(global.fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('unit-test-key');
    expect(global.fetch.mock.calls[0][0]).toContain('/models/gemini-embedding-2:embedContent');
    const embeddingBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(embeddingBody.model).toBe('models/gemini-embedding-2');
    expect(embeddingBody.outputDimensionality).toBe(768);
  });

  test('propagates provider HTTP errors for the caller to report as failure', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'unit-test-key provider details' });

    const error = await rag.embedQuery('synthetic test query').catch((value) => value);
    expect(error.message).toBe('Embedding API error: 429');
    expect(error.message).not.toContain('unit-test-key');
  });

  test('propagates abort timeouts rather than returning a successful result', async () => {
    const timeoutError = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    global.fetch.mockRejectedValueOnce(timeoutError);

    await expect(rag.embedQuery('synthetic test query')).rejects.toBe(timeoutError);
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test('uses the supported generation model without deprecated sampling settings', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Port 4821 [1]' }] } }] }),
    });

    const result = await rag.generateAnswer(
      'Which port is in the note?',
      [{ original_name: 'synthetic.pdf', page_number: 1, chunk_index: 0, content: 'The fictional port is 4821.' }],
      'Networks'
    );
    const [url, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(result.answer).toBe('Port 4821 [1]');
    expect(url).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect(url).not.toContain('key=');
    expect(options.headers['x-goog-api-key']).toBe('unit-test-key');
    expect(body.generationConfig).not.toHaveProperty('temperature');
    expect(body.contents[0].parts[0].text).toContain('The fictional port is 4821.');
  });

  test('loads the requested generation model from the local server dotenv configuration', async () => {
    delete process.env.GOOGLE_AI_MODEL;
    jest.resetModules();
    require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
    process.env.LLM_PROVIDER = 'google';
    process.env.EMBEDDING_PROVIDER = 'gemini';
    rag = require('../src/services/rag');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Synthetic answer [1]' }] } }] }),
    });

    const result = await rag.generateAnswer(
      'Synthetic question?',
      [{ original_name: 'synthetic.pdf', page_number: 1, chunk_index: 0, content: 'Authorized synthetic chunk.' }],
      'Synthetic subject'
    );

    expect(global.fetch.mock.calls[0][0]).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect(result.model).toBe('gemini-3.1-flash-lite');
  });

  test('respects an explicit generation model environment override', async () => {
    process.env.GOOGLE_AI_MODEL = 'synthetic-model-override';
    jest.resetModules();
    rag = require('../src/services/rag');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Answer [1]' }] } }] }),
    });

    const result = await rag.generateAnswer(
      'Synthetic question?',
      [{ original_name: 'synthetic.pdf', page_number: 1, chunk_index: 0, content: 'Synthetic authorized chunk.' }],
      'Synthetic subject'
    );

    expect(global.fetch.mock.calls[0][0]).toContain('/models/synthetic-model-override:generateContent');
    expect(result.model).toBe('synthetic-model-override');
  });
});
