const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../src/db/pool');
const { verifyGoogleIdToken } = require('../src/services/googleIdentity');
const { makeVerificationToken, sendVerificationEmail } = require('../src/services/emailVerification');

jest.mock('../src/db/pool', () => ({
  pool: { query: jest.fn() },
}));

jest.mock('../src/services/googleIdentity', () => ({
  verifyGoogleIdToken: jest.fn(),
  GoogleIdentityConfigurationError: class GoogleIdentityConfigurationError extends Error {},
}));

jest.mock('../src/services/emailVerification', () => ({
  makeVerificationToken: jest.fn(() => ({ token: 'a'.repeat(64), tokenHash: 'hashed-verification-token' })),
  sendVerificationEmail: jest.fn(),
  EmailDeliveryConfigurationError: class EmailDeliveryConfigurationError extends Error {},
}));

const app = express();
app.use(express.json());
app.use('/api/auth', require('../src/routes/auth'));
app.get('/api/protected', require('../src/middleware/auth').authenticate, (req, res) => {
  res.json({ user: req.user });
});

function makeUser(overrides = {}) {
  return {
    id: 'college-user-id',
    email: 'student@ustu.edu.in',
    password_hash: bcrypt.hashSync('password123', 4),
    full_name: 'College Student',
    role: 'student',
    is_active: true,
    email_verified: true,
    academic_class_id: null,
    created_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('college-domain authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
  });

  test('registration normalizes college email, forces student role, and sends email verification without issuing tokens', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUser({ email: 'student@ustu.edu.in', role: 'student' })] });

    const response = await request(app).post('/api/auth/register').send({
      email: '  Student@USTU.EDU.IN  ',
      password: 'password123',
      fullName: 'College Student',
      role: 'admin',
    });

    expect(response.status).toBe(202);
    expect(response.body.message).toMatch(/verification/i);
    expect(pool.query.mock.calls[0][1]).toEqual(['student@ustu.edu.in']);
    expect(pool.query.mock.calls[1][1][3]).toBe('hashed-verification-token');
    expect(pool.query.mock.calls[1][0]).toContain("'student', false");
    expect(sendVerificationEmail).toHaveBeenCalledWith('student@ustu.edu.in', 'College Student', 'a'.repeat(64));
    expect(response.body.accessToken).toBeUndefined();
  });

  test('email verification consumes the hashed, one-time token', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'college-user-id' }] });
    const token = 'b'.repeat(64);

    const response = await request(app).post('/api/auth/verify-email').send({ token });

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual([crypto.createHash('sha256').update(token).digest('hex'), '@ustu.edu.in']);
    expect(pool.query.mock.calls[0][0]).toContain('email_verified = true');
  });

  test.each([
    'student@gmail.com',
    'student@sub.ustu.edu.in',
    'student@ustu.edu.in.example.com',
    'student@ustu.edu.in.evil',
  ])('registration rejects non-college domain %s before database access', async (email) => {
    const response = await request(app).post('/api/auth/register').send({
      email,
      password: 'password123',
      fullName: 'Someone',
      role: 'student',
    });

    expect(response.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
    expect(response.body.accessToken).toBeUndefined();
  });

  test('password login normalizes email and issues a session for an eligible existing account', async () => {
    pool.query.mockResolvedValueOnce({ rows: [makeUser()] });
    const response = await request(app).post('/api/auth/login').send({
      email: ' STUDENT@USTU.EDU.IN ',
      password: 'password123',
    });

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual(['student@ustu.edu.in']);
    expect(response.body.user.email).toBe('student@ustu.edu.in');
    expect(response.body.accessToken).toBeTruthy();
  });

  test('password login rejects non-college and legacy non-college accounts without querying users', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'legacy@gmail.com',
      password: 'password123',
    });

    expect(response.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
    expect(response.body.accessToken).toBeUndefined();
  });

  test('password login rejects an existing college account until its email is verified', async () => {
    pool.query.mockResolvedValueOnce({ rows: [makeUser({ email_verified: false })] });

    const response = await request(app).post('/api/auth/login').send({
      email: 'student@ustu.edu.in',
      password: 'password123',
    });

    expect(response.status).toBe(403);
    expect(response.body.accessToken).toBeUndefined();
  });

  test('refresh rejects an existing non-college account without issuing tokens', async () => {
    const refreshToken = jwt.sign({ id: 'legacy-user-id', type: 'refresh' }, process.env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [makeUser({ email: 'legacy@gmail.com' })] });

    const response = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(response.status).toBe(403);
    expect(response.body.accessToken).toBeUndefined();
  });

  test('refresh rejects an existing college account whose email is still unverified', async () => {
    const refreshToken = jwt.sign({ id: 'college-user-id', type: 'refresh' }, process.env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [makeUser({ email_verified: false })] });

    const response = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(response.status).toBe(403);
    expect(response.body.accessToken).toBeUndefined();
  });

  test('Google sign-in verifies the token before looking up or creating an account', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({ email: 'new@ustu.edu.in', fullName: 'New Student' });
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUser({ email: 'new@ustu.edu.in', full_name: 'New Student' })] });

    const response = await request(app).post('/api/auth/google').send({ credential: 'signed-google-id-token' });

    expect(verifyGoogleIdToken).toHaveBeenCalledWith('signed-google-id-token');
    expect(pool.query.mock.calls[0][1]).toEqual(['new@ustu.edu.in']);
    expect(pool.query.mock.calls[1][1][0]).toBe('new@ustu.edu.in');
    expect(pool.query.mock.calls[1][1][2]).toBe('New Student');
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('student');
    expect(response.body.accessToken).toBeTruthy();
  });

  test('Google sign-in preserves the role and data of an existing college account', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({ email: 'faculty@ustu.edu.in', fullName: 'Faculty' });
    pool.query.mockResolvedValueOnce({ rows: [makeUser({
      email: 'faculty@ustu.edu.in', role: 'faculty', full_name: 'Faculty',
    })] });

    const response = await request(app).post('/api/auth/google').send({ credential: 'verified-token' });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('faculty');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('Google verification rejection never queries the database or returns tokens', async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(new Error('bad signature or claim'));

    const response = await request(app).post('/api/auth/google').send({ credential: 'invalid-token' });

    expect(response.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
    expect(response.body.accessToken).toBeUndefined();
  });

  test('protected endpoints use the database account and block existing non-college users', async () => {
    const token = jwt.sign({ id: 'legacy-user-id', email: 'legacy@gmail.com', role: 'admin' }, process.env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [makeUser({ email: 'legacy@gmail.com', role: 'admin' })] });

    const rejected = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);

    expect(rejected.status).toBe(401);
    expect(rejected.body.user).toBeUndefined();

    pool.query.mockResolvedValueOnce({ rows: [makeUser({ email_verified: false })] });
    const unverified = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);
    expect(unverified.status).toBe(401);

    pool.query.mockResolvedValueOnce({ rows: [makeUser({ role: 'student' })] });
    const accepted = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);

    expect(accepted.status).toBe(200);
    expect(accepted.body.user.role).toBe('student');
    expect(accepted.body.user.email).toBe('student@ustu.edu.in');
  });

  test('protected endpoints do not accept access tokens in query strings', async () => {
    const token = jwt.sign({ id: 'college-user-id' }, process.env.JWT_SECRET);
    const response = await request(app).get(`/api/protected?token=${token}`);

    expect(response.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
