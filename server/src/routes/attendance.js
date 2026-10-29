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

function isValidLocation(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

// POST /api/attendance/start — faculty or admin starts attendance session
router.post('/start', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { subjectOfferingId, subjectId, latitude, longitude, radiusMeters } = req.body;
    const sessionType = req.body.sessionType === 'lab' ? 'lab' : 'lecture';
    const academicLabGroupId = req.body.academicLabGroupId || null;
    const radius = radiusMeters == null ? 50 : radiusMeters;

    if ((!subjectOfferingId && !subjectId) || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'subjectOfferingId, latitude, and longitude are required' });
    }
    if (!isValidLocation(latitude, longitude)) {
      return res.status(400).json({ error: 'Latitude and longitude must be valid numeric coordinates' });
    }
    if (!Number.isInteger(radius) || radius < 1 || radius > 1000) {
      return res.status(400).json({ error: 'Radius must be an integer between 1 and 1000 meters' });
    }

    let actualSubjectId = subjectId;
    let actualOfferingId = subjectOfferingId || null;
    let offeringClass;
    let sessionFacultyId = req.user.id;

    if (subjectOfferingId) {
      const offeringQuery = req.user.role === 'admin'
        ? `SELECT so.subject_id, so.faculty_id, ac.branch_id, ac.batch_id, ac.division_id
           FROM subject_offerings so
           JOIN academic_classes ac ON ac.id = so.academic_class_id
           WHERE so.id = $1`
        : `SELECT so.subject_id, so.faculty_id, ac.branch_id, ac.batch_id, ac.division_id
           FROM subject_offerings so
           JOIN academic_classes ac ON ac.id = so.academic_class_id
           WHERE so.id = $1 AND so.faculty_id = $2`;
      const offeringParams = req.user.role === 'admin'
        ? [subjectOfferingId]
        : [subjectOfferingId, req.user.id];
      const offering = await pool.query(offeringQuery, offeringParams);
      if (offering.rows.length === 0) {
        return res.status(req.user.role === 'admin' ? 404 : 403).json({
          error: req.user.role === 'admin' ? 'Subject offering not found' : 'You do not own this subject offering',
        });
      }
      actualSubjectId = offering.rows[0].subject_id;
      offeringClass = offering.rows[0];
      sessionFacultyId = offering.rows[0].faculty_id || req.user.id;
    } else {
      const subjectQuery = req.user.role === 'admin'
        ? 'SELECT id, faculty_id FROM subjects WHERE id = $1'
        : 'SELECT id, faculty_id FROM subjects WHERE id = $1 AND faculty_id = $2';
      const subjectParams = req.user.role === 'admin' ? [subjectId] : [subjectId, req.user.id];
      const subject = await pool.query(subjectQuery, subjectParams);
      if (subject.rows.length === 0) {
        return res.status(req.user.role === 'admin' ? 404 : 403).json({
          error: req.user.role === 'admin' ? 'Subject not found' : 'You do not own this subject',
        });
      }
      sessionFacultyId = subject.rows[0].faculty_id || req.user.id;
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
         WHERE subject_offering_id = $1 AND ($2 = 'admin' OR faculty_id = $3) AND is_active = true`,
        [actualOfferingId, req.user.role, req.user.id]
      );
    } else {
      await pool.query(
        `UPDATE attendance_sessions SET is_active = false, ended_at = now()
         WHERE subject_id = $1 AND ($2 = 'admin' OR faculty_id = $3) AND is_active = true`,
        [actualSubjectId, req.user.role, req.user.id]
      );
    }

    const nonce = generateNonce();
    const nonceExpires = new Date(Date.now() + 30 * 1000); // 30 seconds

    const result = await pool.query(
      `INSERT INTO attendance_sessions (subject_id, subject_offering_id, academic_lab_group_id, faculty_id, latitude, longitude, radius_meters, active_nonce, nonce_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [actualSubjectId, actualOfferingId, academicLabGroupId, sessionFacultyId, latitude, longitude, radius, nonce, nonceExpires]
    );

    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    console.error('Start attendance error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// GET /api/attendance/:sessionId/nonce — get current nonce (auto-rotate if expired)
router.get('/:sessionId/nonce', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const session = await pool.query(
      'SELECT * FROM attendance_sessions WHERE id = $1 AND ($2 = \'admin\' OR faculty_id = $3)',
      [req.params.sessionId, req.user.role, req.user.id]
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
    const { sessionId, subjectOfferingId, subjectId, nonce, latitude, longitude, accuracy, timestamp } = req.body;
    const deviceId = req.headers['x-device-id'] || 'unknown-device';

    if (!(sessionId || subjectOfferingId || subjectId || nonce) || typeof nonce !== 'string' || !nonce || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'sessionId (or offering/subject/nonce), latitude, and longitude are required' });
    }
    if (!isValidLocation(latitude, longitude)) {
      return res.status(400).json({ error: 'Latitude and longitude must be valid numeric coordinates' });
    }
    
    // Validate GPS accuracy (configurable, default 25m)
    const maxAccuracyMeters = parseInt(process.env.GPS_MAX_ACCURACY_METERS) || 25;
    if (accuracy != null && (typeof accuracy !== 'number' || accuracy > maxAccuracyMeters)) {
      return res.status(400).json({
        error: `GPS accuracy too low: ${Math.round(accuracy)}m (required: ${maxAccuracyMeters}m or better)`,
        code: 'ACCURACY_TOO_LOW',
        reportedAccuracy: Math.round(accuracy),
        requiredAccuracy: maxAccuracyMeters,
      });
    }
    
    // Validate timestamp freshness (must be within last 60 seconds)
    if (timestamp != null && typeof timestamp === 'number') {
      const age = Date.now() - timestamp;
      if (age > 60000 || age < -5000) { // Allow 5s clock skew forward
        return res.status(400).json({
          error: 'Location reading is too old. Get a fresh location and try again.',
          code: 'STALE_LOCATION',
        });
      }
    }
    
    const locHash = crypto.createHash('sha256').update(`${latitude},${longitude}`).digest('hex');

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

    // Calculate distance using server-side Haversine (never trust client calculation)
    const distance = haversineDistance(
      session.latitude, session.longitude,
      latitude, longitude
    );

    // Check if uncertainty overlaps geofence boundary
    // If reported accuracy is available, use it for uncertainty check
    const uncertaintyMargin = accuracy != null ? accuracy : 0;
    const effectiveDistance = Math.max(0, distance - uncertaintyMargin);
    
    // If uncertainty could place student either inside or outside, ask for better reading
    if (accuracy != null && distance > 0 && distance < session.radius_meters + accuracy && distance > session.radius_meters) {
      await pool.query(
        `INSERT INTO attendance_records (session_id, student_id, latitude, longitude, distance_meters, status, rejection_reason, device_id, student_location_hash)
         VALUES ($1, $2, $3, $4, $5, 'rejected', $6, $7, $8)`,
        [actualSessionId, req.user.id, latitude, longitude, distance, 
         `Uncertain: ${Math.round(distance)}m ± ${Math.round(accuracy)}m overlaps boundary. Get better accuracy and try again.`, 
         deviceId, locHash]
      );
      return res.status(400).json({
        error: `Location uncertainty overlaps boundary. Get a better GPS fix and try again.`,
        status: 'rejected',
        distance: Math.round(distance),
        accuracy: Math.round(accuracy),
        code: 'UNCERTAIN_BOUNDARY',
      });
    }

    // Check radius (use effective distance accounting for uncertainty)
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
      accuracy: accuracy != null ? Math.round(accuracy) : undefined,
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
router.post('/:sessionId/end', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE attendance_sessions SET is_active = false, ended_at = now()
       WHERE id = $1 AND ($2 = 'admin' OR faculty_id = $3) AND is_active = true
       RETURNING *`,
      [req.params.sessionId, req.user.role, req.user.id]
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
              ar.id AS record_id,
              CASE WHEN ar.status = 'rejected' THEN 'needs_review'
                   ELSE COALESCE(ar.status, 'absent') END AS status, ar.marked_at,
              ar.verification_method, ar.rejection_reason,
              ar.corrected_at, ar.corrected_by, ar.correction_reason, ar.original_status
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

// POST /api/attendance/records/:recordId/correct — authorized corrections requiring reason field
router.post('/records/:recordId/correct', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { status, reason } = req.body || {};
    if (!['present', 'absent'].includes(status)) {
      return res.status(400).json({ error: 'Status must be present or absent' });
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: 'A correction reason is required' });
    }
    if (reason.length > 500) {
      return res.status(400).json({ error: 'Correction reason must be 500 characters or fewer' });
    }

    const existing = await pool.query(
      `SELECT r.*, s.faculty_id
       FROM attendance_records r
       JOIN attendance_sessions s ON s.id = r.session_id
       WHERE r.id = $1`,
      [req.params.recordId]
    );

    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    const rec = existing.rows[0];
    if (req.user.role !== 'admin' && rec.faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not have permission to correct this record' });
    }

    const originalStatus = rec.original_status || rec.status;
    const result = await pool.query(
      `UPDATE attendance_records
       SET status = $1,
           original_status = $2,
           corrected_by = $3,
           corrected_at = now(),
           correction_reason = $4
       WHERE id = $5
       RETURNING id, session_id, student_id, status, original_status, corrected_by, corrected_at, correction_reason`,
      [status, originalStatus, req.user.id, reason.trim(), req.params.recordId]
    );

    res.json({ record: result.rows[0] });
  } catch (err) {
    console.error('Attendance correction error:', err);
    res.status(500).json({ error: 'Could not correct attendance record' });
  }
});

// PUT /api/attendance/:sessionId/roster/:studentId — faculty or admin can correct attendance later.
router.put('/:sessionId/roster/:studentId', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { status, note = '', reason = '' } = req.body || {};
    const correctionReason = (reason || note || 'Manual attendance correction').trim();
    if (!['present', 'absent'].includes(status)) {
      return res.status(400).json({ error: 'Status must be present or absent' });
    }
    if (correctionReason.length > 255) {
      return res.status(400).json({ error: 'Correction reason must be 255 characters or fewer' });
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
       (session_id, student_id, latitude, longitude, distance_meters, status, rejection_reason, verification_method,
        corrected_by, corrected_at, correction_reason, original_status)
       VALUES ($1, $2, 0, 0, 0, $3, $4, 'faculty_manual', $5, now(), $6, 'absent')
       ON CONFLICT (session_id, student_id) DO UPDATE SET
         status = EXCLUDED.status,
         rejection_reason = EXCLUDED.rejection_reason,
         verification_method = 'faculty_manual',
         marked_at = now(),
         corrected_by = EXCLUDED.corrected_by,
         corrected_at = now(),
         correction_reason = EXCLUDED.correction_reason,
         original_status = COALESCE(attendance_records.original_status, attendance_records.status)
       RETURNING id, student_id, status, marked_at, verification_method, rejection_reason,
                 corrected_by, corrected_at, correction_reason, original_status`,
      [
        req.params.sessionId,
        req.params.studentId,
        status,
        correctionReason,
        req.user.id,
        correctionReason,
      ]
    );
    res.json({ student: result.rows[0] });
  } catch (err) {
    console.error('Manual attendance update error:', err);
    res.status(500).json({ error: 'Could not update attendance' });
  }
});

