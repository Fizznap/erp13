const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { haversineDistance } = require('../utils/geo');

const router = express.Router();

async function loadSessionScope(sessionId) {
  const result = await pool.query(
    `SELECT a.id, a.faculty_id, a.academic_lab_group_id, a.subject_offering_id,
            ac.branch_id, ac.batch_id, ac.division_id
     FROM attendance_sessions a
     LEFT JOIN subject_offerings so ON so.id = a.subject_offering_id
     LEFT JOIN academic_classes ac ON ac.id = so.academic_class_id
     WHERE a.id = $1`,
    [sessionId]
  );
  return result.rows[0];
}

function canManageSession(session, user) {
  return user.role === 'admin' || session.faculty_id === user.id;
}

async function isSessionRosterStudent(session, studentId) {
  const result = await pool.query(
    `SELECT u.id
     FROM users u
     JOIN academic_classes student_class ON student_class.id = u.academic_class_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND u.role = 'student' AND u.is_active = true AND u.email_verified = true
       AND student_class.branch_id = $2 AND student_class.batch_id = $3
       AND student_class.division_id = $4
       AND ($5::uuid IS NULL OR p.academic_lab_group_id = $5)`,
    [studentId, session.branch_id, session.batch_id, session.division_id, session.academic_lab_group_id]
  );
  return result.rows.length > 0;
}

function generateNonce() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char hex
}

