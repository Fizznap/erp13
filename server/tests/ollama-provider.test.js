const { OllamaProvider } = require('../src/services/providers/ollamaProvider');
const {
  getEmbeddingProvider,
  getGenerationProvider,
  resolveEmbeddingProviderName,
  resolveGenerationProviderName,
} = require('../src/services/providers');

describe('OllamaProvider unit tests', () => {
  let originalEnv;
  let originalFetch;

  beforeEach(() => {
    jest.resetModules();
    originalEnv = { ...process.env };
    originalFetch = global.fetch;
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
    process.env.OLLAMA_GENERATION_MODEL = 'llama3.2';
    process.env.OLLAMA_TIMEOUT_MS = '2000';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  test('embedQuery requests 768D vector from /api/embed and returns clean vector', async () => {
    const mockVector = Array(768).fill(0.123);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'nomic-embed-text',
        embeddings: [mockVector],
      }),
    });

    const provider = new OllamaProvider();
    const result = await provider.embedQuery('What is the raft protocol?');

    expect(result).toHaveLength(768);
    expect(result).toEqual(mockVector);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/embed');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('nomic-embed-text');
    expect(body.input).toEqual(['What is the raft protocol?']);
  });

  test('embedBatch batches multiple texts in a single request', async () => {
    const mockVectors = [Array(768).fill(0.1), Array(768).fill(0.2), Array(768).fill(0.3)];
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'nomic-embed-text',
        embeddings: mockVectors,
      }),
    });

    const provider = new OllamaProvider();
    const results = await provider.embedBatch(['Chunk 1', 'Chunk 2', 'Chunk 3']);

    expect(results).toHaveLength(3);
    expect(results[0]).toHaveLength(768);
    expect(results[1]).toHaveLength(768);
    expect(results[2]).toHaveLength(768);
  });

  test('falls back to legacy /api/embeddings if /api/embed returns 404', async () => {
    const mockVector = Array(768).fill(0.456);
    // First call to /api/embed fails with 404
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'endpoint not found' }),
    });
    // Fallback to /api/embeddings succeeds
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: mockVector }),
    });

    const provider = new OllamaProvider();
    const result = await provider.embedQuery('legacy test');

    expect(result).toHaveLength(768);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/embed');
    expect(global.fetch.mock.calls[1][0]).toContain('/api/embeddings');
  });

  test('rejects vector dimension mismatch with clear schema compatibility error', async () => {
    // Model returns 384 dimensions (e.g., all-minilm) when database requires 768
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'all-minilm',
        embeddings: [Array(384).fill(0.1)],
      }),
    });

    const provider = new OllamaProvider();
    await expect(provider.embedQuery('dimension mismatch')).rejects.toThrow(
      /produced 384-dimensional vectors, but the database schema requires 768 dimensions/i
    );
  });

  test('handles connection refused (Ollama not running) with actionable error', async () => {
    const connError = new Error('fetch failed');
    connError.code = 'ECONNREFUSED';
    global.fetch.mockRejectedValueOnce(connError);

    const provider = new OllamaProvider();
    await expect(provider.embedQuery('test')).rejects.toThrow(
      /Ollama connection failed at http:\/\/127\.0\.0\.1:11434\. Ensure Ollama is running\./i
    );
  });

  test('handles request timeout with TimeoutError', async () => {
    const timeoutErr = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    global.fetch.mockRejectedValueOnce(timeoutErr);

    const provider = new OllamaProvider();
    await expect(provider.embedQuery('timeout test')).rejects.toThrow(/Ollama request timed out after 2000ms/i);
  });

  test('handles missing model (404) with instruction to pull model', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "model 'nomic-embed-text' not found" }),
    });

    const provider = new OllamaProvider();
    await expect(provider.embedQuery('missing model')).rejects.toThrow(
      /Ollama model 'nomic-embed-text' not found\. Please run 'ollama pull nomic-embed-text'\./i
    );
  });

  test('generateAnswer produces answer with inline citations using /api/chat', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'llama3.2',
        message: {
          role: 'assistant',
          content: 'The raft consensus heartbeat is 150ms [1]. Failover timeout is 500ms [2].',
        },
        prompt_eval_count: 85,
        eval_count: 24,
      }),
    });

    const provider = new OllamaProvider();
    const result = await provider.generateAnswer({
      question: 'What is the heartbeat interval?',
      numberedContext: [
        { n: 1, label: 'notes.pdf | page 1', text: 'Heartbeat interval is 150ms.' },
        { n: 2, label: 'notes.pdf | page 2', text: 'Failover timeout is 500ms.' },
      ],
    });

    expect(result.answer).toContain('The raft consensus heartbeat is 150ms [1]');
    expect(result.model).toBe('llama3.2');
    expect(result.tokensIn).toBe(85);
    expect(result.tokensOut).toBe(24);
    expect(result.provider).toBe('ollama');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('llama3.2');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  test('generateAnswer enforces exact fallback when model answers without citations', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'llama3.2',
        message: {
          role: 'assistant',
          content: 'I know about raft consensus but am not citing anything.',
        },
      }),
    });

    const provider = new OllamaProvider();
    const result = await provider.generateAnswer({
      question: 'Explain raft',
      numberedContext: [{ n: 1, text: 'Raft consensus info.' }],
    });

    // Enforced strict fallback because citations like [1] are missing
    expect(result.answer).toBe('Not in provided material.');
  });

  test('generateMetadata requests JSON format from Ollama', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          summary: 'Overview of Raft distributed consensus protocol.',
          keyTopics: ['Consensus', 'Raft', 'Heartbeats'],
          bulletPoints: ['150ms heartbeat interval', 'Leader election on timeout'],
        }),
      }),
    });

    const provider = new OllamaProvider();
    const result = await provider.generateMetadata([{ content: 'Raft consensus text...' }]);

    expect(result.summary).toBe('Overview of Raft distributed consensus protocol.');
    expect(result.keyTopics).toContain('Consensus');
    expect(result.bulletPoints).toHaveLength(2);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/generate');
    const body = JSON.parse(options.body);
    expect(body.format).toBe('json');
  });
});

