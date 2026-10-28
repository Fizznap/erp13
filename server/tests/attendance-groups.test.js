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

  test.each([
    [91, 72],
    [19, 181],
    ['19', 72],
  ])('attendance marking rejects invalid coordinates (%s, %s) before database access', async (latitude, longitude) => {
    const response = await request(app).post('/api/attendance/mark').set('x-role', 'student').send({
      sessionId: 'session-1', nonce: 'ABC123', latitude, longitude,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/valid numeric coordinates/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('faculty cannot create a session with invalid coordinates or an excessive radius', async () => {
    const response = await request(app).post('/api/attendance/start').send({
      subjectOfferingId: 'offering-1', latitude: 19, longitude: 72, radiusMeters: 1001,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/radius/i);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('faculty can view a division roster with absent students included', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 'session-1', faculty_id: 'test-user', subject_offering_id: 'offering-1',
      branch_id: 'branch-1', batch_id: 'batch-1', division_id: 'division-1', academic_lab_group_id: null,
    }] }).mockResolvedValueOnce({ rows: [
      { student_id: 'student-1', full_name: 'Present Student', status: 'present' },
      { student_id: 'student-2', full_name: 'Absent Student', status: 'absent' },
    ] });

    const response = await request(app).get('/api/attendance/session-1/roster');

    expect(response.status).toBe(200);
    expect(response.body.students.map((student) => student.status)).toEqual(['present', 'absent']);
    expect(pool.query.mock.calls[1][0]).toContain('LEFT JOIN attendance_records');
    expect(pool.query.mock.calls[1][1]).toEqual(['session-1', 'branch-1', 'batch-1', 'division-1', null]);
  });

  test('faculty cannot see or edit a session owned by another faculty member', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 'session-1', faculty_id: 'another-faculty', subject_offering_id: 'offering-1',
      branch_id: 'branch-1', batch_id: 'batch-1', division_id: 'division-1', academic_lab_group_id: null,
    }] });

    const response = await request(app).get('/api/attendance/session-1/roster');

    expect(response.status).toBe(403);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('faculty can correct attendance for a student in the session class', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      id: 'session-1', faculty_id: 'test-user', subject_offering_id: 'offering-1',
      branch_id: 'branch-1', batch_id: 'batch-1', division_id: 'division-1', academic_lab_group_id: null,
    }] }).mockResolvedValueOnce({ rows: [{ id: 'student-1' }] })
      .mockResolvedValueOnce({ rows: [{ student_id: 'student-1', status: 'present' }] });

    const response = await request(app).put('/api/attendance/session-1/roster/student-1').send({ status: 'present' });

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[1][1]).toEqual(['student-1', 'branch-1', 'batch-1', 'division-1', null]);
    expect(pool.query.mock.calls[2][0]).toContain("verification_method = 'faculty_manual'");
  });

  test('manual attendance rejects unsupported statuses', async () => {
    const response = await request(app).put('/api/attendance/session-1/roster/student-1').send({ status: 'admin' });
    expect(response.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
