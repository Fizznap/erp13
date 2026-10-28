const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');

jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate(req, _res, next) {
    req.user = { id: 'student-1', role: req.headers['x-role'] || 'student' };
    next();
  },
  authorize(...roles) {
    return (req, res, next) => roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'Insufficient permissions' });
  },
}));

const app = express();
app.use('/api/attendance', require('../src/routes/attendance'));

describe('student attendance history', () => {
  beforeEach(() => pool.query.mockReset());

  test('returns every completed eligible session when all were attended', async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { id: 'session-2', session_id: 'session-2', subject_id: 'subject-1', subject_name: 'Networks', status: 'present' },
      { id: 'session-1', session_id: 'session-1', subject_id: 'subject-1', subject_name: 'Networks', status: 'present' },
    ] });

    const response = await request(app).get('/api/attendance/my/records').set('x-role', 'student');

    expect(response.status).toBe(200);
    expect(response.body.records).toHaveLength(2);
    expect(response.body.records.map(({ status }) => status)).toEqual(['present', 'present']);
    expect(pool.query.mock.calls[0][1]).toEqual(['student-1']);
  });

  test('returns no-row and explicit absent sessions as absent alongside present sessions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { id: 'session-present', session_id: 'session-present', subject_id: 'subject-1', subject_name: 'Networks', status: 'present', attendance_record_id: 'record-1' },
      { id: 'session-no-row', session_id: 'session-no-row', subject_id: 'subject-1', subject_name: 'Networks', status: 'absent', attendance_record_id: null },
      { id: 'session-absent', session_id: 'session-absent', subject_id: 'subject-1', subject_name: 'Networks', status: 'absent', attendance_record_id: 'record-2' },
    ] });

    const response = await request(app).get('/api/attendance/my/records').set('x-role', 'student');

    expect(response.status).toBe(200);
    expect(response.body.records.map(({ status }) => status)).toEqual(['present', 'absent', 'absent']);
    expect(response.body.records.find(({ session_id }) => session_id === 'session-no-row').attendance_record_id).toBeNull();
  });

  test('SQL excludes active/unclosed sessions and sessions outside class or lab-group eligibility', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get('/api/attendance/my/records').set('x-role', 'student');
    const sql = pool.query.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(sql).toContain('a.is_active = false AND a.ended_at IS NOT NULL');
    expect(sql).toContain('a.academic_lab_group_id IS NULL OR p.academic_lab_group_id = a.academic_lab_group_id');
    expect(sql).toContain('offered_class.branch_id = student_class.branch_id');
    expect(sql).toContain('offered_class.batch_id = student_class.batch_id');
    expect(sql).toContain('offered_class.division_id = student_class.division_id');
  });

  test('returns an empty history safely when the student has no eligible completed sessions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get('/api/attendance/my/records').set('x-role', 'student');

    expect(response.status).toBe(200);
    expect(response.body.records).toEqual([]);
  });

  test('selects at most one attendance row per session if duplicate rows exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { id: 'session-1', session_id: 'session-1', attendance_record_id: 'newest-record', status: 'present' },
    ] });

    const response = await request(app).get('/api/attendance/my/records').set('x-role', 'student');
    const sql = pool.query.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(response.body.records).toHaveLength(1);
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('ORDER BY r.marked_at DESC, r.id DESC');
    expect(sql).toContain('LIMIT 1');
  });

  test('supports subject-offering filtering without changing student scope', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app).get('/api/attendance/my/records?subjectOfferingId=offering-1').set('x-role', 'student');

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toContain('a.subject_offering_id = $2');
    expect(pool.query.mock.calls[0][1]).toEqual(['student-1', 'offering-1']);
  });
});
