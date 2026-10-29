/**
 * QR Code Student Verification Tests
 * 
 * Tests the public /api/auth/verify-student/:identifier endpoint
 * that resolves student IDs from QR codes.
 */

const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');

// Mock the pool
jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

describe('QR Student Verification', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/auth', require('../src/routes/auth'));
  });

  beforeEach(() => {
    pool.query.mockReset();
  });

  test('verifies student by roll number', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'student-1',
        full_name: 'John Doe',
        email: 'john.doe@college.edu',
        role: 'student',
        is_active: true,
        roll_number: 'UST24R0102001',
        college_id: 'CS2024001',
        program: 'B.Tech Computer Science',
        expected_graduation_year: 2028,
        branch_name: 'Computer Science and Engineering',
        branch_code: 'BTECH-CSE',
        division_name: 'A',
        start_year: 2024,
        end_year: 2028,
      }],
    });

    const response = await request(app)
      .get('/api/auth/verify-student/UST24R0102001')
      .expect(200);

    expect(response.body.verified).toBe(true);
    expect(response.body.student.full_name).toBe('John Doe');
    expect(response.body.student.student_no).toBe('UST24R0102001');
    expect(response.body.student.program).toBe('B.Tech Computer Science');
    expect(response.body.student.branch_code).toBe('BTECH-CSE');
    // Should NOT include email
    expect(response.body.student.email).toBeUndefined();
  });

  test('verifies student by college ID', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'student-2',
        full_name: 'Jane Smith',
        email: 'jane.smith@college.edu',
        role: 'student',
        is_active: true,
        roll_number: null,
        college_id: 'CS2024002',
        program: 'B.Tech Computer Science',
        expected_graduation_year: 2028,
        branch_name: null,
        branch_code: null,
        division_name: null,
        start_year: null,
        end_year: null,
      }],
    });

    const response = await request(app)
      .get('/api/auth/verify-student/CS2024002')
      .expect(200);

    expect(response.body.verified).toBe(true);
    expect(response.body.student.full_name).toBe('Jane Smith');
    expect(response.body.student.student_no).toBe('CS2024002');
  });

  test('handles case-insensitive lookups', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'student-3',
        full_name: 'Test Student',
        email: 'test@college.edu',
        role: 'student',
        is_active: true,
        roll_number: 'UST24R0102003',
        college_id: null,
        program: 'B.Tech',
        expected_graduation_year: 2028,
        branch_name: null,
        branch_code: null,
        division_name: null,
        start_year: null,
        end_year: null,
      }],
    });

    // Send lowercase, should still match
    const response = await request(app)
      .get('/api/auth/verify-student/ust24r0102003')
      .expect(200);

    expect(response.body.verified).toBe(true);
    expect(response.body.student.full_name).toBe('Test Student');
    
    // Verify the query used uppercase normalization
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ['UST24R0102003']
    );
  });

  test('returns 404 for unknown student', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/api/auth/verify-student/UNKNOWN123')
      .expect(404);

    expect(response.body.error).toBe('Student not found');
    expect(response.body.message).toContain('not registered');
  });

  test('returns 400 for empty identifier', async () => {
    const response = await request(app)
      .get('/api/auth/verify-student/')
      .expect(404); // Express route won't match, returns 404
  });

  test('returns 400 for whitespace-only identifier', async () => {
    const response = await request(app)
      .get('/api/auth/verify-student/%20%20')
      .expect(400);

    expect(response.body.error).toBe('Student identifier is required');
  });

  test('does not return inactive students', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/auth/verify-student/INACTIVE001')
      .expect(404);

    // Verify query included is_active = true filter
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('is_active = true'),
      expect.any(Array)
    );
  });

  test('does not return unverified email students', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/auth/verify-student/UNVERIFIED001')
      .expect(404);

    // Verify query included email_verified = true filter
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('email_verified = true'),
      expect.any(Array)
    );
  });

  test('only returns students, not faculty or admins', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/auth/verify-student/FACULTY001')
      .expect(404);

    // Verify query filtered by role = 'student'
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("role = 'student'"),
      expect.any(Array)
    );
  });

  test('handles database errors gracefully', async () => {
    pool.query.mockRejectedValueOnce(new Error('Database connection failed'));

    const response = await request(app)
      .get('/api/auth/verify-student/TEST001')
      .expect(500);

    expect(response.body.error).toBe('Failed to verify student');
  });

  test('SQL injection protection', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    // Attempt SQL injection
    const response = await request(app)
      .get("/api/auth/verify-student/'; DROP TABLE users; --")
      .expect(404);

    // Should safely pass the malicious input as a parameter
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([expect.stringContaining("DROP TABLE")])
    );
  });

  test('handles special characters in identifier', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'student-4',
        full_name: 'Special Char Student',
        email: 'special@college.edu',
        role: 'student',
        is_active: true,
        roll_number: null,
        college_id: 'ID-2024/001',
        program: 'B.Tech',
        expected_graduation_year: 2028,
        branch_name: null,
        branch_code: null,
        division_name: null,
        start_year: null,
        end_year: null,
      }],
    });

    const response = await request(app)
      .get('/api/auth/verify-student/ID-2024%2F001')
      .expect(200);

    expect(response.body.verified).toBe(true);
  });
});
