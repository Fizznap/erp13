const express = require('express');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/subjects — list subjects based on role
router.get('/', authenticate, async (req, res) => {
  try {
    let result;
    if (req.user.role === 'student') {
      // Students see subject offerings tied to their academic class
      const user = await pool.query('SELECT academic_class_id FROM users WHERE id = $1', [req.user.id]);
      const classId = user.rows[0]?.academic_class_id;

      if (!classId) {
        return res.json({ subjects: [] });
      }

      result = await pool.query(
        `SELECT s.*, so.id AS offering_id, u.full_name AS faculty_name,
                (SELECT COUNT(*) FROM resources WHERE subject_offering_id = so.id AND status = 'ready') AS resource_count,
                true AS is_enrolled
         FROM subject_offerings so
         JOIN subjects s ON so.subject_id = s.id
         JOIN users u ON u.id = so.faculty_id
         WHERE so.academic_class_id = $1
         ORDER BY s.name`,
        [classId]
      );
    } else if (req.user.role === 'faculty') {
      // Faculty see their own offerings
      result = await pool.query(
        `SELECT s.*, so.id AS offering_id, 
                br.name AS branch_name, d.name AS division_name, ba.start_year AS batch_year, s2.number AS semester_number,
                (SELECT full_name FROM users WHERE id = so.faculty_id) AS faculty_name,
                (SELECT COUNT(*) FROM resources WHERE subject_offering_id = so.id) AS resource_count
         FROM subject_offerings so
         JOIN subjects s ON so.subject_id = s.id
         JOIN academic_classes ac ON so.academic_class_id = ac.id
         JOIN branches br ON ac.branch_id = br.id
         JOIN divisions d ON ac.division_id = d.id
         JOIN batches ba ON ac.batch_id = ba.id
         JOIN semesters s2 ON ac.semester_id = s2.id
         WHERE so.faculty_id = $1
         ORDER BY s.name`,
        [req.user.id]
      );
    } else {
      // Admin sees all offerings + subjects
      result = await pool.query(
        `SELECT s.*, so.id AS offering_id, u.full_name AS faculty_name,
                br.name AS branch_name, d.name AS division_name,
                (SELECT COUNT(*) FROM resources WHERE subject_offering_id = so.id) AS resource_count
         FROM subject_offerings so
         JOIN subjects s ON so.subject_id = s.id
         JOIN users u ON u.id = so.faculty_id
         JOIN academic_classes ac ON so.academic_class_id = ac.id
         JOIN branches br ON ac.branch_id = br.id
         JOIN divisions d ON ac.division_id = d.id
         ORDER BY s.name`
      );
    }
    res.json({ subjects: result.rows });
  } catch (err) {
    console.error('List subjects error:', err);
    res.status(500).json({ error: 'Failed to list subjects' });
  }
});

// POST /api/subjects — create subject (faculty or admin) - creates base subject
router.post('/', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const result = await pool.query(
      `INSERT INTO subjects (name, code, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, code, description || null]
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

// POST /api/subjects/offerings — bind subject to a class and faculty
router.post('/offerings', authenticate, authorize('admin', 'faculty'), async (req, res) => {
  try {
    const { subjectId, academicClassId, facultyId } = req.body;
    if (!subjectId || !academicClassId || !facultyId) {
      return res.status(400).json({ error: 'subjectId, academicClassId, and facultyId are required' });
    }

    const result = await pool.query(
      `INSERT INTO subject_offerings (subject_id, academic_class_id, faculty_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [subjectId, academicClassId, facultyId]
    );

    res.status(201).json({ offering: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Subject offering already exists for this class' });
    }
    console.error('Create offering error:', err);
    res.status(500).json({ error: 'Failed to create subject offering' });
  }
});

// GET /api/subjects/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.* FROM subjects s WHERE s.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    res.json({ subject: result.rows[0] });
  } catch (err) {
    console.error('Get subject error:', err);
    res.status(500).json({ error: 'Failed to get subject' });
  }
});

module.exports = router;
