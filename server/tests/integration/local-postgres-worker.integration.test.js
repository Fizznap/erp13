const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const runIntegration = process.env.RUN_LOCAL_DB_INTEGRATION === '1';
const integrationDescribe = runIntegration ? describe : describe.skip;

function assertDedicatedDatabaseTarget() {
  let target;
  try {
    target = new URL(process.env.DATABASE_URL || '');
  } catch {
    throw new Error('RUN_LOCAL_DB_INTEGRATION requires a valid dedicated DATABASE_URL');
  }
  const databaseName = target.pathname.replace(/^\//, '');
  const username = decodeURIComponent(target.username);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '5432' ||
      databaseName !== 'snippet_test' || username !== 'snippet_test_user') {
    throw new Error('Refusing integration tests unless DATABASE_URL targets local port 5432 database snippet_test as snippet_test_user');
  }
}

function syntheticPdf(text) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const document = new PDFDocument();
    const filename = path.join(os.tmpdir(), `snippet-integration-${crypto.randomUUID()}.pdf`);
    const output = fs.createWriteStream(filename);
    output.once('finish', () => {
      try {
        const data = fs.readFileSync(filename);
        fs.unlinkSync(filename);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
    output.once('error', reject);
    document.once('error', reject);
    document.pipe(output);
    document.fontSize(11).text(text);
    document.end();
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(description, check, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

integrationDescribe('local PostgreSQL, Redis queue, API, and standalone worker', () => {
  jest.setTimeout(90000);

  let pool;
  let producerQueue;
  let api;
  let worker;
  let workerOutput = '';
  let fakeProvider;
  let fakeProviderUrl;
  let fakeEmbeddingRequests = 0;
  let failedEmbeddingRequests = 0;
  let uploadDir;
  let successfulPdf;
  let failingPdf;
  let fixtures;
  let facultyA;
  let facultyB;
  let studentA;
  let studentB;
  let offeringA;
  let offeringB;
  let subjectA;
  let attendanceSessions;
  let tokens;
  let authMiddleware;

  async function insertUser({ email, name, role, academicClassId = null }) {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified, academic_class_id)
       VALUES ($1, 'integration-test-only', $2, $3, true, true, $4) RETURNING id`,
      [email, name, role, academicClassId]
    );
    const id = result.rows[0].id;
    fixtures.userIds.push(id);
    return id;
  }

  async function insertProfile(userId, labGroupId, suffix) {
    await pool.query(
      `INSERT INTO user_profiles
       (user_id, college_id, program, roll_number, year_of_study, admission_year, expected_graduation_year, academic_lab_group_id)
       VALUES ($1, 'INTEG-${suffix}', 'Integration Test', 'INTEG-${suffix}', 2, 2025, 2029, $2)`,
      [userId, labGroupId]
    );
  }

  function tokenFor(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  }

  async function createSession({ offeringId, subjectId, facultyId, labGroupId = null, isActive = false, ended = true, nonce = 'ABC123' }) {
    const result = await pool.query(
      `INSERT INTO attendance_sessions
       (subject_id, subject_offering_id, academic_lab_group_id, faculty_id, latitude, longitude, radius_meters, active_nonce, nonce_expires, is_active, ended_at)
       VALUES ($1, $2, $3, $4, 19, 72, 50, $7, now() + interval '30 seconds', $5, $6)
       RETURNING id`,
      [subjectId, offeringId, labGroupId, facultyId, isActive, ended ? new Date() : null, nonce]
    );
    const id = result.rows[0].id;
    fixtures.sessionIds.push(id);
    return id;
  }

  function uploadPdf(userToken, text, filename) {
    const file = text.includes('INJECT_EMBEDDING_FAILURE') ? failingPdf : successfulPdf;
    return request(api)
      .post('/api/resources/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .field('subjectOfferingId', offeringA)
      .field('kind', 'Notes')
      .attach('file', file, { filename, contentType: 'application/pdf' });
  }

  async function startWorker() {
    if (worker) return;
    worker = spawn(process.execPath, [path.join(__dirname, '../../src/services/worker.js')], {
      cwd: path.join(__dirname, '../..'),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', (chunk) => { workerOutput += chunk.toString(); });
    worker.stderr.on('data', (chunk) => { workerOutput += chunk.toString(); });
    await waitFor('standalone worker to connect to Redis', () => workerOutput.includes('Worker is up and listening for jobs...'), 15000);
  }

  beforeAll(async () => {
    assertDedicatedDatabaseTarget();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.GOOGLE_AI_API_KEY = 'integration-test-only';
    process.env.GOOGLE_AI_MODEL = 'gemini-3.1-flash-lite';
    process.env.GOOGLE_AI_TIMEOUT_MS = '10000';
    process.env.LLM_PROVIDER = 'google';
    process.env.QUEUE_PROCESSOR_ENABLED = 'false';
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

    const { pool: databasePool } = require('../../src/db/pool');
    pool = databasePool;
    const identity = await pool.query('SELECT current_database() AS database_name, current_user AS database_user');
    if (identity.rows[0].database_name !== 'snippet_test' || identity.rows[0].database_user !== 'snippet_test_user') {
      throw new Error('Connected PostgreSQL identity did not match the dedicated test database');
    }
    await pool.query('SELECT 1 FROM pg_extension WHERE extname = $1', ['vector']).then((result) => {
      if (!result.rows.length) throw new Error('The dedicated database does not have the pgvector extension');
    });
    const redis = require('bull');
    const redisCheck = new redis('snippet-remediation-healthcheck', process.env.REDIS_URL);
    await redisCheck.isReady();
    await redisCheck.close();

    fixtures = {
      branchIds: [], batchIds: [], divisionIds: [], classIds: [], labGroupIds: [],
      userIds: [], subjectIds: [], offeringIds: [], sessionIds: [], resourceIds: [],
    };
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-remediation-integration-'));
    process.env.UPLOAD_DIR = uploadDir;
    successfulPdf = await syntheticPdf(`Synthetic course note. TCP is connection-oriented. The fictional integration port is 4821. ${Array(70).fill('verifiedmaterial').join(' ')}`);
    failingPdf = await syntheticPdf(`Synthetic failure fixture INJECT_EMBEDDING_FAILURE. ${Array(70).fill('failurematerial').join(' ')}`);

    fakeProvider = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400).end('invalid test JSON');
          return;
        }
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        res.setHeader('content-type', 'application/json');
        if (pathname.endsWith(':batchEmbedContents')) {
          fakeEmbeddingRequests += 1;
          const texts = (body.requests || []).map((item) => item.content?.parts?.map((part) => part.text || '').join(' ') || '');
          if (texts.some((text) => text.includes('INJECT_EMBEDDING_FAILURE'))) {
            failedEmbeddingRequests += 1;
            res.writeHead(503).end(JSON.stringify({ error: { message: 'deterministic integration embedding failure' } }));
            return;
          }
          const vector = Array.from({ length: 768 }, (_unused, index) => index === 0 ? 1 : 0);
          res.writeHead(200).end(JSON.stringify({ embeddings: texts.map(() => ({ values: vector })) }));
          return;
        }
        if (pathname.endsWith(':embedContent')) {
          const vector = Array.from({ length: 768 }, (_unused, index) => index === 0 ? 1 : 0);
          res.writeHead(200).end(JSON.stringify({ embedding: { values: vector } }));
          return;
        }
        if (pathname.endsWith(':generateContent')) {
          res.writeHead(200).end(JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Synthetic integration PDF processed.', keyTopics: ['networks'], bulletPoints: ['Test-only content.'] }) }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
          }));
          return;
        }
        res.writeHead(404).end(JSON.stringify({ error: { message: 'unknown fake provider endpoint' } }));
      });
    });
    await new Promise((resolve, reject) => {
      fakeProvider.once('error', reject);
      fakeProvider.listen(0, '127.0.0.1', resolve);
    });
    fakeProviderUrl = `http://127.0.0.1:${fakeProvider.address().port}/v1beta`;
    process.env.GOOGLE_AI_API_BASE_URL = fakeProviderUrl;

    const suffix = crypto.randomBytes(5).toString('hex');
    const branchA = (await pool.query(
      'INSERT INTO branches (name, code) VALUES ($1, $2) RETURNING id',
      [`Integration Branch A ${suffix}`, `INTEG-A-${suffix}`]
    )).rows[0].id;
    const branchB = (await pool.query(
      'INSERT INTO branches (name, code) VALUES ($1, $2) RETURNING id',
      [`Integration Branch B ${suffix}`, `INTEG-B-${suffix}`]
    )).rows[0].id;
    fixtures.branchIds.push(branchA, branchB);
    const batchAStart = 3000 + Math.floor(Math.random() * 300);
    const batchBStart = 4000 + Math.floor(Math.random() * 300);
    const batchA = (await pool.query(
      'INSERT INTO batches (start_year, end_year) VALUES ($1, $2) RETURNING id',
      [batchAStart, batchAStart + 4]
    )).rows[0].id;
    const batchB = (await pool.query(
      'INSERT INTO batches (start_year, end_year) VALUES ($1, $2) RETURNING id',
      [batchBStart, batchBStart + 4]
    )).rows[0].id;
    fixtures.batchIds.push(batchA, batchB);
    const divisionA = (await pool.query('INSERT INTO divisions (name) VALUES ($1) RETURNING id', [`Integration A ${suffix}`])).rows[0].id;
    const divisionB = (await pool.query('INSERT INTO divisions (name) VALUES ($1) RETURNING id', [`Integration B ${suffix}`])).rows[0].id;
    fixtures.divisionIds.push(divisionA, divisionB);
    const semester = (await pool.query('SELECT id FROM semesters ORDER BY number LIMIT 1')).rows[0];
    if (!semester) throw new Error('No semesters exist after schema initialization');
    const classA = (await pool.query(
      'INSERT INTO academic_classes (branch_id, batch_id, division_id, semester_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [branchA, batchA, divisionA, semester.id]
    )).rows[0].id;
    const classB = (await pool.query(
      'INSERT INTO academic_classes (branch_id, batch_id, division_id, semester_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [branchB, batchB, divisionB, semester.id]
    )).rows[0].id;
    fixtures.classIds.push(classA, classB);

    const labA1 = (await pool.query(
      'INSERT INTO academic_lab_groups (branch_id, batch_id, division_id, name) VALUES ($1, $2, $3, $4) RETURNING id',
      [branchA, batchA, divisionA, `A1-${suffix}`]
    )).rows[0].id;
    const labA2 = (await pool.query(
      'INSERT INTO academic_lab_groups (branch_id, batch_id, division_id, name) VALUES ($1, $2, $3, $4) RETURNING id',
      [branchA, batchA, divisionA, `A2-${suffix}`]
    )).rows[0].id;
    const labB1 = (await pool.query(
      'INSERT INTO academic_lab_groups (branch_id, batch_id, division_id, name) VALUES ($1, $2, $3, $4) RETURNING id',
      [branchB, batchB, divisionB, `B1-${suffix}`]
    )).rows[0].id;
    fixtures.labGroupIds.push(labA1, labA2, labB1);

    facultyA = await insertUser({ email: `faculty-a-${suffix}@ustu.edu.in`, name: 'Synthetic Faculty A', role: 'faculty' });
    facultyB = await insertUser({ email: `faculty-b-${suffix}@ustu.edu.in`, name: 'Synthetic Faculty B', role: 'faculty' });
    studentA = await insertUser({ email: `student-a-${suffix}@ustu.edu.in`, name: 'Synthetic Student A', role: 'student', academicClassId: classA });
    studentB = await insertUser({ email: `student-b-${suffix}@ustu.edu.in`, name: 'Synthetic Student B', role: 'student', academicClassId: classB });
    await insertProfile(studentA, labA1, `${suffix}A`);
    await insertProfile(studentB, labB1, `${suffix}B`);
    tokens = {
      facultyA: tokenFor(facultyA), facultyB: tokenFor(facultyB),
      studentA: tokenFor(studentA), studentB: tokenFor(studentB),
    };

    subjectA = (await pool.query(
      'INSERT INTO subjects (name, code, faculty_id) VALUES ($1, $2, $3) RETURNING id',
      [`Integration Networks A ${suffix}`, `INTEG-NETA-${suffix}`, facultyA]
    )).rows[0].id;
    const subjectB = (await pool.query(
      'INSERT INTO subjects (name, code, faculty_id) VALUES ($1, $2, $3) RETURNING id',
      [`Integration Networks B ${suffix}`, `INTEG-NETB-${suffix}`, facultyB]
    )).rows[0].id;
    fixtures.subjectIds.push(subjectA, subjectB);
    offeringA = (await pool.query(
      'INSERT INTO subject_offerings (subject_id, academic_class_id, faculty_id) VALUES ($1, $2, $3) RETURNING id',
      [subjectA, classA, facultyA]
    )).rows[0].id;
    offeringB = (await pool.query(
      'INSERT INTO subject_offerings (subject_id, academic_class_id, faculty_id) VALUES ($1, $2, $3) RETURNING id',
      [subjectB, classB, facultyB]
    )).rows[0].id;
    fixtures.offeringIds.push(offeringA, offeringB);

    const presentSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA });
    const absentSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA });
    const missingSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA });
    const activeSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, isActive: true, ended: false });
    const unendedSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, isActive: false, ended: false });
    const wrongLabSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, labGroupId: labA2 });
    const crossClassSession = await createSession({ offeringId: offeringB, subjectId: subjectB, facultyId: facultyB });
    attendanceSessions = { presentSession, absentSession, missingSession, activeSession, unendedSession, wrongLabSession, crossClassSession };
    for (const [sessionId, status] of [[presentSession, 'present'], [absentSession, 'absent']]) {
      await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, latitude, longitude, distance_meters, status)
         VALUES ($1, $2, 19, 72, 0, $3)`,
        [sessionId, studentA, status]
      );
    }
    await expect(pool.query(
      `INSERT INTO attendance_records (session_id, student_id, latitude, longitude, distance_meters, status)
       VALUES ($1, $2, 19, 72, 0, 'present')`,
      [presentSession, studentA]
    )).rejects.toMatchObject({ code: '23505' });

    const { initQueue } = require('../../src/jobs/queue');
    producerQueue = initQueue({ processJobs: false });
    if (!producerQueue) throw new Error('Test Redis queue did not initialize');

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', require('../../src/routes/auth'));
    app.use('/api/attendance', require('../../src/routes/attendance'));
    app.use('/api/resources', require('../../src/routes/resources'));
    app.use('/uploads', require('../../src/routes/uploads'));
    api = app;

  });

  afterAll(async () => {
    if (worker && worker.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          worker.kill('SIGKILL');
          resolve();
        }, 5000);
        worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        worker.kill('SIGTERM');
      });
    }
    if (producerQueue) await producerQueue.close().catch(() => {});
    if (fakeProvider?.listening) await new Promise((resolve) => fakeProvider.close(resolve));
    if (pool && fixtures) {
      if (fixtures.sessionIds.length) await pool.query('DELETE FROM attendance_records WHERE session_id = ANY($1::uuid[])', [fixtures.sessionIds]);
      if (fixtures.sessionIds.length) await pool.query('DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])', [fixtures.sessionIds]);
      if (fixtures.resourceIds.length) await pool.query('DELETE FROM resources WHERE id = ANY($1::uuid[])', [fixtures.resourceIds]);
      if (fixtures.offeringIds.length) await pool.query('DELETE FROM subject_offerings WHERE id = ANY($1::uuid[])', [fixtures.offeringIds]);
      if (fixtures.subjectIds.length) await pool.query('DELETE FROM subjects WHERE id = ANY($1::uuid[])', [fixtures.subjectIds]);
      if (fixtures.userIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixtures.userIds]);
      if (fixtures.labGroupIds.length) await pool.query('DELETE FROM academic_lab_groups WHERE id = ANY($1::uuid[])', [fixtures.labGroupIds]);
      if (fixtures.classIds.length) await pool.query('DELETE FROM academic_classes WHERE id = ANY($1::uuid[])', [fixtures.classIds]);
      if (fixtures.divisionIds.length) await pool.query('DELETE FROM divisions WHERE id = ANY($1::uuid[])', [fixtures.divisionIds]);
      if (fixtures.batchIds.length) await pool.query('DELETE FROM batches WHERE id = ANY($1::uuid[])', [fixtures.batchIds]);
      if (fixtures.branchIds.length) await pool.query('DELETE FROM branches WHERE id = ANY($1::uuid[])', [fixtures.branchIds]);
      await pool.end();
    }
    if (uploadDir && fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  test('executes attendance history SQL against PostgreSQL with eligibility, absence, and duplicate constraints', async () => {
    const response = await request(api)
      .get('/api/attendance/my/records')
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(200);

    expect(Object.fromEntries(response.body.records.map((row) => [row.session_id, row.status]))).toEqual({
      [attendanceSessions.presentSession]: 'present',
      [attendanceSessions.absentSession]: 'absent',
      [attendanceSessions.missingSession]: 'absent',
    });
    const presentCount = response.body.records.filter((row) => row.status === 'present').length;
    expect(presentCount).toBe(1);
    expect(response.body.records.length).toBe(3);
    expect((presentCount / response.body.records.length) * 100).toBeCloseTo(100 / 3);

    const empty = await request(api)
      .get(`/api/attendance/my/records?subjectOfferingId=${offeringB}`)
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(200);
    expect(empty.body.records).toEqual([]);

    const studentBHistory = await request(api)
      .get('/api/attendance/my/records')
      .set('Authorization', `Bearer ${tokens.studentB}`)
      .expect(200);
    expect(studentBHistory.body.records.map((row) => row.session_id)).toEqual([attendanceSessions.crossClassSession]);
    expect(studentBHistory.body.records.some((row) => [attendanceSessions.presentSession, attendanceSessions.absentSession].includes(row.session_id))).toBe(false);
  });

  test('marks attendance, rejects stale and invalid nonces, enforces expiry and prevents duplicate submissions', async () => {
    const attendanceRequest = (sessionId, nonce, token = tokens.studentA) => request(api)
      .post('/api/attendance/mark')
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionId, nonce, latitude: 19, longitude: 72 });

    const replaySession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, isActive: true, ended: false, nonce: 'REPLAY1' });
    await attendanceRequest(replaySession, 'ABC123').expect(400);
    const replayAttempt = await pool.query(
      "SELECT status, rejection_reason FROM attendance_records WHERE session_id = $1 AND student_id = $2",
      [replaySession, studentA]
    );
    expect(replayAttempt.rows[0]).toMatchObject({ status: 'rejected', rejection_reason: 'Invalid nonce' });

    const invalidSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, isActive: true, ended: false, nonce: 'VALID01' });
    await attendanceRequest(invalidSession, 'BAD999').expect(400);

    const expiredSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, isActive: true, ended: false, nonce: 'EXPIRE1' });
    await pool.query('UPDATE attendance_sessions SET nonce_expires = now() - interval \'1 second\' WHERE id = $1', [expiredSession]);
    const expiredResponse = await attendanceRequest(expiredSession, 'EXPIRE1').expect(400);
    expect(expiredResponse.body.error).toMatch(/nonce has expired/i);

    await attendanceRequest(attendanceSessions.activeSession, 'ABC123', tokens.studentB).expect(403);
    const labSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, labGroupId: fixtures.labGroupIds[1], isActive: true, ended: false, nonce: 'LAB123' });
    await attendanceRequest(labSession, 'LAB123').expect(403);

    await attendanceRequest(attendanceSessions.activeSession, 'ABC123').expect(200);
    await attendanceRequest(attendanceSessions.activeSession, 'ABC123').expect(409);
    await request(api)
      .post(`/api/attendance/${attendanceSessions.activeSession}/end`)
      .set('Authorization', `Bearer ${tokens.facultyA}`)
      .expect(200);
    const markedHistory = await request(api)
      .get('/api/attendance/my/records')
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(200);
    expect(markedHistory.body.records.find((row) => row.session_id === attendanceSessions.activeSession)?.status).toBe('present');
  });

  test('limits faculty corrections to their class and lab roster and reflects corrections in student history', async () => {
    await request(api)
      .put(`/api/attendance/${attendanceSessions.presentSession}/roster/${studentA}`)
      .set('Authorization', `Bearer ${tokens.facultyA}`)
      .send({ status: 'absent', note: 'Synthetic correction' })
      .expect(200);

    await request(api)
      .put(`/api/attendance/${attendanceSessions.presentSession}/roster/${studentA}`)
      .set('Authorization', `Bearer ${tokens.facultyB}`)
      .send({ status: 'present', note: 'Unauthorized correction' })
      .expect(403);
    await request(api)
      .put(`/api/attendance/${attendanceSessions.presentSession}/roster/${studentB}`)
      .set('Authorization', `Bearer ${tokens.facultyA}`)
      .send({ status: 'present', note: 'Cross-class correction' })
      .expect(403);

    const labSession = await createSession({ offeringId: offeringA, subjectId: subjectA, facultyId: facultyA, labGroupId: fixtures.labGroupIds[1] });
    await request(api)
      .put(`/api/attendance/${labSession}/roster/${studentA}`)
      .set('Authorization', `Bearer ${tokens.facultyA}`)
      .send({ status: 'present', note: 'Cross-lab correction' })
      .expect(403);

    const history = await request(api)
      .get('/api/attendance/my/records')
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(200);
    expect(history.body.records.find((row) => row.session_id === attendanceSessions.presentSession)?.status).toBe('absent');
    const roster = await request(api)
      .get(`/api/attendance/${attendanceSessions.presentSession}/roster`)
      .set('Authorization', `Bearer ${tokens.facultyA}`)
      .expect(200);
    expect(roster.body.students.find((student) => student.student_id === studentA)?.status).toBe('absent');
  });

  test('persists a student profile photo in PostgreSQL and serves it only to that authenticated student', async () => {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await request(api)
      .put('/api/auth/avatar')
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .attach('file', pngSignature, { filename: 'synthetic.png', contentType: 'image/png' })
      .expect(200);

    const stored = await pool.query('SELECT content_type, image_data FROM user_avatars WHERE user_id = $1', [studentA]);
    expect(stored.rows[0].content_type).toBe('image/png');
    expect(stored.rows[0].image_data).toEqual(pngSignature);

    const ownPhoto = await request(api)
      .get('/api/auth/avatar')
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(200);
    expect(ownPhoto.headers['content-type']).toMatch(/image\/png/);
    expect(ownPhoto.body).toEqual(pngSignature);
    await request(api)
      .get('/api/auth/avatar')
      .set('Authorization', `Bearer ${tokens.studentB}`)
      .expect(404);
    await request(api).get('/api/auth/avatar').expect(401);
  });

  test('uploads a synthetic PDF through the real API, queues it, and the standalone worker stores 768D vectors', async () => {
    const text = `Synthetic course note. TCP is connection-oriented. The fictional integration port is 4821. ${Array(70).fill('verifiedmaterial').join(' ')}`;
    const response = await uploadPdf(tokens.facultyA, text, 'synthetic-networks.pdf').expect(201);
    const resource = response.body.resource;
    fixtures.resourceIds.push(resource.id);
    expect(resource.status).toBe('queued');
    const uploadedPdf = fs.readFileSync(resource.file_path);
    expect(uploadedPdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(uploadedPdf).toEqual(successfulPdf);

    const persisted = await pool.query('SELECT status, original_name, file_size FROM resources WHERE id = $1', [resource.id]);
    expect(persisted.rows[0]).toMatchObject({ status: 'queued', original_name: 'synthetic-networks.pdf' });

    await startWorker();
    await waitFor('worker to mark the resource ready and persist chunks', async () => {
      const result = await pool.query(
        `SELECT r.status, r.error_message, COUNT(rc.id)::int AS chunk_count,
                MIN(vector_dims(rc.embedding)) AS min_dimensions,
                MAX(vector_dims(rc.embedding)) AS max_dimensions
         FROM resources r LEFT JOIN resource_chunks rc ON rc.resource_id = r.id
         WHERE r.id = $1 GROUP BY r.id`,
        [resource.id]
      );
      const row = result.rows[0];
      if (row?.status === 'failed') {
        throw new Error(`Resource failed before becoming ready: ${row.status}; error=${row.error_message}; fakeEmbeddings=${fakeEmbeddingRequests}; worker=${workerOutput}`);
      }
      return row?.status === 'ready' && row.chunk_count > 0 && row.min_dimensions === 768 && row.max_dimensions === 768 ? row : null;
    });
    expect(fakeEmbeddingRequests).toBeGreaterThan(0);
    expect(workerOutput).toContain(`[Queue] Processing resource ${resource.id}`);
    const job = (await producerQueue.getJobs(['completed'])).find((candidate) => candidate.data.resourceId === resource.id);
    expect(job).toBeTruthy();

    const { vectorSearch } = require('../../src/services/rag');
    const queryVector = Array.from({ length: 768 }, (_unused, index) => index === 0 ? 1 : 0);
    const studentChunks = await vectorSearch(queryVector, subjectA, { role: 'student', academicClassId: fixtures.classIds[0] });
    const otherClassChunks = await vectorSearch(queryVector, subjectA, { role: 'student', academicClassId: fixtures.classIds[1] });
    expect(studentChunks.some((chunk) => chunk.resource_id === resource.id)).toBe(true);
    expect(otherClassChunks.some((chunk) => chunk.resource_id === resource.id)).toBe(false);

    const listedByOwner = await request(api)
      .get(`/api/resources?subjectOfferingId=${offeringA}`)
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(200);
    expect(listedByOwner.body.resources.some((item) => item.id === resource.id)).toBe(true);

    const listedByOtherClass = await request(api)
      .get(`/api/resources?subjectOfferingId=${offeringA}`)
      .set('Authorization', `Bearer ${tokens.studentB}`)
      .expect(200);
    expect(listedByOtherClass.body.resources.some((item) => item.id === resource.id)).toBe(false);

    await request(api)
      .get(`/api/resources/${resource.id}/download`)
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(200)
      .expect('content-type', /application\/pdf/);
    await request(api)
      .get(`/api/resources/${resource.id}/download`)
      .set('Authorization', `Bearer ${tokens.studentB}`)
      .expect(403);
    await request(api)
      .get(`/uploads/${resource.filename}`)
      .set('Authorization', `Bearer ${tokens.studentA}`)
      .expect(403);
    await request(api).get(`/uploads/${resource.filename}`).expect(401);

    const deniedUpload = await uploadPdf(tokens.facultyB, text, 'unauthorized.pdf').expect(403);
    expect(deniedUpload.body.error).toMatch(/own this subject offering/i);
    const resourcesAfterDeniedUpload = await pool.query('SELECT id FROM resources WHERE original_name = $1', ['unauthorized.pdf']);
    expect(resourcesAfterDeniedUpload.rows).toEqual([]);
  });

  test('provider failure is retried by Bull and ends failed without ready status', async () => {
    const text = `Synthetic failure fixture INJECT_EMBEDDING_FAILURE. ${Array(70).fill('failurematerial').join(' ')}`;
    const response = await uploadPdf(tokens.facultyA, text, 'synthetic-failing.pdf').expect(201);
    const resourceId = response.body.resource.id;
    fixtures.resourceIds.push(resourceId);

    await startWorker();
    await waitFor('Bull to exhaust retries and resource to remain failed', async () => {
      const rows = await pool.query('SELECT status FROM resources WHERE id = $1', [resourceId]);
      const failedJobs = await producerQueue.getJobs(['failed']);
      const job = failedJobs.find((candidate) => candidate.data.resourceId === resourceId);
      return rows.rows[0]?.status === 'failed' && job ? { status: rows.rows[0].status, job } : null;
    }, 35000);
    expect(failedEmbeddingRequests).toBeGreaterThanOrEqual(3);
    const resource = await pool.query('SELECT status FROM resources WHERE id = $1', [resourceId]);
    expect(resource.rows[0].status).toBe('failed');
    expect(workerOutput).toContain(`[Queue] Processing resource ${resourceId}`);
    const successfulChunks = await pool.query('SELECT id FROM resource_chunks WHERE resource_id = $1', [resourceId]);
    expect(successfulChunks.rows).toEqual([]);
  });

  test('rejects a faculty upload for an offering owned by another faculty member', async () => {
    const response = await uploadPdf(tokens.facultyB, `Unauthorized test ${Array(70).fill('material').join(' ')}`, 'wrong-owner.pdf').expect(403);
    expect(response.body.error).toMatch(/own this subject offering/i);
    expect(await pool.query('SELECT id FROM resources WHERE original_name = $1', ['wrong-owner.pdf']).then((result) => result.rows)).toEqual([]);
  });
});
