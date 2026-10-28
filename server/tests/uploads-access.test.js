const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');

jest.mock('../src/db/pool', () => ({ pool: { query: jest.fn() } }));

describe('private uploaded files', () => {
  const originalUploadDir = process.env.UPLOAD_DIR;
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-upload-access-'));
  const routerPath = require.resolve('../src/routes/uploads');

  let app;

  beforeAll(() => {
    fs.writeFileSync(path.join(uploadDir, 'private-fixture.pdf'), 'private fixture');
    process.env.UPLOAD_DIR = uploadDir;
    delete require.cache[routerPath];
    app = express();
    app.use('/uploads', require('../src/routes/uploads'));
  });

  afterAll(() => {
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
    delete require.cache[routerPath];
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  test('does not serve an existing uploaded file without authentication', async () => {
    await request(app).get('/uploads/private-fixture.pdf').expect(401);
  });
});
