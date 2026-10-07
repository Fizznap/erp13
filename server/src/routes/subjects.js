const express = require('express');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/subjects — list subjects based on role
router.get('/', authenticate, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'student') {
      // Students see enrolled subjects
      result = await pool.query(
        `SELECT s.*, u.full_name AS faculty_name,
                (SELECT COUNT(*) FROM resources WHERE subject_id = s.id AND status = 'ready') AS resource_count,
                true AS is_enrolled
         FROM subjects s
         JOIN subject_enrollments se ON se.subject_id = s.id
         JOIN users u ON u.id = s.faculty_id
         WHERE se.student_id = $1
         ORDER BY s.name`,
        [req.user.id]
      );
    } else if (req.user.role === 'faculty') {
      // Faculty see their own subjects
      result = await pool.query(
        `SELECT s.*, 
                (SELECT full_name FROM users WHERE id = s.faculty_id) AS faculty_name,
                (SELECT COUNT(*) FROM resources WHERE subject_id = s.id) AS resource_count,
                (SELECT COUNT(*) FROM subject_enrollments WHERE subject_id = s.id) AS student_count
         FROM subjects s
         WHERE s.faculty_id = $1
         ORDER BY s.name`,
        [req.user.id]
      );
    } else {
      // Admin sees all
      result = await pool.query(
        `SELECT s.*, u.full_name AS faculty_name,
                (SELECT COUNT(*) FROM resources WHERE subject_id = s.id) AS resource_count,
                (SELECT COUNT(*) FROM subject_enrollments WHERE subject_id = s.id) AS student_count
         FROM subjects s
         JOIN users u ON u.id = s.faculty_id
         ORDER BY s.name`
      );
    }
    res.json({ subjects: result.rows });
  } catch (err) {
    console.error('List subjects error:', err);
    res.status(500).json({ error: 'Failed to list subjects' });
  }
});

// POST /api/subjects — create subject (faculty or admin)
router.post('/', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const result = await pool.query(
      `INSERT INTO subjects (name, code, description, faculty_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, code, description || null, req.user.id]
    );

    res.status(201).json({ subject: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Subject code already exists' });
    }
    console.error('Create subject error:', err);
    res.status(500).json({ error: 'Failed to create subject' });
  }
});

// GET /api/subjects/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name AS faculty_name,
              (SELECT COUNT(*) FROM resources WHERE subject_id = s.id AND status = 'ready') AS resource_count,
              (SELECT COUNT(*) FROM subject_enrollments WHERE subject_id = s.id) AS student_count
       FROM subjects s
       JOIN users u ON u.id = s.faculty_id
       WHERE s.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Check enrollment for students
    if (req.user.role === 'student') {
      const enrollment = await pool.query(
        'SELECT id FROM subject_enrollments WHERE student_id = $1 AND subject_id = $2',
        [req.user.id, req.params.id]
      );
      result.rows[0].is_enrolled = enrollment.rows.length > 0;
    }

    res.json({ subject: result.rows[0] });
  } catch (err) {
    console.error('Get subject error:', err);
    res.status(500).json({ error: 'Failed to get subject' });
  }
});

// POST /api/subjects/:id/enroll — student enrolls in subject
router.post('/:id/enroll', authenticate, authorize('student'), async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO subject_enrollments (student_id, subject_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, req.params.id]
    );
    res.json({ message: 'Enrolled successfully' });
  } catch (err) {
    console.error('Enroll error:', err);
    res.status(500).json({ error: 'Failed to enroll' });
  }
});

// GET /api/subjects/available/all — list all subjects for enrollment
router.get('/available/all', authenticate, authorize('student'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name AS faculty_name,
              EXISTS(
                SELECT 1 FROM subject_enrollments 
                WHERE student_id = $1 AND subject_id = s.id
              ) AS is_enrolled
       FROM subjects s
       JOIN users u ON u.id = s.faculty_id
       ORDER BY s.name`,
      [req.user.id]
    );
    res.json({ subjects: result.rows });
  } catch (err) {
    console.error('Available subjects error:', err);
    res.status(500).json({ error: 'Failed to list subjects' });
  }
});

module.exports = router;
