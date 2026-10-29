const request = require('supertest');
const express = require('express');

// Mock pool
jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

let mockTestUser = { id: 'admin-uuid', role: 'admin' };

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockTestUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = mockTestUser;
    next();
  },
  authorize: (...roles) => (req, res, next) => {
    const allowed = roles.flat();
    if (!mockTestUser) return res.status(401).json({ error: 'Authentication required' });
    if (!allowed.includes(mockTestUser.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  },
}));

const attendanceRouter = require('../src/routes/attendance');
const { pool } = require('../src/db/pool');

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRouter);

describe('Attendance Correction API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTestUser = { id: 'admin-uuid', role: 'admin' };
  });

  describe('POST /api/attendance/records/:recordId/correct', () => {
    test('should reject requests without authentication', async () => {
      mockTestUser = null;
      const res = await request(app)
        .post('/api/attendance/records/rec-123/correct')
        .send({ status: 'present', reason: 'Medical certificate provided' });
      expect(res.status).toBe(401);
    });

    test('should reject students from correcting attendance', async () => {
      mockTestUser = { id: 'student-uuid', role: 'student' };
      const res = await request(app)
        .post('/api/attendance/records/rec-123/correct')
        .send({ status: 'present', reason: 'Medical certificate provided' });
      expect(res.status).toBe(403);
    });

    test('should require a non-empty correction reason', async () => {
      const res = await request(app)
        .post('/api/attendance/records/rec-123/correct')
        .send({ status: 'present', reason: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reason is required/i);
    });

    test('should validate status is present or absent', async () => {
      const res = await request(app)
        .post('/api/attendance/records/rec-123/correct')
        .send({ status: 'invalid_status', reason: 'Medical excuse' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/must be present or absent/i);
    });

    test('should return 404 if record not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/attendance/records/rec-unknown/correct')
        .send({ status: 'present', reason: 'Medical excuse' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    test('should successfully correct record and save audit trail', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'rec-123',
              session_id: 'sess-1',
              student_id: 'stud-1',
              status: 'absent',
              original_status: null,
              faculty_id: 'faculty-uuid',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'rec-123',
              session_id: 'sess-1',
              student_id: 'stud-1',
              status: 'present',
              original_status: 'absent',
              corrected_by: 'admin-uuid',
              corrected_at: new Date().toISOString(),
              correction_reason: 'Medical certificate provided',
            },
          ],
        });

      const res = await request(app)
        .post('/api/attendance/records/rec-123/correct')
        .send({ status: 'present', reason: 'Medical certificate provided' });

      expect(res.status).toBe(200);
      expect(res.body.record).toBeDefined();
      expect(res.body.record.status).toBe('present');
      expect(res.body.record.original_status).toBe('absent');
      expect(res.body.record.correction_reason).toBe('Medical certificate provided');
      expect(res.body.record.corrected_by).toBe('admin-uuid');
    });
  });
});