// POST /api/attendance/start — faculty starts attendance session
router.post('/start', authenticate, authorize('faculty'), async (req, res) => {
  try {
    const { subjectOfferingId, subjectId, latitude, longitude, radiusMeters } = req.body;
    const sessionType = req.body.sessionType === 'lab' ? 'lab' : 'lecture';
    const academicLabGroupId = req.body.academicLabGroupId || null;

    if ((!subjectOfferingId && !subjectId) || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'subjectOfferingId, latitude, and longitude are required' });
    }

    let actualSubjectId = subjectId;
    let actualOfferingId = subjectOfferingId || null;
    let offeringClass;

    if (subjectOfferingId) {
      const offering = await pool.query(
        `SELECT so.subject_id, ac.branch_id, ac.batch_id, ac.division_id
         FROM subject_offerings so
         JOIN academic_classes ac ON ac.id = so.academic_class_id
         WHERE so.id = $1 AND so.faculty_id = $2`,
        [subjectOfferingId, req.user.id]
      );
      if (offering.rows.length === 0) {
        return res.status(403).json({ error: 'You do not own this subject offering' });
      }
      actualSubjectId = offering.rows[0].subject_id;
      offeringClass = offering.rows[0];
    } else {
      const subject = await pool.query(
        'SELECT id FROM subjects WHERE id = $1 AND faculty_id = $2',
        [subjectId, req.user.id]
      );
      if (subject.rows.length === 0) {
        return res.status(403).json({ error: 'You do not own this subject' });
      }
    }

    if (sessionType === 'lab') {
      if (!actualOfferingId || !academicLabGroupId) {
        return res.status(400).json({ error: 'Lab attendance requires a subject offering and lab group' });
      }
      const group = await pool.query(
        `SELECT id FROM academic_lab_groups
         WHERE id = $1 AND branch_id = $2 AND batch_id = $3 AND division_id = $4`,
        [academicLabGroupId, offeringClass.branch_id, offeringClass.batch_id, offeringClass.division_id]
      );
      if (!group.rows.length) return res.status(400).json({ error: 'Select a lab group configured for this class' });
    } else if (academicLabGroupId) {
      return res.status(400).json({ error: 'Lecture attendance is division-wide and cannot target a lab group' });
    }

    // End any existing active sessions
    if (actualOfferingId) {
      await pool.query(
        `UPDATE attendance_sessions SET is_active = false, ended_at = now()
         WHERE subject_offering_id = $1 AND faculty_id = $2 AND is_active = true`,
        [actualOfferingId, req.user.id]
      );
    } else {
      await pool.query(
        `UPDATE attendance_sessions SET is_active = false, ended_at = now()
         WHERE subject_id = $1 AND faculty_id = $2 AND is_active = true`,
        [actualSubjectId, req.user.id]
      );
    }

    const nonce = generateNonce();
    const nonceExpires = new Date(Date.now() + 30 * 1000); // 30 seconds

    const result = await pool.query(
      `INSERT INTO attendance_sessions (subject_id, subject_offering_id, academic_lab_group_id, faculty_id, latitude, longitude, radius_meters, active_nonce, nonce_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [actualSubjectId, actualOfferingId, academicLabGroupId, req.user.id, latitude, longitude, radiusMeters || 50, nonce, nonceExpires]
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
    const { sessionId, subjectOfferingId, subjectId, nonce, latitude, longitude } = req.body;
    const deviceId = req.headers['x-device-id'] || 'unknown-device';
    const locHash = crypto.createHash('sha256').update(`${latitude},${longitude}`).digest('hex');

    if (!(sessionId || subjectOfferingId || subjectId || nonce) || typeof nonce !== 'string' || !nonce || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'sessionId (or offering/subject/nonce), latitude, and longitude are required' });
    }

    // Get session
    let sessionResult;
    if (sessionId) {
      sessionResult = await pool.query(
        'SELECT * FROM attendance_sessions WHERE id = $1 AND is_active = true',
        [sessionId]
      );
    } else if (subjectOfferingId) {
      sessionResult = await pool.query(
        'SELECT * FROM attendance_sessions WHERE subject_offering_id = $1 AND is_active = true ORDER BY started_at DESC LIMIT 1',
        [subjectOfferingId]
      );
    } else if (subjectId) {
      sessionResult = await pool.query(
        'SELECT * FROM attendance_sessions WHERE subject_id = $1 AND is_active = true ORDER BY started_at DESC LIMIT 1',
        [subjectId]
      );
    } else if (nonce) {
      sessionResult = await pool.query(
        'SELECT * FROM attendance_sessions WHERE active_nonce = $1 AND is_active = true',
        [nonce.toUpperCase()]
      );
    }
    
    if (!sessionResult || sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Active session not found or invalid code' });
    }

    const session = sessionResult.rows[0];
    const actualSessionId = session.id;

    // Verify student is enrolled in this offering
    const userRec = await pool.query(
      `SELECT u.academic_class_id, p.academic_lab_group_id,
              student_class.branch_id, student_class.batch_id, student_class.division_id
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN academic_classes student_class ON student_class.id = u.academic_class_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const classId = userRec.rows[0]?.academic_class_id;
    if (!classId) return res.status(403).json({ error: 'You are not assigned to an academic class' });

    if (session.academic_lab_group_id && userRec.rows[0]?.academic_lab_group_id !== session.academic_lab_group_id) {
      return res.status(403).json({ error: 'You are not assigned to this lab group' });
    }

    if (session.subject_offering_id) {
      const offering = await pool.query(
        `SELECT so.id FROM subject_offerings so
         JOIN academic_classes offered_class ON offered_class.id = so.academic_class_id
         WHERE so.id = $1 AND offered_class.branch_id = $2
           AND offered_class.batch_id = $3 AND offered_class.division_id = $4`,
        [session.subject_offering_id, userRec.rows[0].branch_id, userRec.rows[0].batch_id, userRec.rows[0].division_id]
      );
      if (offering.rows.length === 0) {
        return res.status(403).json({ error: 'You are not enrolled in this offering' });
      }
    } else {
      const offering = await pool.query(
        `SELECT so.id FROM subject_offerings so
         JOIN academic_classes offered_class ON offered_class.id = so.academic_class_id
         WHERE so.subject_id = $1 AND offered_class.branch_id = $2
           AND offered_class.batch_id = $3 AND offered_class.division_id = $4`,
        [session.subject_id, userRec.rows[0].branch_id, userRec.rows[0].batch_id, userRec.rows[0].division_id]
      );
      if (offering.rows.length === 0) {
        // Fallback to old enrollment if offering doesn't exist
        const oldEnr = await pool.query('SELECT id FROM subject_enrollments WHERE student_id = $1 AND subject_id = $2', [req.user.id, session.subject_id]);
        if (oldEnr.rows.length === 0) {
          return res.status(403).json({ error: 'You are not enrolled in this subject' });
        }
      }
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
    if (!studentId || !['present', 'absent'].includes(status) || typeof note !== 'string' || !note.trim() || note.length > 255) {
      return res.status(400).json({ error: 'studentId, present/absent status, and a note are required' });
    }
    const session = await loadSessionScope(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canManageSession(session, req.user)) return res.status(403).json({ error: 'You do not own this attendance session' });
    if (!session.subject_offering_id || !session.branch_id || !session.batch_id || !session.division_id) {
      return res.status(400).json({ error: 'This session is not linked to a configured class roster' });
    }
    if (!await isSessionRosterStudent(session, studentId)) {
      return res.status(403).json({ error: 'Student is not enrolled in this division or lab group' });
    }
    await pool.query(
      `INSERT INTO attendance_records
       (session_id, student_id, latitude, longitude, distance_meters, status, rejection_reason, verification_method)
       VALUES ($1, $2, 0, 0, 0, $3, $4, $5)
       ON CONFLICT (session_id, student_id) DO UPDATE SET
         status = EXCLUDED.status, rejection_reason = EXCLUDED.rejection_reason,
         verification_method = EXCLUDED.verification_method, marked_at = now()`,
      [req.params.sessionId, studentId, status, `Manual attendance: ${note.trim()}`, req.user.role === 'admin' ? 'admin_override' : 'faculty_manual']
    );
    res.json({ success: true, message: 'Attendance updated' });
  } catch (err) {
    console.error('Override attendance error:', err);
    res.status(500).json({ error: 'Failed to override attendance' });
  }
});

