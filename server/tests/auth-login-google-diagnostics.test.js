const request = require('supertest');
const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

// Mock pool
const mockUsers = new Map();
const mockProfiles = new Map();
const mockIdentities = new Map();

jest.mock('../src/db/pool', () => {
  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const lowerSql = sql.toLowerCase();

      // SELECT from users by lower(trim(email))
      if (lowerSql.includes('from users') && lowerSql.includes('lower(trim(email)) = $1')) {
        const email = (params[0] || '').toLowerCase().trim();
        const user = mockUsers.get(email);
        return { rows: user ? [user] : [] };
      }

      // SELECT from users by id
      if (lowerSql.includes('from users') && lowerSql.includes('id = $1')) {
        for (const user of mockUsers.values()) {
          if (user.id === params[0]) return { rows: [user] };
        }
        return { rows: [] };
      }

      // loadProfile query
      if (lowerSql.includes('left join user_profiles')) {
        for (const user of mockUsers.values()) {
          if (user.id === params[0]) {
            return {
              rows: [{
                ...user,
                registration_completed_at: new Date(),
                preferred_name: user.full_name,
                has_uploaded_photo: true,
                branch_name: 'CS',
                division_name: 'A',
                semester_number: 1,
              }],
            };
          }
        }
        return { rows: [] };
      }

      // INSERT INTO users
      if (lowerSql.includes('insert into users')) {
        const [email, password_hash, full_name, role] = params;
        const newUser = {
          id: `uuid-${Date.now()}-${Math.random()}`,
          email: email.toLowerCase().trim(),
          password_hash,
          full_name,
          role,
          is_active: true,
          email_verified: true,
          created_at: new Date(),
        };
        mockUsers.set(newUser.email, newUser);
        return { rows: [newUser] };
      }

      // UPDATE users
      if (lowerSql.includes('update users set role =')) {
        const role = params[0];
        const id = params[1];
        for (const user of mockUsers.values()) {
          if (user.id === id) {
            user.role = role;
            return { rows: [user] };
          }
        }
        return { rows: [] };
      }

      return { rows: [] };
    }),
    connect: jest.fn(async () => {
      const client = {
        query: jest.fn(async (sql, params = []) => {
          return pool.query(sql, params);
        }),
        release: jest.fn(),
      };
      return client;
    }),
  };
  return { pool };
});

const bcrypt = require('bcryptjs');
const authRouter = require('../src/routes/auth');

function createApp() {
  const app = express();
  const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('Authentication & OAuth Diagnostics', () => {
  let app;
  let mockOAuthClient;
  const adminPassword = 'AdminSecretPassword123!';
  const studentPassword = 'StudentSecretPassword123!';

  beforeAll(async () => {
    process.env.JWT_SECRET = 'diagnostic-test-jwt-secret-very-long-and-secure';
    process.env.GOOGLE_CLIENT_ID = '318750788874-g906jb1t0r6v3qotk2ru4bmif10a6eui.apps.googleusercontent.com';
    process.env.ADMIN_EMAIL = 'smit2shinde2@gmail.com';
    process.env.CLIENT_URL = 'http://localhost:3000,https://client-phi-lake.vercel.app';

    const adminHash = await bcrypt.hash(adminPassword, 10);
    mockUsers.set('smit2shinde2@gmail.com', {
      id: 'admin-uuid-1',
      email: 'smit2shinde2@gmail.com',
      password_hash: adminHash,
      full_name: 'Smit Shinde',
      role: 'admin',
      is_active: true,
      email_verified: true,
      created_at: new Date(),
    });

    const studentHash = await bcrypt.hash(studentPassword, 10);
    mockUsers.set('student@ustu.edu.in', {
      id: 'student-uuid-1',
      email: 'student@ustu.edu.in',
      password_hash: studentHash,
      full_name: 'Test Student',
      role: 'student',
      is_active: true,
      email_verified: true,
      created_at: new Date(),
    });

    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockOAuthClient = { verifyIdToken: jest.fn() };
    OAuth2Client.mockImplementation(() => mockOAuthClient);
  });

  test('1. Valid administrator login with email and password succeeds and issues admin tokens', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .send({ email: 'smit2shinde2@gmail.com', password: adminPassword });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://client-phi-lake.vercel.app');
    expect(res.body.user.email).toBe('smit2shinde2@gmail.com');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  test('2. Invalid password returns 401 Invalid credentials without leaking password details', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .send({ email: 'smit2shinde2@gmail.com', password: 'WrongPassword999!' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
  });

  test('3. Unknown account returns 401 Invalid credentials without account enumeration', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .send({ email: 'unknown.student@ustu.edu.in', password: 'AnyPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid credentials' });
  });

  test('4. Valid Google sign-in for eligible college account succeeds', async () => {
    mockOAuthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: process.env.GOOGLE_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'google-sub-12345',
        email: 'student@ustu.edu.in',
        email_verified: true,
        hd: 'ustu.edu.in',
        name: 'Test Student',
      }),
    });

    const res = await request(app)
      .post('/api/auth/google')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .send({ credential: 'valid-signed-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('student@ustu.edu.in');
    expect(res.body.user.role).toBe('student');
    expect(res.body.accessToken).toBeDefined();
  });

  test('5. Valid Google sign-in for administrator provisions/authenticates admin', async () => {
    mockOAuthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: process.env.GOOGLE_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'google-sub-admin-999',
        email: 'smit2shinde2@gmail.com',
        email_verified: true,
        name: 'Smit Shinde',
      }),
    });

    const res = await request(app)
      .post('/api/auth/google')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .send({ credential: 'valid-admin-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('smit2shinde2@gmail.com');
    expect(res.body.user.role).toBe('admin');
  });

  test('6. Google token with wrong audience is rejected with 401', async () => {
    mockOAuthClient.verifyIdToken.mockRejectedValueOnce(
      new Error('Wrong recipient, payload audience != requiredAudience')
    );

    const res = await request(app)
      .post('/api/auth/google')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .send({ credential: 'wrong-audience-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Google sign-in could not be verified for this college account');
  });

  test('7. Google token with non-college personal email is rejected with 401', async () => {
    mockOAuthClient.verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: process.env.GOOGLE_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'random-user-sub',
        email: 'randomperson@gmail.com',
        email_verified: true,
      }),
    });

    const res = await request(app)
      .post('/api/auth/google')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .send({ credential: 'random-gmail-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Google sign-in could not be verified for this college account');
  });

  test('8. Cross-origin preflight and credentials from https://client-phi-lake.vercel.app work', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://client-phi-lake.vercel.app')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://client-phi-lake.vercel.app');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
