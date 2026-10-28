const express = require('express');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/academic/hierarchy - Returns full academic tree
router.get('/hierarchy', authenticate, async (req, res) => {
  try {
    const branches = await pool.query('SELECT * FROM branches ORDER BY name');
    const batches = await pool.query('SELECT * FROM batches ORDER BY start_year DESC');
    const divisions = await pool.query('SELECT * FROM divisions ORDER BY name');
    const semesters = await pool.query('SELECT * FROM semesters ORDER BY number');
    const subjects = await pool.query('SELECT * FROM subjects ORDER BY name');
    const faculty = await pool.query("SELECT id, full_name, email, role FROM users WHERE role IN ('faculty', 'admin') AND is_active = true ORDER BY role, full_name");
    const classes = await pool.query(`
      SELECT ac.*, 
             br.name as branch_name, br.code as branch_code,
             ba.start_year, ba.end_year,
             d.name as division_name,
             s.number as semester_number
      FROM academic_classes ac
      JOIN branches br ON ac.branch_id = br.id
      JOIN batches ba ON ac.batch_id = ba.id
      JOIN divisions d ON ac.division_id = d.id
      JOIN semesters s ON ac.semester_id = s.id
    `);
    const labGroups = await pool.query(`
      SELECT g.*, br.name AS branch_name, br.code AS branch_code,
             ba.start_year, ba.end_year, d.name AS division_name
      FROM academic_lab_groups g
      JOIN branches br ON br.id = g.branch_id
      JOIN batches ba ON ba.id = g.batch_id
      JOIN divisions d ON d.id = g.division_id
      ORDER BY br.name, ba.start_year DESC, d.name, g.name
    `);

    res.json({
      branches: branches.rows,
      batches: batches.rows,
      divisions: divisions.rows,
      semesters: semesters.rows,
      classes: classes.rows,
      subjects: subjects.rows,
      faculty: faculty.rows,
      labGroups: labGroups.rows
    });
  } catch (err) {
    console.error('Get hierarchy error:', err);
    res.status(500).json({ error: 'Failed to fetch academic hierarchy' });
  }
});

// POST endpoints for Admins to create hierarchy entities
router.post('/branches', authenticate, authorize('admin'), async (req, res) => {
  const { name, code } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO branches (name, code) VALUES ($1, $2) RETURNING *',
      [name, code]
    );
    res.status(201).json({ branch: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create branch' });
  }
});

router.post('/batches', authenticate, authorize('admin'), async (req, res) => {
  const { startYear, endYear } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO batches (start_year, end_year) VALUES ($1, $2) RETURNING *',
      [startYear, endYear]
    );
    res.status(201).json({ batch: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

router.post('/divisions', authenticate, authorize('admin'), async (req, res) => {
  const { name } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO divisions (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json({ division: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create division' });
  }
});

router.post('/semesters', authenticate, authorize('admin'), async (req, res) => {
  const { number } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO semesters (number) VALUES ($1) RETURNING *',
      [number]
    );
    res.status(201).json({ semester: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create semester' });
  }
});

router.post('/classes', authenticate, authorize('admin'), async (req, res) => {
  const { branchId, batchId, divisionId, semesterId } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO academic_classes (branch_id, batch_id, division_id, semester_id) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [branchId, batchId, divisionId, semesterId]
    );
    res.status(201).json({ academicClass: result.rows[0] });
  } catch (err) {
    console.error('Create academic class error:', err);
    res.status(500).json({ error: 'Failed to create academic class' });
  }
});

// POST /api/academic/lab-groups — configure the groups used for lab attendance.
router.post('/lab-groups', authenticate, authorize('admin'), async (req, res) => {
  const { branchId, batchId, divisionId } = req.body || {};
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().toUpperCase() : '';
  if (!branchId || !batchId || !divisionId || !/^[A-Z0-9][A-Z0-9 -]{0,49}$/.test(name)) {
    return res.status(400).json({ error: 'Branch, batch, division, and a valid group name are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO academic_lab_groups (branch_id, batch_id, division_id, name)
       SELECT br.id, ba.id, d.id, $4
       FROM branches br CROSS JOIN batches ba CROSS JOIN divisions d
       WHERE br.id = $1 AND ba.id = $2 AND d.id = $3
       RETURNING *`,
      [branchId, batchId, divisionId, name]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Select a configured branch, batch, and division' });
    return res.status(201).json({ labGroup: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That lab group already exists for this division' });
    console.error('Create lab group error:', err);
    return res.status(500).json({ error: 'Failed to create lab group' });
  }
});

module.exports = router;
