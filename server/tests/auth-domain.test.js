const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../src/db/pool');
const { verifyGoogleIdToken } = require('../src/services/googleIdentity');
const { makeVerificationToken, sendVerificationEmail } = require('../src/services/emailVerification');

jest.mock('../src/db/pool', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  return { pool: { query: jest.fn(), connect: jest.fn(async () => client), __client: client } };
});

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
    academic_class_id: 'configured-class',
    college_id: 'USTU-1001',
    program: 'Engineering',
    roll_number: 'CSE-01',
    year_of_study: 2,
    admission_year: 2024,
    expected_graduation_year: 2028,
    created_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('college-domain authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
    pool.__client.query.mockReset();
    pool.__client.release.mockReset();
    process.env.JWT_SECRET = 'test-secret';
    pool.__client.query.mockResolvedValue({ rows: [] });
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
    pool.query
      .mockResolvedValueOnce({ rows: [makeUser()] })
      .mockResolvedValueOnce({ rows: [makeUser()] });
    const response = await request(app).post('/api/auth/login').send({
      email: ' STUDENT@USTU.EDU.IN ',
      password: 'password123',
    });

    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual(['student@ustu.edu.in']);
    expect(response.body.user.email).toBe('student@ustu.edu.in');
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.requiresOnboarding).toBe(false);
  });

  test('existing incomplete college accounts receive only a restricted onboarding token', async () => {
    const incomplete = makeUser({ college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null });
    pool.query.mockResolvedValueOnce({ rows: [incomplete] }).mockResolvedValueOnce({ rows: [incomplete] });
    const response = await request(app).post('/api/auth/login').send({ email: incomplete.email, password: 'password123' });
    expect(response.status).toBe(200);
    expect(response.body.requiresOnboarding).toBe(true);
    expect(response.body.refreshToken).toBeNull();
    expect(jwt.verify(response.body.accessToken, process.env.JWT_SECRET).purpose).toBe('onboarding');
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
    verifyGoogleIdToken.mockResolvedValueOnce({ email: 'new@ustu.edu.in', fullName: 'New Student', subject: 'google-subject', picture: null });
    pool.__client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUser({ email: 'new@ustu.edu.in', full_name: 'New Student', college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null })] });
    pool.query.mockResolvedValueOnce({ rows: [makeUser({ email: 'new@ustu.edu.in', full_name: 'New Student', college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null })] });

    const response = await request(app).post('/api/auth/google').send({ credential: 'signed-google-id-token' });

    expect(verifyGoogleIdToken).toHaveBeenCalledWith('signed-google-id-token');
    expect(pool.__client.query.mock.calls[2][1]).toEqual(['new@ustu.edu.in']);
    expect(pool.__client.query.mock.calls[3][1][0]).toBe('new@ustu.edu.in');
    expect(pool.__client.query.mock.calls[3][1][2]).toBe('New Student');
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('student');
    expect(response.body.requiresOnboarding).toBe(true);
    expect(response.body.refreshToken).toBeNull();
    expect(jwt.verify(response.body.accessToken, process.env.JWT_SECRET).purpose).toBe('onboarding');
  });

  test('Google sign-in preserves the role and data of an existing college account', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({ email: 'faculty@ustu.edu.in', fullName: 'Faculty', subject: 'faculty-subject', picture: null });
    pool.__client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUser({
      email: 'faculty@ustu.edu.in', role: 'faculty', full_name: 'Faculty',
    })] });
    pool.query.mockResolvedValueOnce({ rows: [makeUser({ email: 'faculty@ustu.edu.in', role: 'faculty', full_name: 'Faculty' })] });

    const response = await request(app).post('/api/auth/google').send({ credential: 'verified-token' });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('faculty');
    expect(pool.__client.query).toHaveBeenCalled();
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

  test('protected endpoints deny incomplete students while the profile endpoint accepts the restricted token', async () => {
    const incomplete = makeUser({ college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null });
    const restricted = jwt.sign({ id: incomplete.id, purpose: 'onboarding' }, process.env.JWT_SECRET, { expiresIn: '30m' });
    const blocked = await request(app).get('/api/protected').set('Authorization', `Bearer ${restricted}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PROFILE_INCOMPLETE');

    pool.query.mockResolvedValueOnce({ rows: [incomplete] }).mockResolvedValueOnce({ rows: [incomplete] });
    const profile = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${restricted}`);
    expect(profile.status).toBe(200);
    expect(profile.body.requiresOnboarding).toBe(true);
    expect(profile.body.user.email).toBe(incomplete.email);
  });

  test('the onboarding token cannot refresh into a normal session', async () => {
    const refreshToken = jwt.sign({ id: 'college-user-id', type: 'refresh' }, process.env.JWT_SECRET);
    const incomplete = makeUser({ college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null });
    pool.query.mockResolvedValueOnce({ rows: [incomplete] }).mockResolvedValueOnce({ rows: [incomplete] });
    const response = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(response.status).toBe(403);
    expect(response.body.accessToken).toBeUndefined();
  });

  test('onboarding rejects a class ID that is not present in the academic hierarchy', async () => {
    const incomplete = makeUser({ college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null });
    const token = jwt.sign({ id: incomplete.id, purpose: 'onboarding' }, process.env.JWT_SECRET, { expiresIn: '30m' });
    pool.query.mockResolvedValueOnce({ rows: [incomplete] });
    const response = await request(app).post('/api/auth/complete-profile').set('Authorization', `Bearer ${token}`).send({
      rollNumber: 'UST24R0102085', yearOfStudy: 3,
      expectedGraduationYear: 2028, academicClassId: 'invented-class', academicBranchId: 'branch-id',
      academicDivisionId: 'division-id', academicLabGroupId: 'lab-group', userId: 'another-user',
    });
    expect(response.status).toBe(400);
    expect(response.body.accessToken).toBeUndefined();
    expect(pool.__client.query.mock.calls.some(([sql, params]) => String(sql).includes('JOIN branches') && params[0] === 'invented-class')).toBe(true);
  });

  test('onboarding rejects malformed roll numbers without creating a session', async () => {
    const incomplete = makeUser({ college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null });
    const token = jwt.sign({ id: incomplete.id, purpose: 'onboarding' }, process.env.JWT_SECRET, { expiresIn: '30m' });
    pool.query.mockResolvedValueOnce({ rows: [incomplete] });
    const response = await request(app).post('/api/auth/complete-profile').set('Authorization', `Bearer ${token}`).send({
      rollNumber: 'UST24L0102085', yearOfStudy: 3, expectedGraduationYear: 2028, academicClassId: 'class-id',
      academicBranchId: 'branch-id', academicDivisionId: 'division-id', academicLabGroupId: 'lab-group',
    });
    expect(response.status).toBe(400);
    expect(response.body.accessToken).toBeUndefined();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('onboarding rejects a class from a different branch than the roll number', async () => {
    const incomplete = makeUser({ college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null });
    const token = jwt.sign({ id: incomplete.id, purpose: 'onboarding' }, process.env.JWT_SECRET, { expiresIn: '30m' });
    pool.query.mockResolvedValueOnce({ rows: [incomplete] });
    pool.__client.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'class-id', branch_code: 'BTECH-AIML', start_year: 2024, branch_id: 'branch-id', division_id: 'division-id' }] });
    const response = await request(app).post('/api/auth/complete-profile').set('Authorization', `Bearer ${token}`).send({
      rollNumber: 'UST24R0102085', yearOfStudy: 3, expectedGraduationYear: 2028, academicClassId: 'class-id',
      academicBranchId: 'branch-id', academicDivisionId: 'division-id', academicLabGroupId: 'lab-group',
    });
    expect(response.status).toBe(400);
    expect(response.body.accessToken).toBeUndefined();
    expect(pool.__client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('onboarding derives PRN, program, and batch from the roll number instead of trusting the browser', async () => {
    const incomplete = makeUser({ college_id: null, program: null, roll_number: null, year_of_study: null, admission_year: null, expected_graduation_year: null, academic_class_id: null });
    const complete = makeUser({
      college_id: 'UST24R0102085', program: 'B.Tech', roll_number: 'UST24R0102085',
      year_of_study: 3, admission_year: 2024, expected_graduation_year: 2028, academic_class_id: 'class-id',
    });
    const token = jwt.sign({ id: incomplete.id, purpose: 'onboarding' }, process.env.JWT_SECRET, { expiresIn: '30m' });
    pool.query.mockResolvedValueOnce({ rows: [incomplete] }).mockResolvedValueOnce({ rows: [complete] });
    pool.__client.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'class-id', branch_code: 'BTECH-CSE', start_year: 2024, semester_number: 5, branch_id: 'branch-id', batch_id: 'batch-id', division_id: 'division-id' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lab-group' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(app).post('/api/auth/complete-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rollNumber: ' ust24r0102085 ', yearOfStudy: 3, expectedGraduationYear: 2028,
        academicClassId: 'class-id', academicBranchId: 'branch-id', academicDivisionId: 'division-id',
        academicLabGroupId: 'lab-group', collegeId: 'ATTACKER-ID', program: 'Admin', admissionYear: 2001,
      });

    expect(response.status).toBe(200);
    expect(response.body.requiresOnboarding).toBe(false);
    const profileInsert = pool.__client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_profiles'));
    expect(profileInsert[1]).toEqual([
      incomplete.id, null, 'UST24R0102085', 'B.Tech', 'UST24R0102085', 3, 2024, 2028,
      null, null, [], [], [], null, null, null, 'lab-group',
    ]);
  });

  test('profile endpoints reject browser-supplied role and email changes', async () => {
    const accessToken = jwt.sign({ id: 'college-user-id' }, process.env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [makeUser()] });
    const response = await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).send({
      email: 'attacker@ustu.edu.in', role: 'admin', rollNumber: 'UST24R0102085', collegeId: 'UST24R0102085',
    });
    expect(response.status).toBe(400);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('profile writes stay scoped to the authenticated user even if a different ID is supplied', async () => {
    const accessToken = jwt.sign({ id: 'college-user-id' }, process.env.JWT_SECRET);
    pool.query
      .mockResolvedValueOnce({ rows: [makeUser()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [makeUser({ full_name: 'Updated Name' })] });
    const response = await request(app).patch('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ fullName: 'Updated Name', userId: 'some-other-user' });
    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[1][1]).toEqual(['Updated Name', 'college-user-id']);
    expect(JSON.stringify(pool.query.mock.calls[1])).not.toContain('some-other-user');
  });

  test('profile photo upload validates image bytes and stores the file against the signed-in user', async () => {
    const accessToken = jwt.sign({ id: 'college-user-id' }, process.env.JWT_SECRET);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    pool.query.mockResolvedValueOnce({ rows: [makeUser()] }).mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .put('/api/auth/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', jpeg, { filename: 'profile.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.body.hasUploadedPhoto).toBe(true);
    expect(pool.query.mock.calls[1][0]).toContain('INSERT INTO user_avatars');
    expect(pool.query.mock.calls[1][1]).toEqual(['college-user-id', 'image/jpeg', jpeg]);
  });

  test('profile photo upload rejects a spoofed image extension without storing it', async () => {
    const accessToken = jwt.sign({ id: 'college-user-id' }, process.env.JWT_SECRET);
    pool.query.mockResolvedValueOnce({ rows: [makeUser()] });

    const response = await request(app)
      .put('/api/auth/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'profile.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(415);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('protected endpoints do not accept access tokens in query strings', async () => {
    const token = jwt.sign({ id: 'college-user-id' }, process.env.JWT_SECRET);
    const response = await request(app).get(`/api/protected?token=${token}`);

    expect(response.status).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
