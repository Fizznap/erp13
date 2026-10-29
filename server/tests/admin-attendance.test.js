const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');

jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate(req, _res, next) {
    req.user = {
      id: req.headers['x-user-id'] || 'user-admin-1',
      role: req.headers['x-role'] || 'admin',
    };
    next();
  },
  authorize(...roles) {
    return (req, res, next) => roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'Insufficient permissions' });
  },
}));

const app = express();
app.use(express.json());
app.use('/api/attendance', require('../src/routes/attendance'));

describe('Admin and Faculty Attendance Authorization', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  describe('Administrator starting attendance', () => {
    test('admin can start attendance session for any configured subject offering', async () => {
      // 1. Offering lookup by admin (no faculty_id restriction in query)
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            subject_id: 'subj-1',
            faculty_id: 'faculty-teacher-99',
            branch_id: 'branch-cse',
            batch_id: 'batch-2024',
            division_id: 'div-a',
          }],
        })
        // 2. End existing active sessions
        .mockResolvedValueOnce({ rows: [] })
        // 3. Insert new attendance session
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-admin-101',
            subject_id: 'subj-1',
            subject_offering_id: 'offering-1',
            faculty_id: 'faculty-teacher-99',
            latitude: 19.076,
            longitude: 72.877,
            radius_meters: 50,
            active_nonce: 'A1B2C3',
            nonce_expires: new Date(Date.now() + 30000).toISOString(),
            is_active: true,
          }],
        });

      const response = await request(app)
        .post('/api/attendance/start')
        .set('x-role', 'admin')
        .set('x-user-id', 'admin-user-1')
        .send({
          subjectOfferingId: 'offering-1',
          sessionType: 'lecture',
          latitude: 19.076,
          longitude: 72.877,
          radiusMeters: 50,
        });

      expect(response.status).toBe(201);
      expect(response.body.session).toBeDefined();
      expect(response.body.session.id).toBe('session-admin-101');
      expect(response.body.session.active_nonce).toBe('A1B2C3');
      expect(response.body.session.is_active).toBe(true);

      // Verify the query did not restrict to req.user.id for admin
      const offeringCall = pool.query.mock.calls[0];
      expect(offeringCall[0]).not.toContain('so.faculty_id = $2');
      expect(offeringCall[1]).toEqual(['offering-1']);
    });

    test('admin can retrieve current/rotated nonce for any active session', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'session-admin-101',
          active_nonce: 'D4E5F6',
          nonce_expires: new Date(Date.now() + 25000).toISOString(),
          is_active: true,
        }],
      });

      const response = await request(app)
        .get('/api/attendance/session-admin-101/nonce')
        .set('x-role', 'admin')
        .set('x-user-id', 'admin-user-1');

      expect(response.status).toBe(200);
      expect(response.body.nonce).toBe('D4E5F6');
      expect(response.body.expiresAt).toBeDefined();
    });

    test('admin can end an active attendance session', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 'session-admin-101',
          is_active: false,
          ended_at: new Date().toISOString(),
        }],
      });

      const response = await request(app)
        .post('/api/attendance/session-admin-101/end')
        .set('x-role', 'admin')
        .set('x-user-id', 'admin-user-1');

      expect(response.status).toBe(200);
      expect(response.body.session.is_active).toBe(false);
    });
  });

  describe('Faculty restrictions', () => {
    test('faculty can start session for their own offering', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            subject_id: 'subj-1',
            faculty_id: 'faculty-teacher-1',
            branch_id: 'branch-cse',
            batch_id: 'batch-2024',
            division_id: 'div-a',
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-fac-1',
            subject_id: 'subj-1',
            faculty_id: 'faculty-teacher-1',
            active_nonce: 'F1A2B3',
            is_active: true,
          }],
        });

      const response = await request(app)
        .post('/api/attendance/start')
        .set('x-role', 'faculty')
        .set('x-user-id', 'faculty-teacher-1')
        .send({
          subjectOfferingId: 'offering-own',
          sessionType: 'lecture',
          latitude: 19.076,
          longitude: 72.877,
        });

      expect(response.status).toBe(201);
      const offeringCall = pool.query.mock.calls[0];
      expect(offeringCall[0]).toContain('so.faculty_id = $2');
      expect(offeringCall[1]).toEqual(['offering-own', 'faculty-teacher-1']);
    });

    test('faculty cannot start session for offering owned by another faculty', async () => {
      // Return empty rows because so.faculty_id = $2 doesn't match
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/attendance/start')
        .set('x-role', 'faculty')
        .set('x-user-id', 'faculty-teacher-2')
        .send({
          subjectOfferingId: 'offering-other',
          sessionType: 'lecture',
          latitude: 19.076,
          longitude: 72.877,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('You do not own this subject offering');
    });

    test('faculty cannot fetch nonce for a session they do not own', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/attendance/session-other/nonce')
        .set('x-role', 'faculty')
        .set('x-user-id', 'faculty-teacher-2');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });

    test('faculty cannot end a session they do not own', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/attendance/session-other/end')
        .set('x-role', 'faculty')
        .set('x-user-id', 'faculty-teacher-2');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Active session not found');
    });
  });

  describe('Student restrictions', () => {
    test('student cannot call /api/attendance/start', async () => {
      const response = await request(app)
        .post('/api/attendance/start')
        .set('x-role', 'student')
        .send({
          subjectOfferingId: 'offering-1',
          latitude: 19.076,
          longitude: 72.877,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Insufficient permissions');
    });

    test('student cannot call /api/attendance/:sessionId/nonce', async () => {
      const response = await request(app)
        .get('/api/attendance/session-1/nonce')
        .set('x-role', 'student');

      expect(response.status).toBe(403);
    });

    test('student cannot call /api/attendance/:sessionId/end', async () => {
      const response = await request(app)
        .post('/api/attendance/session-1/end')
        .set('x-role', 'student');

      expect(response.status).toBe(403);
    });

    test('student cannot mark attendance for an offering of an unrelated division/class', async () => {
      // 1. Session lookup: active session
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-div-b',
            subject_id: 'subj-1',
            subject_offering_id: 'offering-div-b',
            active_nonce: 'SEC123',
            nonce_expires: new Date(Date.now() + 30000).toISOString(),
            latitude: 19.076,
            longitude: 72.877,
            radius_meters: 50,
          }],
        })
        // 2. Student class lookup: student is in Division A
        .mockResolvedValueOnce({
          rows: [{
            academic_class_id: 'class-div-a',
            academic_lab_group_id: null,
            branch_id: 'branch-cse',
            batch_id: 'batch-2024',
            division_id: 'div-a',
          }],
        })
        // 3. Offering enrollment check: checks if offering belongs to student's division (A)
        // returns empty rows because offering is for Division B
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/attendance/mark')
        .set('x-role', 'student')
        .set('x-user-id', 'student-div-a')
        .send({
          sessionId: 'session-div-b',
          nonce: 'SEC123',
          latitude: 19.076,
          longitude: 72.877,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('You are not enrolled in this offering');
    });
  });
});
