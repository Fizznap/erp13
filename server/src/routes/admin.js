const express = require('express');
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

module.exports = router;