// GET /api/attendance/:sessionId/roster — include present and absent students for the exact class scope.
router.get('/:sessionId/roster', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const session = await loadSessionScope(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canManageSession(session, req.user)) return res.status(403).json({ error: 'You do not own this attendance session' });
    if (!session.subject_offering_id || !session.branch_id || !session.batch_id || !session.division_id) {
      return res.status(400).json({ error: 'This session is not linked to a configured class roster' });
    }
    const result = await pool.query(
      `SELECT u.id AS student_id, COALESCE(p.preferred_name, u.full_name) AS full_name,
              p.roll_number, u.email,
              COALESCE(ar.status, 'absent') AS status, ar.marked_at,
              ar.verification_method, ar.rejection_reason
       FROM users u
       JOIN academic_classes student_class ON student_class.id = u.academic_class_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN attendance_records ar ON ar.session_id = $1 AND ar.student_id = u.id
       WHERE u.role = 'student' AND u.is_active = true AND u.email_verified = true
         AND student_class.branch_id = $2 AND student_class.batch_id = $3
         AND student_class.division_id = $4
         AND ($5::uuid IS NULL OR p.academic_lab_group_id = $5)
       ORDER BY COALESCE(p.roll_number, u.email), u.full_name`,
      [req.params.sessionId, session.branch_id, session.batch_id, session.division_id, session.academic_lab_group_id]
    );
    res.json({ students: result.rows });
  } catch (err) {
    console.error('Attendance roster error:', err);
    res.status(500).json({ error: 'Could not load the class roster' });
  }
});

// PUT /api/attendance/:sessionId/roster/:studentId — faculty can correct attendance later.
router.put('/:sessionId/roster/:studentId', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { status, note = '' } = req.body || {};
    if (!['present', 'absent'].includes(status) || typeof note !== 'string' || note.length > 255) {
      return res.status(400).json({ error: 'Status must be present or absent and note must be 255 characters or fewer' });
    }
    const session = await loadSessionScope(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canManageSession(session, req.user)) return res.status(403).json({ error: 'You do not own this attendance session' });
    if (!session.subject_offering_id || !session.branch_id || !session.batch_id || !session.division_id) {
      return res.status(400).json({ error: 'This session is not linked to a configured class roster' });
    }
    if (!await isSessionRosterStudent(session, req.params.studentId)) {
      return res.status(403).json({ error: 'Student is not enrolled in this division or lab group' });
    }
    const result = await pool.query(
      `INSERT INTO attendance_records
       (session_id, student_id, latitude, longitude, distance_meters, status, rejection_reason, verification_method)
       VALUES ($1, $2, 0, 0, 0, $3, $4, 'faculty_manual')
       ON CONFLICT (session_id, student_id) DO UPDATE SET
         status = EXCLUDED.status, rejection_reason = EXCLUDED.rejection_reason,
         verification_method = 'faculty_manual', marked_at = now()
       RETURNING id, student_id, status, marked_at, verification_method, rejection_reason`,
      [req.params.sessionId, req.params.studentId, status, note.trim() || null]
    );
    res.json({ student: result.rows[0] });
  } catch (err) {
    console.error('Manual attendance update error:', err);
    res.status(500).json({ error: 'Could not update attendance' });
  }
});

// GET /api/attendance/sessions?subjectOfferingId=X — list sessions
router.get('/sessions', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { subjectOfferingId, subjectId } = req.query;
    if (!subjectOfferingId && !subjectId) {
      return res.status(400).json({ error: 'subjectOfferingId or subjectId is required' });
    }

    let result;
    if (subjectOfferingId) {
      result = await pool.query(
        `SELECT a.*,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'present') AS present_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'rejected') AS rejected_count
         FROM attendance_sessions a
         WHERE a.subject_offering_id = $1 AND ($2 = 'admin' OR a.faculty_id = $3)
         ORDER BY a.started_at DESC`,
        [subjectOfferingId, req.user.role, req.user.id]
      );
    } else {
      result = await pool.query(
        `SELECT a.*,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'present') AS present_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'rejected') AS rejected_count
         FROM attendance_sessions a
         WHERE a.subject_id = $1 AND ($2 = 'admin' OR a.faculty_id = $3)
         ORDER BY a.started_at DESC`,
        [subjectId, req.user.role, req.user.id]
      );
    }
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /api/attendance/my/records?subjectOfferingId=X — student's attendance records
router.get('/my/records', authenticate, authorize('student'), async (req, res) => {
  try {
    const { subjectOfferingId, subjectId } = req.query;
    let query = `
      SELECT ar.*, a.subject_id, a.subject_offering_id, s.name AS subject_name, a.started_at AS session_date
      FROM attendance_records ar
      JOIN attendance_sessions a ON a.id = ar.session_id
      JOIN subjects s ON s.id = a.subject_id
      WHERE ar.student_id = $1
    `;
    const params = [req.user.id];
    if (subjectOfferingId) {
      query += ' AND a.subject_offering_id = $2';
      params.push(subjectOfferingId);
    } else if (subjectId) {
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
    const session = await loadSessionScope(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canManageSession(session, req.user)) return res.status(403).json({ error: 'You do not own this attendance session' });
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