describe('Independent Provider Resolution', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('defaults to Gemini when GOOGLE_AI_API_KEY is present and overrides are unset', () => {
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.LLM_PROVIDER;
    process.env.GOOGLE_AI_API_KEY = 'test-key';

    expect(resolveEmbeddingProviderName()).toBe('gemini');
    expect(resolveGenerationProviderName()).toBe('google');
  });

  test('allows independent provider selection: Ollama embedding + Gemini generation', () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.LLM_PROVIDER = 'google';
    process.env.GOOGLE_AI_API_KEY = 'test-key';

    const embProvider = getEmbeddingProvider();
    const genProvider = getGenerationProvider();

    expect(embProvider.name).toBe('ollama');
    expect(genProvider.name).toBe('gemini');
  });

  test('allows independent provider selection: Gemini embedding + Ollama generation', () => {
    process.env.EMBEDDING_PROVIDER = 'gemini';
    process.env.LLM_PROVIDER = 'ollama';
    process.env.GOOGLE_AI_API_KEY = 'test-key';

    const embProvider = getEmbeddingProvider();
    const genProvider = getGenerationProvider();

    expect(embProvider.name).toBe('gemini');
    expect(genProvider.name).toBe('ollama');
  });

  test('allows pure Ollama local mode with zero Gemini configuration', () => {
    delete process.env.GOOGLE_AI_API_KEY;
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.LLM_PROVIDER = 'ollama';

    const embProvider = getEmbeddingProvider();
    const genProvider = getGenerationProvider();

    expect(embProvider.name).toBe('ollama');
    expect(genProvider.name).toBe('ollama');
  });
});
