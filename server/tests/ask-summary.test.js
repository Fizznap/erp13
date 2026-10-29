// server/tests/ask-summary.test.js
const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');
const { embedQuery, vectorSearch, isSummaryQuery } = require('../src/services/rag');
const llmAdapter = require('../src/services/llmAdapter');

jest.mock('../src/services/rag', () => {
  const actual = jest.requireActual('../src/services/rag');
  return {
    ...actual,
    embedQuery: jest.fn(),
    vectorSearch: jest.fn(),
  };
});

jest.mock('../src/services/llmAdapter');

jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
  },
}));

let mockTestUser = { id: 'test-admin-id', role: 'admin' };

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = mockTestUser;
    next();
  },
  authorize: (...roles) => (req, res, next) => {
    if (roles.includes(mockTestUser.role)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  },
}));

const app = express();
app.use(express.json());
app.use('/api/ask', require('../src/routes/ask'));

describe('API /api/ask — Admin permission, summaries, and processing states', () => {
  const subjectId = '2f4314fc-259c-4b99-a1d4-b79c589481a2';

  beforeEach(() => {
    jest.clearAllMocks();
    mockTestUser = { id: 'test-admin-id', role: 'admin' };
  });

  afterEach(() => jest.clearAllMocks());

  test('admin role is authorized on /api/ask and can query subjects', async () => {
    pool.query.mockImplementation((query, params) => {
      if (query.includes('FROM subjects WHERE id = $1')) {
        return Promise.resolve({ rows: [{ name: 'Computer Networks' }] });
      }
      if (query.includes('COUNT(*) AS cnt FROM resources')) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (query.includes('FROM resources r')) {
        return Promise.resolve({
          rows: [
            {
              id: 'res-cn-1',
              original_name: '40192_Lab Manual_CN (1)-1.pdf',
              summary: 'This covers crimping tools for RJ45 connectors and basic Linux networking commands.',
              key_topics: ['RJ45', 'Linux Commands'],
              bullet_points: ['Crimping tool RJ45 connector instructions.', 'Linux networking commands: ifconfig, ping.'],
            },
          ],
        });
      }
      if (query.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({});
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'What this PDF consists ??', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(true);
    expect(res.body.answer).toContain('40192_Lab Manual_CN (1)-1.pdf');
    expect(res.body.answer).toContain('[1]');
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].filename).toBe('40192_Lab Manual_CN (1)-1.pdf');
  });

  test('summary query returns authoritative metadata summary without calling LLM', async () => {
    mockTestUser = { id: 'test-student-id', role: 'student' };

    pool.query.mockImplementation((query, params) => {
      if (query.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: 'class-1' }] });
      }
      if (query.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Computer Networks' }] });
      }
      if (query.includes('COUNT(*) AS cnt FROM resources')) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (query.includes('FROM resources r')) {
        return Promise.resolve({
          rows: [
            {
              id: 'res-cn-1',
              original_name: '40192_Lab Manual_CN (1)-1.pdf',
              summary: 'Authoritative summary of 5 experiments.',
              key_topics: JSON.stringify(['Networking', 'Crimping']),
              bullet_points: JSON.stringify(['Highlight 1', 'Highlight 2']),
            },
          ],
        });
      }
      if (query.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({});
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'What does this document contain?', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(true);
    expect(res.body.answer).toContain('Authoritative summary of 5 experiments.');
    expect(res.body.answer).toContain('[1]');
    expect(llmAdapter.generateAnswer).not.toHaveBeenCalled();
  });

  test('reports clear processing status when resources are in queued or processing status', async () => {
    pool.query.mockImplementation((query, params) => {
      if (query.includes('FROM subjects WHERE id = $1')) {
        return Promise.resolve({ rows: [{ name: 'Computer Networks' }] });
      }
      if (query.includes('COUNT(*) AS cnt FROM resources WHERE subject_id = $1 AND status = \'ready\'')) {
        return Promise.resolve({ rows: [{ cnt: '0' }] });
      }
      if (query.includes('status IN (\'queued\', \'processing\')')) {
        return Promise.resolve({
          rows: [
            {
              id: 'res-proc-1',
              original_name: 'Chapter1_Lecture.pdf',
              status: 'processing',
              stage: 'EMBEDDING',
              progress: 60,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'Explain chapter 1', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.isProcessing).toBe(true);
    expect(res.body.wasFound).toBe(false);
    expect(res.body.answer).toContain('Chapter1_Lecture.pdf');
    expect(res.body.answer).toContain('EMBEDDING, 60%');
  });

  test('normalizes [Source 1] citations into [1] from LLM responses', async () => {
    pool.query.mockImplementation((query, params) => {
      if (query.includes('FROM subjects WHERE id = $1')) {
        return Promise.resolve({ rows: [{ name: 'Computer Networks' }] });
      }
      if (query.includes('COUNT(*) AS cnt FROM resources')) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (query.includes('FROM resources r WHERE r.subject_id = $1 AND r.status = \'ready\'')) {
        return Promise.resolve({ rows: [] }); // Not a summary query or no precomputed summary
      }
      if (query.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({});
      }
      return Promise.resolve({ rows: [] });
    });

    embedQuery.mockResolvedValue([0.1, 0.2]);
    vectorSearch.mockResolvedValue([
      { id: 'chunk1', resource_id: 'res-1', content: 'Ping is used to test reachability.', original_name: 'notes.pdf', page_number: 2, chunk_index: 1, similarity: 0.88 },
    ]);

    llmAdapter.generateAnswer.mockResolvedValue({
      answer: 'According to [Source 1], ping tests reachability.',
      model: 'llama3.2',
      tokensIn: 50,
      tokensOut: 20,
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'What is ping used for in networks?', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(true);
    expect(res.body.answer).toContain('[1]');
    expect(res.body.answer).not.toContain('[Source 1]');
  });

  test('resolves "pdf contains ??" immediately via stored metadata without calling embedQuery or LLM', async () => {
    mockTestUser = { id: 'test-student-id', role: 'student' };

    pool.query.mockImplementation((query, params) => {
      if (query.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: 'class-1' }] });
      }
      if (query.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Computer Networks' }] });
      }
      if (query.includes('COUNT(*) AS cnt FROM resources')) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (query.includes('FROM resources r')) {
        return Promise.resolve({
          rows: [
            {
              id: 'res-cn-1',
              original_name: '40192_Lab Manual_CN (1)-1.pdf',
              summary: 'This academic content covers crimping tools for RJ45 connectors and basic Linux networking commands.',
              key_topics: JSON.stringify(['RJ45 Connectors', 'Linux Networking Commands']),
              bullet_points: JSON.stringify(['Crimping RJ45 correctly is crucial', 'ifconfig configures network interfaces']),
            },
          ],
        });
      }
      if (query.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({});
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'pdf contains ??', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(true);
    expect(res.body.answer).toContain('40192_Lab Manual_CN (1)-1.pdf');
    expect(res.body.answer).toContain('RJ45 Connectors');
    expect(res.body.sources).toHaveLength(1);
    expect(embedQuery).not.toHaveBeenCalled();
    expect(llmAdapter.generateAnswer).not.toHaveBeenCalled();
  });

  test('summary query query includes subject-level resources where subject_offering_id IS NULL', async () => {
    mockTestUser = { id: 'test-student-id', role: 'student' };
    let capturedResQuery = '';

    pool.query.mockImplementation((query, params) => {
      if (query.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: 'class-1' }] });
      }
      if (query.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Computer Networks' }] });
      }
      if (query.includes('COUNT(*) AS cnt FROM resources')) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      if (query.includes('FROM resources r')) {
        capturedResQuery = query;
        return Promise.resolve({
          rows: [
            {
              id: 'res-cn-null-offering',
              original_name: 'Syllabus.pdf',
              summary: 'General syllabus for Computer Networks.',
              key_topics: ['Syllabus', 'Grading'],
              bullet_points: ['Exams 50%', 'Labs 50%'],
            },
          ],
        });
      }
      if (query.includes('INSERT INTO ai_audit_logs')) {
        return Promise.resolve({});
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'pdf summary', subjectId });

    expect(res.status).toBe(200);
    expect(res.body.wasFound).toBe(true);
    expect(res.body.answer).toContain('Syllabus.pdf');
    expect(capturedResQuery).toContain('OR r.subject_offering_id IS NULL');
  });

  test('returns sanitized PROVIDER_AUTH_ERROR on 401 Google API unauthenticated error', async () => {
    mockTestUser = { id: 'test-student-id', role: 'student' };

    pool.query.mockImplementation((query, params) => {
      if (query.includes('SELECT academic_class_id FROM users')) {
        return Promise.resolve({ rows: [{ academic_class_id: 'class-1' }] });
      }
      if (query.includes('FROM subject_offerings so')) {
        return Promise.resolve({ rows: [{ name: 'Computer Networks' }] });
      }
      if (query.includes('COUNT(*) AS cnt FROM resources')) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // Factual query that is not a summary query
    embedQuery.mockRejectedValue(new Error('Embedding API error: 401 (UNAUTHENTICATED/ACCESS_TOKEN_TYPE_UNSUPPORTED)'));

    const res = await request(app)
      .post('/api/ask')
      .send({ query: 'What is subnet mask 255.255.255.0?', subjectId });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PROVIDER_AUTH_ERROR');
    expect(res.body.error).toContain('AI service authentication failed');
  });
});
