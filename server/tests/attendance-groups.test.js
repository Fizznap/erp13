const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');

jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate(req, _res, next) {
    req.user = { id: 'test-user', role: req.headers['x-role'] || 'faculty' };
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

describe('division and lab-group attendance scopes', () => {
  beforeEach(() => pool.query.mockReset());

  test('faculty cannot start a lab session for a group outside the offering division', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ subject_id: 'subject-1', branch_id: 'branch-1', batch_id: 'batch-1', division_id: 'division-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app).post('/api/attendance/start').send({
      subjectOfferingId: 'offering-1', sessionType: 'lab', academicLabGroupId: 'other-division-group',
      latitude: 19, longitude: 72,
    });

    expect(response.status).toBe(400);
    expect(pool.query.mock.calls[1][1]).toEqual(['other-division-group', 'branch-1', 'batch-1', 'division-1']);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO attendance_sessions'))).toBe(false);
  });

  test('a valid lab session is persisted with its group ID', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ subject_id: 'subject-1', branch_id: 'branch-1', batch_id: 'batch-1', division_id: 'division-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'group-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'session-1', academic_lab_group_id: 'group-1' }] });

    const response = await request(app).post('/api/attendance/start').send({
      subjectOfferingId: 'offering-1', sessionType: 'lab', academicLabGroupId: 'group-1',
      latitude: 19, longitude: 72,
    });

    expect(response.status).toBe(201);
    expect(response.body.session.academic_lab_group_id).toBe('group-1');
    expect(pool.query.mock.calls[3][1][2]).toBe('group-1');
  });

  test('a lab session denies a student assigned to another group before marking attendance', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 'session-1', is_active: true, academic_lab_group_id: 'group-1', active_nonce: 'ABC123', nonce_expires: new Date(Date.now() + 30000),
    }] })
      .mockResolvedValueOnce({ rows: [{ academic_class_id: 'class-1', academic_lab_group_id: 'group-2' }] });

    const response = await request(app).post('/api/attendance/mark').set('x-role', 'student').send({
      sessionId: 'session-1', nonce: 'ABC123', latitude: 19, longitude: 72,
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/lab group/i);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('attendance marking requires a nonce even when a session ID is provided', async () => {
    const response = await request(app).post('/api/attendance/mark').set('x-role', 'student').send({
      sessionId: 'session-1', latitude: 19, longitude: 72,
    });

    expect(response.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
