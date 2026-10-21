const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { isCollegeEmail, normalizeEmail } = require('../utils/collegeEmail');
const { verifyGoogleIdToken, GoogleIdentityConfigurationError } = require('../services/googleIdentity');
const {
  makeVerificationToken,
  sendVerificationEmail,
  EmailDeliveryConfigurationError,
} = require('../services/emailVerification');

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
    const { email: rawEmail, password, fullName } = req.body;
    const email = normalizeEmail(rawEmail);

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!isCollegeEmail(email)) {
      return res.status(403).json({ error: 'Use your verified @ustu.edu.in college email' });
    }
    const safeFullName = typeof fullName === 'string' ? fullName.trim() : '';
    if (!safeFullName || safeFullName.length > 255) {
      return res.status(400).json({ error: 'Full name must be between 1 and 255 characters' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE lower(trim(email)) = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verification = makeVerificationToken();
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, email_verified,
                          email_verification_token_hash, email_verification_expires_at)
       VALUES ($1, $2, $3, 'student', false, $4, now() + interval '24 hours') RETURNING *`,
      [email, passwordHash, safeFullName, verification.tokenHash]
    );

    await sendVerificationEmail(email, safeFullName, verification.token);
    res.status(202).json({ message: 'Check your college email for a verification link before signing in.' });
  } catch (err) {
    if (err instanceof EmailDeliveryConfigurationError) {
      return res.status(503).json({ error: 'Email verification is not configured. Try again later.' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/verify-email — consume the one-time email confirmation token.
router.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = req.body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({ error: 'A valid verification token is required' });
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified = true, email_verification_token_hash = NULL,
           email_verification_expires_at = NULL, updated_at = now()
       WHERE email_verification_token_hash = $1
         AND email_verification_expires_at > now()
         AND is_active = true
         AND right(lower(trim(email)), length($2)) = $2
       RETURNING id`,
      [tokenHash, '@ustu.edu.in']
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Verification link is invalid or expired' });
    }
    return res.json({ message: 'College email verified. You can now sign in.' });
  } catch (err) {
    console.error('Email verification error:', err);
    return res.status(500).json({ error: 'Email verification failed' });
  }
});

// POST /api/auth/verification/resend — generic response prevents account enumeration.
router.post('/verification/resend', authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email || !isCollegeEmail(email)) {
    return res.status(403).json({ error: 'Use your @ustu.edu.in college email' });
  }
  try {
    const result = await pool.query(
      `SELECT id, email, full_name FROM users
       WHERE lower(trim(email)) = $1 AND is_active = true AND email_verified = false`,
      [email]
    );
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const verification = makeVerificationToken();
      await pool.query(
        `UPDATE users SET email_verification_token_hash = $1,
                           email_verification_expires_at = now() + interval '24 hours',
                           updated_at = now() WHERE id = $2`,
        [verification.tokenHash, user.id]
      );
      await sendVerificationEmail(user.email, user.full_name, verification.token);
    }
    return res.json({ message: 'If this college account needs verification, a new link has been sent.' });
  } catch (err) {
    if (err instanceof EmailDeliveryConfigurationError) {
      return res.status(503).json({ error: 'Email verification is not configured. Try again later.' });
    }
    console.error('Resend verification error:', err);
    return res.status(500).json({ error: 'Could not send a verification link' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;
    const email = normalizeEmail(rawEmail);

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!isCollegeEmail(email)) {
      return res.status(403).json({ error: 'Use your @ustu.edu.in college email' });
    }

    const result = await pool.query('SELECT * FROM users WHERE lower(trim(email)) = $1', [email]);
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
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Verify your college email before signing in' });
    }

    const tokens = generateTokens(user);
    res.json({ user: sanitizeUser(user), ...tokens });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/google — verify Google's signed ID token before issuing Snippet tokens.
router.post('/google', authLimiter, async (req, res) => {
  try {
    const { credential } = req.body;
    if (typeof credential !== 'string' || credential.length === 0 || credential.length > 10000) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    const identity = await verifyGoogleIdToken(credential);
    const result = await pool.query('SELECT * FROM users WHERE lower(trim(email)) = $1', [identity.email]);
    let user = result.rows[0];

    if (user && !user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    if (!user) {
      // Keep the existing schema's password_hash requirement without creating a usable password.
      const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      const created = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, email_verified)
         VALUES ($1, $2, $3, 'student', true) RETURNING *`,
        [identity.email, randomPasswordHash, identity.fullName]
      );
      user = created.rows[0];
    } else if (!user.email_verified) {
      const verified = await pool.query(
        `UPDATE users SET email_verified = true, email_verification_token_hash = NULL,
                          email_verification_expires_at = NULL, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [user.id]
      );
      user = verified.rows[0];
    }

    res.json({ user: sanitizeUser(user), ...generateTokens(user) });
  } catch (err) {
    if (err instanceof GoogleIdentityConfigurationError) {
      return res.status(503).json({ error: 'Google sign-in is not configured' });
    }
    // Invalid, expired, wrong-audience, wrong-issuer, and rejected domain claims are auth failures.
    return res.status(401).json({ error: 'Google sign-in could not be verified for this college account' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', authLimiter, async (req, res) => {
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
    if (!isCollegeEmail(user.email)) {
      return res.status(403).json({ error: 'This account is not eligible to sign in' });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Verify your college email before signing in' });
    }
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