// GET /api/attendance/sessions?subjectOfferingId=X or classId=Y — list sessions
router.get('/sessions', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { subjectOfferingId, subjectId, classId } = req.query;
    if (!subjectOfferingId && !subjectId && !classId) {
      return res.status(400).json({ error: 'subjectOfferingId, subjectId, or classId is required' });
    }

    let result;
    if (classId) {
      result = await pool.query(
        `SELECT a.*, s.name AS subject_name, s.code AS subject_code,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'present') AS present_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'rejected') AS rejected_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id) AS total_count
         FROM attendance_sessions a
         JOIN subject_offerings so ON so.id = a.subject_offering_id
         JOIN subjects s ON s.id = so.subject_id
         WHERE so.academic_class_id = $1 AND ($2 = 'admin' OR a.faculty_id = $3)
         ORDER BY a.started_at DESC`,
        [classId, req.user.role, req.user.id]
      );
    } else if (subjectOfferingId) {
      result = await pool.query(
        `SELECT a.*, s.name AS subject_name, s.code AS subject_code,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'present') AS present_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'rejected') AS rejected_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id) AS total_count
         FROM attendance_sessions a
         JOIN subjects s ON s.id = a.subject_id
         WHERE a.subject_offering_id = $1 AND ($2 = 'admin' OR a.faculty_id = $3)
         ORDER BY a.started_at DESC`,
        [subjectOfferingId, req.user.role, req.user.id]
      );
    } else {
      result = await pool.query(
        `SELECT a.*, s.name AS subject_name, s.code AS subject_code,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'present') AS present_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id AND status = 'rejected') AS rejected_count,
                (SELECT COUNT(*) FROM attendance_records WHERE session_id = a.id) AS total_count
         FROM attendance_sessions a
         JOIN subjects s ON s.id = a.subject_id
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

function toRoman(num) {
  const map = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII' };
  return map[num] || String(num);
}

// GET /api/attendance/my/overview — semester-wise and subject-wise breakdown for authenticated student
router.get('/my/overview', authenticate, authorize('student'), async (req, res) => {
  try {
    const studentId = req.user.id;
    const requestedSemester = req.query.semester ? parseInt(req.query.semester, 10) : null;

    // 1. Fetch student's class and hierarchy
    const studentUser = await pool.query(
      `SELECT u.id, u.academic_class_id, p.academic_lab_group_id,
              ac.branch_id, ac.batch_id, ac.division_id, ac.semester_id,
              br.code AS branch_code, br.name AS branch_name,
              ba.start_year AS batch_start_year, ba.end_year AS batch_end_year,
              d.name AS division_name, s.number AS current_semester_number
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN academic_classes ac ON ac.id = u.academic_class_id
       LEFT JOIN branches br ON br.id = ac.branch_id
       LEFT JOIN batches ba ON ba.id = ac.batch_id
       LEFT JOIN divisions d ON d.id = ac.division_id
       LEFT JOIN semesters s ON s.id = ac.semester_id
       WHERE u.id = $1`,
      [studentId]
    );

    if (studentUser.rows.length === 0 || !studentUser.rows[0].branch_id) {
      return res.json({
        semesters: [],
        selectedSemester: null,
        overall: { percentage: 0, attended: 0, total: 0 },
        subjects: [],
      });
    }

    const studentInfo = studentUser.rows[0];

    // 2. Fetch all semesters applicable to the student's branch and batch
    const semQuery = await pool.query(
      `SELECT DISTINCT s.number AS semester_number, ac.id AS academic_class_id
       FROM academic_classes ac
       JOIN semesters s ON s.id = ac.semester_id
       WHERE ac.branch_id = $1 AND ac.batch_id = $2 AND ac.division_id = $3
       ORDER BY s.number ASC`,
      [studentInfo.branch_id, studentInfo.batch_id, studentInfo.division_id]
    );

    const availableSemesters = semQuery.rows.map((row) => ({
      semesterNumber: row.semester_number,
      academicClassId: row.academic_class_id,
      label: `Semester ${toRoman(row.semester_number)} (${studentInfo.batch_start_year}–${String(studentInfo.batch_end_year).slice(-2)})`,
      isCurrent: row.semester_number === studentInfo.current_semester_number,
    }));

    if (availableSemesters.length === 0) {
      availableSemesters.push({
        semesterNumber: studentInfo.current_semester_number || 5,
        academicClassId: studentInfo.academic_class_id,
        label: `Semester ${toRoman(studentInfo.current_semester_number || 5)} (${studentInfo.batch_start_year || 2024}–${String(studentInfo.batch_end_year || 2028).slice(-2)})`,
        isCurrent: true,
      });
    }

    const selectedSemesterNumber = requestedSemester || studentInfo.current_semester_number || availableSemesters[0].semesterNumber;
    const activeSemInfo = availableSemesters.find((s) => s.semesterNumber === selectedSemesterNumber) || availableSemesters[0];
    const targetClassId = activeSemInfo.academicClassId || studentInfo.academic_class_id;

    // 3. Fetch subjects and offerings for this class
    const offeringsQuery = await pool.query(
      `SELECT so.id AS offering_id, s.id AS subject_id, s.name AS subject_name, s.code AS subject_code,
              s.description, u.full_name AS faculty_name
       FROM subject_offerings so
       JOIN subjects s ON s.id = so.subject_id
       LEFT JOIN users u ON u.id = so.faculty_id
       WHERE so.academic_class_id = $1
       ORDER BY s.code ASC, s.name ASC`,
      [targetClassId]
    );

    // 4. For each offering, calculate attended and total applicable sessions
    let overallAttended = 0;
    let overallTotal = 0;

    const subjects = await Promise.all(
      offeringsQuery.rows.map(async (offering) => {
        const isLab = offering.subject_name.toLowerCase().includes('lab') || offering.subject_code.toUpperCase().endsWith('L');

        const sessionsQuery = await pool.query(
          `SELECT a.id,
                  EXISTS (
                    SELECT 1 FROM attendance_records ar
                    WHERE ar.session_id = a.id AND ar.student_id = $1 AND ar.status = 'present'
                  ) AS is_present
           FROM attendance_sessions a
           WHERE a.subject_offering_id = $2
             AND a.is_active = false
             AND a.ended_at IS NOT NULL
             AND ($3::uuid IS NULL OR a.academic_lab_group_id IS NULL OR a.academic_lab_group_id = $3)`,
          [studentId, offering.offering_id, studentInfo.academic_lab_group_id]
        );

        const totalApplicable = sessionsQuery.rows.length;
        const attended = sessionsQuery.rows.filter((r) => r.is_present).length;
        const percentage = totalApplicable > 0 ? Number(((attended / totalApplicable) * 100).toFixed(2)) : 0;

        overallTotal += totalApplicable;
        overallAttended += attended;

        return {
          offeringId: offering.offering_id,
          subjectId: offering.subject_id,
          name: offering.subject_name,
          code: offering.subject_code,
          isLab,
          facultyName: offering.faculty_name,
          attended,
          total: totalApplicable,
          percentage,
        };
      })
    );

    const overallPercentage = overallTotal > 0 ? Number(((overallAttended / overallTotal) * 100).toFixed(2)) : 0;

    res.json({
      semesters: availableSemesters,
      selectedSemester: selectedSemesterNumber,
      overall: {
        percentage: overallPercentage,
        attended: overallAttended,
        total: overallTotal,
      },
      subjects,
    });
  } catch (err) {
    console.error('Attendance overview error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance overview' });
  }
});

// GET /api/attendance/my/records?subjectOfferingId=X — completed sessions the student was eligible to attend
router.get('/my/records', authenticate, authorize('student'), async (req, res) => {
  try {
    const { subjectOfferingId, subjectId } = req.query;
    let query = `
      SELECT a.id AS id, a.id AS session_id, ar.id AS attendance_record_id,
             a.subject_id, a.subject_offering_id, s.name AS subject_name,
             a.started_at AS session_date, ar.marked_at,
             CASE WHEN ar.status = 'present' THEN 'present' ELSE 'absent' END AS status,
             ar.verification_method, ar.rejection_reason
      FROM attendance_sessions a
      JOIN subjects s ON s.id = a.subject_id
      JOIN users u ON u.id = $1 AND u.role = 'student' AND u.is_active = true AND u.email_verified = true
      JOIN academic_classes student_class ON student_class.id = u.academic_class_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT r.id, r.status, r.marked_at, r.verification_method, r.rejection_reason
        FROM attendance_records r
        WHERE r.session_id = a.id AND r.student_id = u.id
        ORDER BY r.marked_at DESC, r.id DESC
        LIMIT 1
      ) ar ON true
      WHERE a.is_active = false AND a.ended_at IS NOT NULL
        AND (a.academic_lab_group_id IS NULL OR p.academic_lab_group_id = a.academic_lab_group_id)
        AND (
          (a.subject_offering_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM subject_offerings so
            JOIN academic_classes offered_class ON offered_class.id = so.academic_class_id
            WHERE so.id = a.subject_offering_id AND so.subject_id = a.subject_id
              AND offered_class.branch_id = student_class.branch_id
              AND offered_class.batch_id = student_class.batch_id
              AND offered_class.division_id = student_class.division_id
          ))
          OR (a.subject_offering_id IS NULL AND (
            EXISTS (
              SELECT 1
              FROM subject_offerings so
              JOIN academic_classes offered_class ON offered_class.id = so.academic_class_id
              WHERE so.subject_id = a.subject_id
                AND offered_class.branch_id = student_class.branch_id
                AND offered_class.batch_id = student_class.batch_id
                AND offered_class.division_id = student_class.division_id
            )
            OR EXISTS (
              SELECT 1 FROM subject_enrollments se
              WHERE se.student_id = u.id AND se.subject_id = a.subject_id
            )
          ))
        )
    `;
    const params = [req.user.id];
    if (subjectOfferingId) {
      query += ' AND a.subject_offering_id = $2';
      params.push(subjectOfferingId);
    } else if (subjectId) {
      query += ' AND a.subject_id = $2';
      params.push(subjectId);
    }
    query += ' ORDER BY a.started_at DESC, a.id';

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
