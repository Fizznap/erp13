const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../src/db/pool', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../src/middleware/auth', () => {
  const jwtModule = require('jsonwebtoken');
  return {
    authenticate: (req, res, next) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      try {
        req.user = jwtModule.verify(token, process.env.JWT_SECRET || 'test-secret');
        next();
      } catch {
        res.status(401).json({ error: 'Invalid token' });
      }
    },
    authorize: (...roles) => (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    },
  };
});

const adminRouter = require('../src/routes/admin');
const { pool: mockPool } = require('../src/db/pool');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

describe('Admin Faculty Creation API', () => {
  let adminToken, studentToken;
  const secret = process.env.JWT_SECRET || 'test-secret';

  beforeAll(() => {
    adminToken = jwt.sign({ id: 'admin-1', role: 'admin' }, secret);
    studentToken = jwt.sign({ id: 'student-1', role: 'student' }, secret);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects faculty creation from non-admin users with 403', async () => {
    const res = await request(app)
      .post('/api/admin/faculty')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        fullName: 'Dr. Alan Turing',
        email: 'alan.turing@ustu.edu.in',
        password: 'Password@123',
      });

    expect(res.status).toBe(403);
  });

  it('validates required fields (fullName, email, password)', async () => {
    const res = await request(app)
      .post('/api/admin/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: '',
        email: 'invalid-email',
        password: '123',
      });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate faculty email with 409 Conflict', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

    const res = await request(app)
      .post('/api/admin/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Dr. Grace Hopper',
        email: 'grace.hopper@ustu.edu.in',
        password: 'SecurePassword123',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already exists');
  });

  it('creates faculty account with role faculty and active status', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // duplicate check

    const mockClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'new-faculty-uuid',
              email: 'grace.hopper@ustu.edu.in',
              full_name: 'Dr. Grace Hopper',
              role: 'faculty',
              is_active: true,
              created_at: new Date(),
            },
          ],
        }) // INSERT INTO users
        .mockResolvedValueOnce({}) // INSERT user_profiles
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockClient);

    const res = await request(app)
      .post('/api/admin/faculty')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Dr. Grace Hopper',
        email: 'grace.hopper@ustu.edu.in',
        password: 'SecurePassword123',
        department: 'Computer Science',
      });

    expect(res.status).toBe(201);
    expect(res.body.faculty.role).toBe('faculty');
    expect(res.body.faculty.email).toBe('grace.hopper@ustu.edu.in');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });
});
