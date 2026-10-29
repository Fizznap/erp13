const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/stats — platform-wide statistics
router.get('/stats', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [users, subjects, resources, queries] = await Promise.all([
      pool.query(`SELECT role, COUNT(*) AS count FROM users GROUP BY role`),
      pool.query(`SELECT COUNT(*) AS count FROM subjects`),
      pool.query(`SELECT status, COUNT(*) AS count FROM resources GROUP BY status`),
      pool.query(`SELECT 
        COUNT(*) AS total_queries,
        COUNT(*) FILTER (WHERE was_found = true) AS found_count,
        COUNT(*) FILTER (WHERE was_found = false) AS not_found_count,
        ROUND(AVG(response_time_ms)) AS avg_latency_ms
       FROM ai_audit_logs`),
    ]);

    res.json({
      users: users.rows,
      subjects: parseInt(subjects.rows[0].count),
      resources: resources.rows,
      queries: queries.rows[0],
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// GET /api/admin/users — list all users
router.get('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, full_name, role, is_active, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/admin/faculty — create faculty account
router.post('/faculty', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { fullName, email: rawEmail, password, department, subjectOfferingId } = req.body || {};
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

    if (!email || !fullName?.trim() || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required' });
    }

    if (!email.includes('@') || email.length > 255) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check duplicate
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, 'faculty', true, true, now(), now())
         RETURNING id, email, full_name, role, is_active, created_at`,
        [email, passwordHash, fullName.trim()]
      );
      const newUser = userRes.rows[0];

      // Create faculty profile
      await client.query(
        `INSERT INTO user_profiles (user_id, program, registration_completed_at, created_at, updated_at)
         VALUES ($1, $2, now(), now(), now())
         ON CONFLICT (user_id) DO UPDATE SET program = EXCLUDED.program, updated_at = now()`,
        [newUser.id, department?.trim() || 'Faculty Department']
      );

      // Optionally assign to subject offering
      if (subjectOfferingId) {
        await client.query(
          `UPDATE subject_offerings SET faculty_id = $1 WHERE id = $2`,
          [newUser.id, subjectOfferingId]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({
        message: 'Faculty account created successfully',
        faculty: newUser,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create faculty error:', err);
    res.status(500).json({ error: 'Failed to create faculty account' });
  }
});

// PATCH /api/admin/users/:id — update user (activate/deactivate)
router.patch('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { isActive } = req.body;
    if (isActive === undefined) {
      return res.status(400).json({ error: 'isActive field is required' });
    }

    const result = await pool.query(
      `UPDATE users SET is_active = $1, updated_at = now()
       WHERE id = $2 RETURNING id, email, full_name, role, is_active`,
      [isActive, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// PATCH /api/admin/users/:id/class — assign academic class to user
router.patch('/users/:id/class', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { academicClassId, academicLabGroupId } = req.body;
    if (academicClassId === undefined) {
      return res.status(400).json({ error: 'academicClassId is required' });
    }

    let labGroupId = academicLabGroupId || null;
    if (academicClassId) {
      if (!labGroupId) return res.status(400).json({ error: 'Choose a lab group for this class' });
      const classResult = await pool.query(
        'SELECT branch_id, batch_id, division_id FROM academic_classes WHERE id = $1',
        [academicClassId]
      );
      if (!classResult.rows.length) return res.status(400).json({ error: 'Academic class not found' });
      const academicClass = classResult.rows[0];
      const groupResult = await pool.query(
        `SELECT id FROM academic_lab_groups
         WHERE id = $1 AND branch_id = $2 AND batch_id = $3 AND division_id = $4`,
        [labGroupId, academicClass.branch_id, academicClass.batch_id, academicClass.division_id]
      );
      if (!groupResult.rows.length) return res.status(400).json({ error: 'Lab group does not belong to the selected class' });
    } else {
      labGroupId = null;
    }

    const result = await pool.query(
      `UPDATE users SET academic_class_id = $1, updated_at = now()
       WHERE id = $2 RETURNING id, email, full_name, role, is_active, academic_class_id`,
      [academicClassId || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query(
      `INSERT INTO user_profiles (user_id, academic_lab_group_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET academic_lab_group_id = EXCLUDED.academic_lab_group_id,
                                           updated_at = now()`,
      [req.params.id, labGroupId]
    );

    res.json({ user: { ...result.rows[0], academic_lab_group_id: labGroupId } });
  } catch (err) {
    console.error('Update user class error:', err);
    res.status(500).json({ error: 'Failed to update user class' });
  }
});

// GET /api/admin/logs — AI query logs (paginated)
router.get('/logs', authenticate, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const [logs, count] = await Promise.all([
      pool.query(
        `SELECT al.*, u.full_name, u.email, s.name AS subject_name
         FROM ai_audit_logs al
         JOIN users u ON u.id = al.user_id
         LEFT JOIN subjects s ON s.id = al.subject_id
         ORDER BY al.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) AS total FROM ai_audit_logs'),
    ]);

    res.json({
      logs: logs.rows,
      pagination: {
        page,
        limit,
        total: parseInt(count.rows[0].total),
        pages: Math.ceil(parseInt(count.rows[0].total) / limit),
      },
    });
  } catch (err) {
    console.error('Logs error:', err);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

// GET /api/admin/analytics — comprehensive ERP analytics and insights
router.get('/analytics', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [overview, attendanceOverall, atRiskStudents, subjectPerformance, gradeDistribution, aiPerformance] = await Promise.all([
      // 1. Overview counts & averages
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE role = 'student' AND is_active = true) AS student_count,
          (SELECT COUNT(*) FROM users WHERE role = 'faculty' AND is_active = true) AS faculty_count,
          (SELECT COUNT(*) FROM subjects) AS subject_count,
          (SELECT COUNT(*) FROM academic_classes) AS class_count,
          (SELECT ROUND(AVG(total_marks)::numeric, 1) FROM academic_results WHERE total_marks IS NOT NULL AND status = 'published') AS avg_marks,
          (SELECT ROUND(AVG(grade_points)::numeric, 2) FROM academic_results WHERE grade_points IS NOT NULL AND status = 'published') AS avg_cgpa
      `),

      // 2. Attendance summary
      pool.query(`
        SELECT
          COUNT(*) AS total_records,
          COUNT(*) FILTER (WHERE status = 'present') AS present_records,
          COUNT(*) FILTER (WHERE status = 'absent') AS absent_records,
          COUNT(*) FILTER (WHERE corrected_at IS NOT NULL) AS corrected_records,
          CASE WHEN COUNT(*) > 0
               THEN ROUND((COUNT(*) FILTER (WHERE status = 'present')::numeric / COUNT(*)::numeric) * 100, 1)
               ELSE 100.0 END AS overall_rate
        FROM attendance_records
      `),

      // 3. At-risk students (attendance < 75% or failing marks)
      pool.query(`
        SELECT
          u.id AS student_id,
          u.full_name,
          u.email,
          p.roll_number,
          COUNT(ar.id) AS total_sessions,
          COUNT(ar.id) FILTER (WHERE ar.status = 'present') AS attended_sessions,
          CASE WHEN COUNT(ar.id) > 0
               THEN ROUND((COUNT(ar.id) FILTER (WHERE ar.status = 'present')::numeric / COUNT(ar.id)::numeric) * 100, 1)
               ELSE 100.0 END AS attendance_percentage,
          ROUND(AVG(r.grade_points)::numeric, 2) AS cgpa
        FROM users u
        LEFT JOIN user_profiles p ON p.user_id = u.id
        LEFT JOIN attendance_records ar ON ar.student_id = u.id
        LEFT JOIN academic_results r ON r.student_id = u.id AND r.status = 'published'
        WHERE u.role = 'student' AND u.is_active = true
        GROUP BY u.id, u.full_name, u.email, p.roll_number
        HAVING (COUNT(ar.id) > 0 AND (COUNT(ar.id) FILTER (WHERE ar.status = 'present')::numeric / COUNT(ar.id)::numeric) < 0.75)
            OR (AVG(r.grade_points) IS NOT NULL AND AVG(r.grade_points) < 5.0)
        ORDER BY attendance_percentage ASC
        LIMIT 20
      `),

      // 4. Subject performance
      pool.query(`
        SELECT
          s.id,
          s.name,
          s.code,
          COUNT(r.id) AS total_results,
          ROUND(AVG(r.total_marks)::numeric, 1) AS avg_marks,
          ROUND(AVG(r.grade_points)::numeric, 2) AS avg_gpa,
          CASE WHEN COUNT(r.id) > 0
               THEN ROUND((COUNT(r.id) FILTER (WHERE r.grade NOT IN ('F', 'XX', 'AB'))::numeric / COUNT(r.id)::numeric) * 100, 1)
               ELSE 100.0 END AS pass_percentage
        FROM subjects s
        LEFT JOIN academic_results r ON r.subject_id = s.id AND r.status = 'published'
        GROUP BY s.id, s.name, s.code
        ORDER BY s.name ASC
      `),

      // 5. Grade distribution
      pool.query(`
        SELECT
          grade,
          COUNT(*) AS count
        FROM academic_results
        WHERE status = 'published' AND grade IS NOT NULL
        GROUP BY grade
        ORDER BY grade ASC
      `),

      // 6. AI assistance telemetry
      pool.query(`
        SELECT
          COUNT(*) AS total_queries,
          COUNT(*) FILTER (WHERE was_found = true) AS successful_queries,
          COUNT(*) FILTER (WHERE was_found = false) AS fallback_queries,
          ROUND(AVG(response_time_ms)) AS avg_response_ms
        FROM ai_audit_logs
      `),
    ]);

    res.json({
      overview: overview.rows[0],
      attendance: attendanceOverall.rows[0],
      atRiskStudents: atRiskStudents.rows,
      subjectPerformance: subjectPerformance.rows,
      gradeDistribution: gradeDistribution.rows,
      aiMetrics: aiPerformance.rows[0],
    });
  } catch (err) {
    console.error('Analytics endpoint error:', err);
    res.status(500).json({ error: 'Failed to retrieve analytics data' });
  }
});

module.exports = router;
