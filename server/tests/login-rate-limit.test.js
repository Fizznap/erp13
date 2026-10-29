const request = require('supertest');
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db/pool');

jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

describe('Login Rate Limiting and Proxy Safety Tests', () => {
  let app;
  let customLoginLimiter;
  let customApiLimiter;

  beforeEach(() => {
    pool.query.mockReset();
    jest.clearAllMocks();

    // Isolated test limiters with small threshold for fast unit testing
    customLoginLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 3, // 3 login attempts allowed
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many login attempts, please try again later.' },
    });

    customApiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later.' },
    });

    app = express();
    // Simulate reverse proxy (Render edge) by trusting 1 hop
    app.set('trust proxy', 1);
    app.use(express.json());

    // Register /api/auth BEFORE general /api limiter (our fix)
    const authRouter = express.Router();
    authRouter.post('/login', customLoginLimiter, async (req, res) => {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
      const userRes = await pool.query('SELECT * FROM users WHERE lower(trim(email)) = $1', [email.toLowerCase()]);
      if (userRes.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
      const user = userRes.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
      res.json({ accessToken: 'valid-test-token', user: { id: user.id, email: user.email } });
    });

    app.use('/api/auth', authRouter);

    // General API limiter applies to all other /api routes
    app.use('/api', customApiLimiter);
    app.get('/api/subjects', (req, res) => res.json({ subjects: [] }));
    app.get('/api/resources', (req, res) => res.json({ resources: [] }));
  });

  test('1. Valid login attempt within rate limit succeeds', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'user-1', email: 'student@ustu.edu.in', password_hash: passwordHash, is_active: true, email_verified: true }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ email: 'student@ustu.edu.in', password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('valid-test-token');
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });

  test('2. Multiple login attempts exceeding threshold return HTTP 429 with Retry-After', async () => {
    pool.query.mockResolvedValue({ rows: [] }); // 401 invalid credentials

    // Attempt 1, 2, 3: Should return 401 (not rate limited yet)
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ email: 'student@ustu.edu.in', password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    }

    // Attempt 4: Exceeds max 3, must return 429
    const limitedRes = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ email: 'student@ustu.edu.in', password: 'wrong' });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.body.error).toBe('Too many login attempts, please try again later.');
    // express-rate-limit standard headers
    expect(limitedRes.headers['retry-after']).toBeDefined();
    expect(Number(limitedRes.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('3. Different client IPs have independent rate limit buckets', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    // Exhaust client A's limit
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.31')
        .send({ email: 'a@ustu.edu.in', password: 'wrong' });
    }
    const resA = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.31')
      .send({ email: 'a@ustu.edu.in', password: 'wrong' });
    expect(resA.status).toBe(429);

    // Client B from different IP can still make login attempts
    const resB = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.32')
      .send({ email: 'b@ustu.edu.in', password: 'wrong' });
    expect(resB.status).toBe(401); // Not 429!
  });

  test('4. General API traffic hitting apiLimiter does NOT block /api/auth/login', async () => {
    // Generate 6 requests to /api/subjects to exhaust customApiLimiter (max 5)
    for (let i = 0; i < 5; i++) {
      const apiRes = await request(app)
        .get('/api/subjects')
        .set('X-Forwarded-For', '203.0.113.40');
      expect(apiRes.status).toBe(200);
    }
    // 6th request to /api/subjects returns 429 "Too many requests, please try again later."
    const exhaustedApi = await request(app)
      .get('/api/subjects')
      .set('X-Forwarded-For', '203.0.113.40');
    expect(exhaustedApi.status).toBe(429);
    expect(exhaustedApi.body.error).toBe('Too many requests, please try again later.');

    // CRITICAL VERIFICATION:
    // A login request from the SAME IP must NOT be blocked by apiLimiter!
    const passwordHash = await bcrypt.hash('secret123', 10);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'user-1', email: 'student@ustu.edu.in', password_hash: passwordHash, is_active: true, email_verified: true }],
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.40')
      .send({ email: 'student@ustu.edu.in', password: 'secret123' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBe('valid-test-token');
  });

  test('5. Safe trust proxy (1 hop) picks the real client IP from reverse proxy and ignores spoofed client headers', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    // Attacker sends: X-Forwarded-For: 1.2.3.4 (spoofed client), 198.51.100.5 (real client added by Render)
    // With trust proxy: 1, Express treats 198.51.100.5 as the client IP (ignoring spoofed 1.2.3.4).
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `1.2.3.4, 198.51.100.5`)
        .send({ email: 'attacker@ustu.edu.in', password: 'wrong' });
    }

    // Now attacker changes spoofed header to 5.6.7.8, but real IP is still 198.51.100.5
    const fourthReq = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', `5.6.7.8, 198.51.100.5`)
      .send({ email: 'attacker@ustu.edu.in', password: 'wrong' });

    // Since trust proxy is 1 hop, Express still identifies the client by 198.51.100.5 and enforces 429!
    expect(fourthReq.status).toBe(429);
    expect(fourthReq.body.error).toBe('Too many login attempts, please try again later.');
  });
});
