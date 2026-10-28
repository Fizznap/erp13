const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');

jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate(req, _res, next) {
    req.user = { id: 'faculty-1', role: 'faculty' };
    next();
  },
  authorize(...roles) {
    return (req, res, next) => roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'Insufficient permissions' });
  },
}));

describe('resource PDF upload validation', () => {
  const originalUploadDir = process.env.UPLOAD_DIR;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-resource-upload-'));
  const routerPath = require.resolve('../src/routes/resources');
  let app;

  beforeAll(() => {
    process.env.UPLOAD_DIR = uploadDir;
    delete require.cache[routerPath];
    app = express();
    app.use(express.json());
    app.use('/api/resources', require('../src/routes/resources'));
  });

  beforeEach(() => pool.query.mockReset());

  afterAll(() => {
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
    delete require.cache[routerPath];
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  test('rejects a non-PDF payload even when its name and MIME type claim PDF', async () => {
    const response = await request(app)
      .post('/api/resources/upload')
      .field('subjectId', 'subject-1')
      .attach('file', Buffer.from('<html>not a PDF</html>'), {
        filename: 'lecture.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not a valid PDF/i);
    expect(pool.query).not.toHaveBeenCalled();
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  test('rejects upload requests with no file', async () => {
    const response = await request(app)
      .post('/api/resources/upload')
      .field('subjectId', 'subject-1');

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/file is required/i);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
