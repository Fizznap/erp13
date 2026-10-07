const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');
const { embedQuery, vectorSearch } = require('../src/services/rag');
const { generateAnswer } = require('../src/services/llmAdapter');

// Mock external RAG services
jest.mock('../src/services/rag', () => ({
  embedQuery: jest.fn(),
  vectorSearch: jest.fn(),
}));

jest.mock('../src/services/llmAdapter', () => ({
  generateAnswer: jest.fn(),
}));

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

describe('E2E Smoke Test - RAG Pipeline', () => {
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

  test('Ask a covered question -> answer includes citation', async () => {
    // Mock RAG pipeline success
    embedQuery.mockResolvedValue([0.1, 0.2]);
    vectorSearch.mockResolvedValue([
      { id: 'chunk1', content: 'Apple is red', original_name: 'doc1.pdf', page_number: 1, chunk_index: 0, similarity: 0.85 }
    ]);
    generateAnswer.mockResolvedValue({
      answer: 'Apple is red according to the text. [1]',
      tokensIn: 10,
      tokensOut: 10
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'What color is apple?', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(true);
    expect(res.body.answer).toContain('[1]');
    expect(res.body.sources.length).toBe(1);
    
    // Verify audit log insertion
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_audit_logs'),
      expect.arrayContaining([true, 0.85]) // wasFound=true, similarity_score=0.85
    );
  });

  test('Ask an uncovered question -> asserts NOT_FOUND', async () => {
    // Mock RAG pipeline low similarity
    embedQuery.mockResolvedValue([0.1, 0.2]);
    vectorSearch.mockResolvedValue([
      { id: 'chunk1', content: 'Apple is red', original_name: 'doc1.pdf', page_number: 1, chunk_index: 0, similarity: 0.30 }
    ]);
    
    // The ask route handles fallback when score < threshold (0.55) without calling generateAnswer

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'What is quantum physics?', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(false);
    expect(res.body.answer).toBe('Not in provided material.');
    expect(res.body.sources.length).toBe(0);
    
    // Verify audit log insertion
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_audit_logs'),
      expect.arrayContaining([0.30]) // similarity_score=0.30
    );
  });
});
