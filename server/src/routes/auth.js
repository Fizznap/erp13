const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

function generateTokens(user) {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    isActive: user.is_active,
    academicClassId: user.academic_class_id,
    createdAt: user.created_at,
  };
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, fullName, role } = req.body;

    if (!email || !password || !fullName || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!['student', 'faculty', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be student, faculty, or admin' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [email, passwordHash, fullName, role]
    );

    const user = result.rows[0];
    const tokens = generateTokens(user);

    res.status(201).json({ user: sanitizeUser(user), ...tokens });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const tokens = generateTokens(user);
    res.json({ user: sanitizeUser(user), ...tokens });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.id]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const user = result.rows[0];
    const tokens = generateTokens(user);
    res.json({ ...tokens });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: sanitizeUser(result.rows[0]) });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/auth/me
router.patch('/me', authenticate, async (req, res) => {
  try {
    const { fullName, password } = req.body;
    let updateFields = [];
    let params = [];
    let paramCount = 1;

    if (fullName) {
      updateFields.push(`full_name = $${paramCount++}`);
      params.push(fullName);
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      updateFields.push(`password_hash = $${paramCount++}`);
      params.push(passwordHash);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(req.user.id);
    const result = await pool.query(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = now() WHERE id = $${paramCount} RETURNING *`,
      params
    );

    res.json({ user: sanitizeUser(result.rows[0]) });
  } catch (err) {
    console.error('Update me error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;
