const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { haversineDistance } = require('../utils/geo');

const router = express.Router();

function generateNonce() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char hex
}

// POST /api/attendance/start — faculty starts attendance session
router.post('/start', authenticate, authorize('faculty'), async (req, res) => {
  try {
    const { subjectId, latitude, longitude, radiusMeters } = req.body;

    if (!subjectId || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'subjectId, latitude, and longitude are required' });
    }

    // Verify faculty owns this subject
    const subject = await pool.query(
      'SELECT id FROM subjects WHERE id = $1 AND faculty_id = $2',
      [subjectId, req.user.id]
    );
    if (subject.rows.length === 0) {
      return res.status(403).json({ error: 'You do not own this subject' });
    }

    // End any existing active sessions for this subject
    await pool.query(
      `UPDATE attendance_sessions SET is_active = false, ended_at = now()
       WHERE subject_id = $1 AND faculty_id = $2 AND is_active = true`,
      [subjectId, req.user.id]
    );

    const nonce = generateNonce();
    const nonceExpires = new Date(Date.now() + 30 * 1000); // 30 seconds

    const result = await pool.query(
      `INSERT INTO attendance_sessions (subject_id, faculty_id, latitude, longitude, radius_meters, active_nonce, nonce_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [subjectId, req.user.id, latitude, longitude, radiusMeters || 50, nonce, nonceExpires]
    );

    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    console.error('Start attendance error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// GET /api/attendance/:sessionId/nonce — get current nonce (auto-rotate if expired)
router.get('/:sessionId/nonce', authenticate, authorize('faculty'), async (req, res) => {
  try {
    const session = await pool.query(
      'SELECT * FROM attendance_sessions WHERE id = $1 AND faculty_id = $2',
      [req.params.sessionId, req.user.id]
    );
    if (session.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (!session.rows[0].is_active) {
      return res.status(400).json({ error: 'Session is no longer active' });
    }

    let { active_nonce, nonce_expires } = session.rows[0];

    // Rotate nonce if expired
    if (new Date(nonce_expires) <= new Date()) {
      active_nonce = generateNonce();
      nonce_expires = new Date(Date.now() + 30 * 1000);
      await pool.query(
        'UPDATE attendance_sessions SET active_nonce = $1, nonce_expires = $2 WHERE id = $3',
        [active_nonce, nonce_expires, req.params.sessionId]
      );
    }

    res.json({ nonce: active_nonce, expiresAt: nonce_expires });
  } catch (err) {
    console.error('Get nonce error:', err);
    res.status(500).json({ error: 'Failed to get nonce' });
  }
});

// POST /api/attendance/mark — student marks attendance
router.post('/mark', authenticate, authorize('student'), async (req, res) => {
  try {
    const { sessionId, subjectId, nonce, latitude, longitude } = req.body;
    const deviceId = req.headers['x-device-id'] || 'unknown-device';
    const locHash = crypto.createHash('sha256').update(`${latitude},${longitude}`).digest('hex');

    if (!(sessionId || subjectId) || !nonce || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'sessionId (or subjectId), nonce, latitude, and longitude are required' });
    }

    // Get session
    let sessionResult;
    if (sessionId) {
      sessionResult = await pool.query(
        'SELECT * FROM attendance_sessions WHERE id = $1 AND is_active = true',
        [sessionId]
      );
    } else {
      sessionResult = await pool.query(
        'SELECT * FROM attendance_sessions WHERE subject_id = $1 AND is_active = true ORDER BY started_at DESC LIMIT 1',
        [subjectId]
      );
    }
    
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const session = sessionResult.rows[0];
    const actualSessionId = session.id;

    // Verify student is enrolled in this subject
    const enrollment = await pool.query(
      'SELECT id FROM subject_enrollments WHERE student_id = $1 AND subject_id = $2',
      [req.user.id, session.subject_id]
    );
    if (enrollment.rows.length === 0) {
      return res.status(403).json({ error: 'You are not enrolled in this subject' });
    }

    // Check if already marked
    const existing = await pool.query(
      'SELECT id FROM attendance_records WHERE session_id = $1 AND student_id = $2',
      [actualSessionId, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Attendance already marked for this session' });
    }

    // Validate nonce
    if (session.active_nonce !== nonce.toUpperCase()) {
      // Log rejected attempt
      await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, latitude, longitude, distance_meters, status, rejection_reason, device_id, student_location_hash)
         VALUES ($1, $2, $3, $4, $5, 'rejected', 'Invalid nonce', $6, $7)`,
        [actualSessionId, req.user.id, latitude, longitude, 0, deviceId, locHash]
      );
      return res.status(400).json({ error: 'Invalid or expired nonce', status: 'rejected' });
    }

    if (new Date(session.nonce_expires) <= new Date()) {
      return res.status(400).json({ error: 'Nonce has expired. Please get the new code from faculty.', status: 'rejected' });
    }

    // Calculate distance
    const distance = haversineDistance(
      session.latitude, session.longitude,
      latitude, longitude
    );

    // Check radius
    if (distance > session.radius_meters) {
      await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, latitude, longitude, distance_meters, status, rejection_reason, device_id, student_location_hash)
         VALUES ($1, $2, $3, $4, $5, 'rejected', $6, $7, $8)`,
        [actualSessionId, req.user.id, latitude, longitude, distance, `Too far: ${Math.round(distance)}m (max ${session.radius_meters}m)`, deviceId, locHash]
      );
      return res.status(400).json({
        error: `You are ${Math.round(distance)}m away (max ${session.radius_meters}m)`,
        status: 'rejected',
        distance: Math.round(distance),
      });
    }

    // Mark present
    const record = await pool.query(
      `INSERT INTO attendance_records (session_id, student_id, latitude, longitude, distance_meters, status, device_id, student_location_hash)
       VALUES ($1, $2, $3, $4, $5, 'present', $6, $7) RETURNING *`,
      [actualSessionId, req.user.id, latitude, longitude, distance, deviceId, locHash]
    );

    res.json({
      status: 'present',
      distance: Math.round(distance),
      record: record.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Attendance already marked' });
    }
    console.error('Mark attendance error:', err);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// POST /api/attendance/:sessionId/end — end attendance session
router.post('/:sessionId/end', authenticate, authorize('faculty'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE attendance_sessions SET is_active = false, ended_at = now()
       WHERE id = $1 AND faculty_id = $2 AND is_active = true
       RETURNING *`,
      [req.params.sessionId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Active session not found' });
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('End session error:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// POST /api/attendance/:sessionId/override — Admin override for attendance
router.post('/:sessionId/override', authenticate, authorize('admin', 'faculty'), async (req, res) => {
  try {
    const { studentId, status, note } = req.body;
    if (!studentId || !status || !note) {
      return res.status(400).json({ error: 'studentId, status, and note are required' });
    }
    
    // Check if record exists
    const existing = await pool.query(
      'SELECT id FROM attendance_records WHERE session_id = $1 AND student_id = $2',
      [req.params.sessionId, studentId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE attendance_records 
         SET status = $1, rejection_reason = $2, verification_method = 'admin_override'
         WHERE session_id = $3 AND student_id = $4`,
        [status, `Admin override: ${note}`, req.params.sessionId, studentId]
      );
    } else {
      await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, latitude, longitude, distance_meters, status, rejection_reason, verification_method)
         VALUES ($1, $2, 0, 0, 0, $3, $4, 'admin_override')`,
        [req.params.sessionId, studentId, status, `Admin override: ${note}`]
      );
    }

    res.json({ success: true, message: 'Attendance overridden' });
  } catch (err) {
    console.error('Override attendance error:', err);
    res.status(500).json({ error: 'Failed to override attendance' });
  }
});

// GET /api/attendance/sessions?subjectId=X — list sessions for a subject
router.get('/sessions', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { subjectId } = req.query;
    if (!subjectId) {
      return res.status(400).json({ error: 'subjectId is required' });
    }

    const result = await pool.query(
      `SELECT a.*,
              (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'present') AS present_count,
              (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'rejected') AS rejected_count
       FROM attendance_sessions a
       WHERE a.subject_id = $1
       ORDER BY a.started_at DESC`,
      [subjectId]
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});
// GET /api/attendance/my?subjectId=X — student's attendance records
router.get('/my/records', authenticate, authorize('student'), async (req, res) => {
  try {
    const { subjectId } = req.query;
    let query = `
      SELECT ar.*, a.subject_id, s.name AS subject_name, a.started_at AS session_date
      FROM attendance_records ar
      JOIN attendance_sessions a ON a.id = ar.session_id
      JOIN subjects s ON s.id = a.subject_id
      WHERE ar.student_id = $1
    `;
    const params = [req.user.id];
    if (subjectId) {
      query += ' AND a.subject_id = $2';
      params.push(subjectId);
    }
    query += ' ORDER BY ar.marked_at DESC';

    const result = await pool.query(query, params);
    res.json({ records: result.rows });
  } catch (err) {
    console.error('My records error:', err);
    res.status(500).json({ error: 'Failed to get records' });
  }
});


// GET /api/attendance/:sessionId/records — list attendance records for a session
router.get('/:sessionId/records', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ar.*, u.full_name, u.email
       FROM attendance_records ar
       JOIN users u ON u.id = ar.student_id
       WHERE ar.session_id = $1
       ORDER BY ar.marked_at ASC`,
      [req.params.sessionId]
    );
    res.json({ records: result.rows });
  } catch (err) {
    console.error('List records error:', err);
    res.status(500).json({ error: 'Failed to list records' });
  }
});

module.exports = router;
