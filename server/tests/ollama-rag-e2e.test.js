const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const PDFDocument = require('pdfkit');

const { pool } = require('../src/db/pool');
const { processResource } = require('../src/services/processor');
const { embedQuery, vectorSearch, generateAnswer } = require('../src/services/rag');
const { reembedResource } = require('../src/services/reembed');
const { OllamaProvider } = require('../src/services/providers/ollamaProvider');
const { GeminiProvider } = require('../src/services/providers/geminiProvider');

jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('node-fetch', () => jest.fn((...args) => global.fetch(...args)));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.includes('student-b')) {
      req.user = { id: 'user-student-b', role: 'student', academicClassId: 'class-bbbb-2222' };
    } else {
      req.user = { id: 'user-student-a', role: 'student', academicClassId: 'class-aaaa-1111' };
    }
    next();
  },
  authorize: (...roles) => (req, res, next) => next(),
}));

// Helper to generate a real, parseable synthetic PDF in memory
function generateSyntheticPdf(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
    doc.fontSize(12).text(text);
    doc.end();
  });
}

describe('Ollama RAG End-to-End Pipeline & Safeguards', () => {
  let app;
  let originalEnv;
  let originalFetch;
  let tempUploadDir;
  let syntheticPdfBuffer;

  const mockSubjectId = 'sub-1111-2222-3333';
  const mockClassAId = 'class-aaaa-1111';
  const mockClassBId = 'class-bbbb-2222';
  const mockOfferingAId = 'offering-aaaa-1111';
  const mockResourceId = 'res-9999-8888-7777';

  beforeAll(async () => {
    tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-ollama-test-'));
    syntheticPdfBuffer = await generateSyntheticPdf(
      `Distributed Systems Course Notes. Port 9123 is allocated for the raft consensus protocol. The heartbeat interval is 150ms. Master node failover timeout is set to 500ms. ${Array(80).fill('verifiedmaterial').join(' ')}`
    );
  });

  afterAll(() => {
    if (tempUploadDir && fs.existsSync(tempUploadDir)) {
      fs.rmSync(tempUploadDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalFetch = global.fetch;
    process.env.UPLOAD_DIR = tempUploadDir;
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
    process.env.OLLAMA_GENERATION_MODEL = 'llama3.2';
    process.env.SIMILARITY_THRESHOLD = '0.55';
    process.env.TOP_K_CHUNKS = '5';

    global.fetch = jest.fn();

    // Set up mock Express app
    app = express();
    app.use(express.json());
    app.use('/api/ask', require('../src/routes/ask'));
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  // ============================================================
  // Test 1, 2, 3: Document Processing, Worker, Dimensions & DB Storage
  // ============================================================
  test('1-3: processes synthetic PDF, embeds with Ollama (768D), and stores chunks with provider metadata', async () => {
    const testPdfPath = path.join(tempUploadDir, 'synthetic-course-notes.pdf');
    fs.writeFileSync(testPdfPath, syntheticPdfBuffer);

    // Mock Ollama embedding API response: 768-dimensional vector
    const mockVector768 = Array(768).fill(0.042);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'nomic-embed-text',
        embeddings: [mockVector768],
      }),
    });

    // Mock Ollama metadata generation response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          summary: 'Course notes on Raft protocol.',
          keyTopics: ['Raft', 'Consensus'],
          bulletPoints: ['Port 9123', '150ms heartbeat'],
        }),
      }),
    });

    // Mock DB queries for processor
    const mockResource = {
      id: mockResourceId,
      subject_id: mockSubjectId,
      subject_offering_id: mockOfferingAId,
      original_name: 'synthetic-course-notes.pdf',
      file_path: testPdfPath,
    };

    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM resources WHERE id')) {
        return Promise.resolve({ rows: [mockResource] });
      }
      if (sql.includes('INSERT INTO resource_chunks')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('UPDATE resources')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await processResource(mockResourceId);

    expect(result.success).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(0);

    // Verify chunk insertion SQL contains vector(768) and provider metadata
    const chunkInsertCalls = pool.query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO resource_chunks')
    );
    expect(chunkInsertCalls.length).toBeGreaterThan(0);
    const chunkArgs = chunkInsertCalls[0][1];
    // Parameter 8: embedding vector
    expect(chunkArgs[7]).toContain('0.042');
    // Parameter 9: embedding_provider
    expect(chunkArgs[8]).toBe('ollama');
    // Parameter 10: embedding_model
    expect(chunkArgs[9]).toBe('nomic-embed-text');

    // Verify resource was marked ready with provider metadata
    const readyUpdateCalls = pool.query.mock.calls.filter(([sql]) =>
      sql.includes("status = 'ready'")
    );
    expect(readyUpdateCalls.length).toBe(1);
    const updateArgs = readyUpdateCalls[0][1];
    expect(updateArgs).toContain('ollama');
    expect(updateArgs).toContain('nomic-embed-text');
  });

  // ============================================================
  // Test 4 & 5: Query embedding, vector retrieval, and genuine citations
  // ============================================================
  test('4-5: embeds query via Ollama, retrieves authorized chunks, and generates answer with genuine citations [1]', async () => {
    // 1. Mock query embedding via Ollama /api/embed
    const mockQueryVector = Array(768).fill(0.042);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'nomic-embed-text',
        embeddings: [mockQueryVector],
      }),
    });

    // 2. Mock Ollama /api/chat answer generation with genuine citation
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'llama3.2',
        message: {
          role: 'assistant',
          content: 'Port 9123 is allocated for the raft consensus protocol with a 150ms heartbeat [1].',
        },
        prompt_eval_count: 90,
        eval_count: 22,
      }),
    });

    // Mock DB queries for ask endpoint
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: mockClassAId }] });
      }
      if (sql.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Distributed Systems' }] });
      }
      if (sql.includes("resources WHERE subject_id = $1 AND status = 'ready'")) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (sql.includes('SELECT rc.*, r.original_name')) {
        return Promise.resolve({
          rows: [
            {
              id: 'chunk-1',
              resource_id: mockResourceId,
              original_name: 'synthetic-course-notes.pdf',
              page_number: 1,
              chunk_index: 0,
              content: 'Port 9123 is allocated for the raft consensus protocol. The heartbeat interval is 150ms.',
              similarity: 0.92,
            },
          ],
        });
      }
      if (sql.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'Which port is allocated for raft consensus?', subjectId: mockSubjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(true);
    expect(res.body.answer).toContain('Port 9123 is allocated for the raft consensus protocol with a 150ms heartbeat [1]');
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0]).toMatchObject({
      filename: 'synthetic-course-notes.pdf',
      pageNumber: 1,
      similarity: 0.92,
    });
    expect(typeof res.body.latencyMs).toBe('number');
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);

    // Verify audit log recorded ollama provider
    const auditCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO ai_audit_logs'));
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0][1]).toContain('ollama');
  });

  // ============================================================
  // Test 6: Unsupported questions and exact fallback behavior
  // ============================================================
  test('6: returns exact "Not in provided material." and skips LLM when similarity is below threshold', async () => {
    // Mock query embedding
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'nomic-embed-text',
        embeddings: [Array(768).fill(0.01)],
      }),
    });

    // Mock DB queries returning low similarity chunk
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: mockClassAId }] });
      }
      if (sql.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Distributed Systems' }] });
      }
      if (sql.includes("resources WHERE subject_id = $1 AND status = 'ready'")) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (sql.includes('SELECT rc.*, r.original_name')) {
        // Return chunk below threshold 0.55
        return Promise.resolve({
          rows: [
            {
              id: 'chunk-1',
              resource_id: mockResourceId,
              original_name: 'synthetic-course-notes.pdf',
              page_number: 1,
              chunk_index: 0,
              content: 'Unrelated content.',
              similarity: 0.22,
            },
          ],
        });
      }
      if (sql.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'What is the boiling point of liquid helium?', subjectId: mockSubjectId });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('Not in provided material.');
    expect(res.body.wasFound).toBe(false);
    expect(res.body.sources).toEqual([]);
    // Ensure LLM generate was never called (fetch only called once for embedding)
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/embed');
  });

  // ============================================================
  // Test 7: Cross-class resource isolation
  // ============================================================
  test('7: enforces cross-class resource isolation for students', async () => {
    // Student B belongs to mockClassBId.
    // The subject offering check should reject the student if not enrolled.
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: mockClassBId }] });
      }
      if (sql.includes('FROM subject_offerings so')) {
        // Not enrolled in Class A's offering
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .set('Authorization', 'Bearer token-student-b')
      .send({ query: 'Tell me about raft consensus', subjectId: mockSubjectId });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not enrolled in this subject/i);
  });

  // ============================================================
  // Test 8: Provider unavailable behavior (No silent mock answers)
  // ============================================================
  test('8: returns 500 without mock answers when Ollama service is unreachable', async () => {
    // Simulate connection failure (ECONNREFUSED)
    const connErr = new Error('fetch failed');
    connErr.code = 'ECONNREFUSED';
    global.fetch.mockRejectedValueOnce(connErr);

    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: mockClassAId }] });
      }
      if (sql.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Distributed Systems' }] });
      }
      if (sql.includes("resources WHERE subject_id = $1 AND status = 'ready'")) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'Tell me about raft consensus', subjectId: mockSubjectId });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to process query');
    // Ensure it NEVER silently returns a mock or fake answer
    expect(res.body.answer).toBeUndefined();
  });

  // ============================================================
  // Test 9: Existing Gemini mode retains complete functionality
  // ============================================================
  test('9: retains complete functionality in Gemini mode when configured', async () => {
    process.env.EMBEDDING_PROVIDER = 'gemini';
    process.env.LLM_PROVIDER = 'google';
    process.env.GOOGLE_AI_API_KEY = 'test-gemini-key';
    process.env.GOOGLE_AI_MODEL = 'gemini-3.1-flash-lite';

    // Mock Gemini embedContent
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        embedding: { values: Array(768).fill(0.088) },
      }),
    });

    // Mock Gemini generateContent
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: 'Grounded Gemini answer [1].' }] },
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 15 },
      }),
    });

    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: mockClassAId }] });
      }
      if (sql.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Distributed Systems' }] });
      }
      if (sql.includes("resources WHERE subject_id = $1 AND status = 'ready'")) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (sql.includes('SELECT rc.*, r.original_name')) {
        return Promise.resolve({
          rows: [
            {
              id: 'chunk-1',
              resource_id: mockResourceId,
              original_name: 'synthetic-course-notes.pdf',
              page_number: 1,
              chunk_index: 0,
              content: 'Gemini grounded content.',
              similarity: 0.88,
            },
          ],
        });
      }
      if (sql.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'Gemini question', subjectId: mockSubjectId });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('Grounded Gemini answer [1].');
    expect(res.body.wasFound).toBe(true);

    // Verify Gemini endpoint was called with header
    const [embedUrl, embedOptions] = global.fetch.mock.calls[0];
    expect(embedUrl).toContain('/models/gemini-embedding-2:embedContent');
    expect(embedOptions.headers['x-goog-api-key']).toBe('test-gemini-key');

    const [genUrl, genOptions] = global.fetch.mock.calls[1];
    expect(genUrl).toContain('/models/gemini-3.1-flash-lite:generateContent');
  });

  // ============================================================
  // Test 10: Non-destructive re-embedding utility
  // ============================================================
  test('10: reembedResource safely re-indexes existing chunks in-place without dropping data', async () => {
    const mockVector768 = Array(768).fill(0.777);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        model: 'nomic-embed-text',
        embeddings: [mockVector768],
      }),
    });

    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValueOnce(mockClient);

    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('SELECT * FROM resources WHERE id')) {
        return Promise.resolve({ rows: [{ id: mockResourceId, original_name: 'test.pdf' }] });
      }
      if (sql.includes('SELECT id, chunk_index, content FROM resource_chunks')) {
        return Promise.resolve({ rows: [{ id: 'chunk-1', chunk_index: 0, content: 'Existing chunk text.' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const reembedResult = await reembedResource(mockResourceId, 'ollama');

    expect(reembedResult.success).toBe(true);
    expect(reembedResult.provider).toBe('ollama');
    expect(reembedResult.model).toBe('nomic-embed-text');

    // Verify transaction usage
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    // Verify chunk was updated with new vector and metadata
    const chunkUpdateCall = mockClient.query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE resource_chunks')
    );
    expect(chunkUpdateCall).toBeTruthy();
    expect(chunkUpdateCall[1]).toContain('ollama');
    expect(chunkUpdateCall[1]).toContain('nomic-embed-text');
  });
});
