// server/tests/ask-llm.integration.test.js
const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');
const { embedQuery, vectorSearch } = require('../src/services/rag');
const llmAdapter = require('../src/services/llmAdapter');

jest.mock('../src/services/rag', () => ({
  embedQuery: jest.fn(),
  vectorSearch: jest.fn(),
}));

jest.mock('../src/services/llmAdapter');

jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn()
  }
}));

// Mock auth middleware for testing
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'test-user-id', role: 'student' };
    next();
  },
  authorize: (...roles) => (req, res, next) => next(),
}));

// Setup app
const app = express();
app.use(express.json());
app.use('/api/ask', require('../src/routes/ask'));

describe('API /api/ask integration - LLM adapter wiring', () => {
  const subjectId = 'test-subject-id';

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock subject enrollment check
    pool.query.mockImplementation((query, params) => {
      if (query.includes('subject_enrollments')) {
        return Promise.resolve({ rows: [{ name: 'Test Subject' }] });
      }
      if (query.includes('resources WHERE subject_id = $1 AND status = \'ready\'')) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (query.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({});
      }
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => jest.clearAllMocks());

  test('fast-fail: returns Not in provided material and does NOT call LLM when topK < threshold', async () => {
    embedQuery.mockResolvedValue([0.1, 0.2]);
    vectorSearch.mockResolvedValue([
      { id: 'chunk1', content: 'completely unrelated chunk', original_name: 'doc1.pdf', page_number: 1, chunk_index: 0, similarity: 0.10 }
    ]);

    llmAdapter.generateAnswer.mockImplementation(() => {
      throw new Error('LLM should not be called in fast-fail');
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'completely unrelated question to indexed docs', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('Not in provided material.');
    expect(llmAdapter.generateAnswer).not.toHaveBeenCalled();
  });

  test('hit-case: calls LLM when topK >= threshold and returns answer', async () => {
    embedQuery.mockResolvedValue([0.1, 0.2]);
    vectorSearch.mockResolvedValue([
      { id: 'chunk1', content: 'on-topic chunk', original_name: 'doc1.pdf', page_number: 1, chunk_index: 0, similarity: 0.90 }
    ]);

    llmAdapter.generateAnswer.mockResolvedValue({ answer: 'LLM ANSWER [1]', raw: {}, tokensIn: 10, tokensOut: 10, model: 'mock' });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'on-topic question that should match content', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('LLM ANSWER');
    expect(llmAdapter.generateAnswer).toHaveBeenCalled();
  });
});
