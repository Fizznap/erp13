const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { pool } = require('../src/db/pool');

jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

let mockCurrentUser = { id: 'student-1', role: 'student', academicClassId: 'class-aml' };

jest.mock('../src/middleware/auth', () => ({
  authenticate(req, res, next) {
    if (!mockCurrentUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = mockCurrentUser;
    next();
  },
  authorize(...roles) {
    return (req, res, next) => {
      if (!mockCurrentUser) return res.status(401).json({ error: 'Authentication required' });
      return roles.includes(req.user.role)
        ? next()
        : res.status(403).json({ error: 'Insufficient permissions' });
    };
  },
}));

describe('resource PDF download and inline viewing route', () => {
  const originalUploadDir = process.env.UPLOAD_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-resource-download-'));
  const testPdfPath = path.join(tempDir, 'sample-aml.pdf');
  const routerPath = require.resolve('../src/routes/resources');
  let app;

  beforeAll(() => {
    // Write sample PDF starting with %PDF-
    fs.writeFileSync(testPdfPath, '%PDF-1.4 sample AML lecture bytes');
    process.env.UPLOAD_DIR = tempDir;
    delete require.cache[routerPath];
    app = express();
    app.use(express.json());
    app.use('/api/resources', require('../src/routes/resources'));
  });

  afterAll(() => {
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
    delete require.cache[routerPath];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockCurrentUser = { id: 'student-1', role: 'student', academicClassId: 'class-aml' };
    pool.query.mockReset();
  });

  test('serves inline PDF with application/pdf Content-Type and inline Content-Disposition', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'res-aml-1',
          file_path: testPdfPath,
          original_name: 'AML_Lecture_01.pdf',
          filename: 'sample-aml.pdf',
          mime_type: 'application/pdf',
          subject_offering_id: 'offering-aml',
          class_id: 'class-aml',
        },
      ],
    });

    const res = await request(app)
      .get('/api/resources/res-aml-1/download?disposition=inline')
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/pdf/i);
    expect(res.headers['content-disposition']).toMatch(/inline;\s*filename="AML_Lecture_01.pdf"/i);
    expect(res.body.toString('utf8')).toContain('%PDF-1.4');
  });

  test('supports attachment Content-Disposition when explicitly requested', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'res-aml-1',
          file_path: testPdfPath,
          original_name: 'AML_Lecture_01.pdf',
          filename: 'sample-aml.pdf',
          mime_type: 'application/pdf',
          subject_offering_id: 'offering-aml',
          class_id: 'class-aml',
        },
      ],
    });

    const res = await request(app)
      .get('/api/resources/res-aml-1/download?disposition=attachment')
      .expect(200);

    expect(res.headers['content-disposition']).toMatch(/attachment;\s*filename="AML_Lecture_01.pdf"/i);
  });

  test('returns sanitized JSON 404 error when file is missing from storage (e.g. ephemeral disk wiped)', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'res-missing',
          file_path: path.join(tempDir, 'non-existent-wiped-file.pdf'),
          original_name: 'Lost_File.pdf',
          filename: 'lost.pdf',
          mime_type: 'application/pdf',
          subject_offering_id: 'offering-aml',
          class_id: 'class-aml',
        },
      ],
    });

    const res = await request(app)
      .get('/api/resources/res-missing/download?disposition=inline')
      .expect(404);

    expect(res.headers['content-type']).toMatch(/application\/json/i);
    expect(res.body.error).toMatch(/File is no longer available in storage/i);
  });

  test('returns 403 Forbidden when student from another class attempts access', async () => {
    mockCurrentUser = { id: 'student-2', role: 'student', academicClassId: 'other-class-cs' };
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'res-aml-1',
          file_path: testPdfPath,
          original_name: 'AML_Lecture_01.pdf',
          subject_offering_id: 'offering-aml',
          class_id: 'class-aml',
        },
      ],
    });

    const res = await request(app)
      .get('/api/resources/res-aml-1/download')
      .expect(403);

    expect(res.body.error).toMatch(/Access denied/i);
  });

  test('returns 401 Unauthorized when unauthenticated', async () => {
    mockCurrentUser = null;

    const res = await request(app)
      .get('/api/resources/res-aml-1/download')
      .expect(401);

    expect(res.body.error).toMatch(/Authentication required/i);
  });

  test('returns 404 when resource does not exist in database', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/resources/non-existent-id/download')
      .expect(404);

    expect(res.body.error).toBe('Resource not found');
  });
});
