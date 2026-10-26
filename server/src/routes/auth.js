const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../db/pool');
const { authenticate, authenticateForProfile, authenticateOnboarding, isProfileComplete } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { isCollegeEmail, normalizeEmail } = require('../utils/collegeEmail');
const { parseStudentRollNumber, canonicalBranchCode } = require('../utils/studentRollNumber');
const { verifyGoogleIdToken, GoogleIdentityConfigurationError } = require('../services/googleIdentity');
const {
  makeVerificationToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
  EmailDeliveryConfigurationError,
} = require('../services/emailVerification');

const router = express.Router();
const configuredAdminEmail = () => process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'smit2shinde2@gmail.com';
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

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

function createOnboardingToken(user) {
  return jwt.sign(
    { id: user.id, purpose: 'onboarding' },
    process.env.JWT_SECRET,
    { expiresIn: '30m' }
  );
}

async function loadProfile(userId, db = pool) {
  const result = await db.query(
    `SELECT u.*, p.google_picture_url, p.preferred_name, p.college_id, p.program, p.roll_number,
            p.year_of_study, p.admission_year, p.expected_graduation_year, p.phone, p.bio,
            p.skills, p.interests, p.achievements, p.linkedin_url, p.github_url, p.portfolio_url,
            p.registration_completed_at, p.academic_lab_group_id,
            EXISTS (SELECT 1 FROM user_avatars ua WHERE ua.user_id = u.id) AS has_uploaded_photo,
            (SELECT ua.updated_at FROM user_avatars ua WHERE ua.user_id = u.id) AS uploaded_photo_updated_at,
            br.name AS branch_name, br.code AS branch_code, ba.start_year AS batch_start_year,
            ba.end_year AS batch_end_year, d.name AS division_name, s.number AS semester_number,
            lg.name AS lab_group_name
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
     LEFT JOIN academic_classes ac ON ac.id = u.academic_class_id
     LEFT JOIN branches br ON br.id = ac.branch_id
     LEFT JOIN batches ba ON ba.id = ac.batch_id
     LEFT JOIN divisions d ON d.id = ac.division_id
     LEFT JOIN semesters s ON s.id = ac.semester_id
     LEFT JOIN academic_lab_groups lg ON lg.id = p.academic_lab_group_id
     WHERE u.id = $1`,
    [userId]
  );
  return result.rows[0];
}

function profilePayload(user) {
  return {
    googlePictureUrl: user.google_picture_url || null,
    hasUploadedPhoto: Boolean(user.has_uploaded_photo),
    avatarUpdatedAt: user.uploaded_photo_updated_at || null,
    preferredName: user.preferred_name || null,
    collegeId: user.college_id || null,
    program: user.program || null,
    rollNumber: user.roll_number || null,
    yearOfStudy: user.year_of_study || null,
    admissionYear: user.admission_year || null,
    expectedGraduationYear: user.expected_graduation_year || null,
    phone: user.phone || null,
    bio: user.bio || null,
    skills: user.skills || [],
    interests: user.interests || [],
    achievements: user.achievements || [],
    linkedinUrl: user.linkedin_url || null,
    githubUrl: user.github_url || null,
    portfolioUrl: user.portfolio_url || null,
    branchName: user.branch_name || null,
    branchCode: user.branch_code || null,
    divisionName: user.division_name || null,
    semesterNumber: user.semester_number || null,
    academicLabGroupId: user.academic_lab_group_id || null,
    labGroupName: user.lab_group_name || null,
    batchStartYear: user.batch_start_year || null,
    batchEndYear: user.batch_end_year || null,
  };
}

function authResult(user) {
  const safeUser = sanitizeUser(user);
  const requiresOnboarding = !isProfileComplete(user);
  if (requiresOnboarding) {
    return { user: safeUser, accessToken: createOnboardingToken(user), refreshToken: null, requiresOnboarding: true };
  }
  return { user: safeUser, ...generateTokens(user), requiresOnboarding: false };
}

function cleanString(value, max, { required = false } = {}) {
  if (typeof value !== 'string') return required ? null : '';
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > max) return null;
  return cleaned;
}

function cleanList(value, maxCount = 12) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxCount) return null;
  const items = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
  if (items.some((entry) => !entry || entry.length > 100)) return null;
  return [...new Set(items)];
}

function safeUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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


// POST /api/auth/forgot-password — request a password reset link
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email: rawEmail } = req.body || {};
  const email = normalizeEmail(rawEmail);

  if (!email || !isCollegeEmail(email)) {
    return res.status(403).json({ error: 'Use your @ustu.edu.in college email' });
  }

  try {
    const result = await pool.query(
      `SELECT id, full_name FROM users WHERE lower(trim(email)) = $1 AND is_active = true AND email_verified = true`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ message: 'If this college account exists and is verified, a password reset link has been sent.' });
    }

    const user = result.rows[0];
    const verification = makeVerificationToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      `UPDATE users SET password_reset_token_hash = $1, password_reset_expires_at = $2, updated_at = now() WHERE id = $3`,
      [verification.tokenHash, expiresAt, user.id]
    );

    try {
      await sendPasswordResetEmail(user.email, user.full_name, verification.token);
    } catch (err) {
      if (err instanceof EmailDeliveryConfigurationError) {
        return res.status(503).json({ error: 'Password reset email is not configured. Try again later.' });
      }
      console.error('Send password reset email error:', err);
      return res.status(500).json({ error: 'Could not send password reset email' });
    }

    return res.json({ message: 'If this college account exists and is verified, a password reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Password reset request failed' });
  }
});

// POST /api/auth/reset-password — confirm password reset with a token
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({ error: 'A valid reset token is required' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const result = await pool.query(
      `SELECT id FROM users WHERE password_reset_token_hash = $1 AND password_reset_expires_at > now() AND is_active = true AND email_verified = true`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query(
      `UPDATE users SET password_hash = $1, password_reset_token_hash = NULL, password_reset_expires_at = NULL, updated_at = now() WHERE id = $2`,
      [passwordHash, result.rows[0].id]
    );

    return res.json({ message: 'Your password has been reset. You can now sign in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Password reset failed' });
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
    if (!isCollegeEmail(email) && email !== configuredAdminEmail()) {
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

    const latest = await loadProfile(user.id);
    res.json(authResult(latest));
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
    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      const subjectResult = await client.query(
        `SELECT user_id FROM user_auth_identities WHERE provider = 'google' AND provider_subject = $1 FOR UPDATE`,
        [identity.subject]
      );
      const emailResult = await client.query('SELECT * FROM users WHERE lower(trim(email)) = $1 FOR UPDATE', [identity.email]);
      user = emailResult.rows[0];
      const linkedResult = user
        ? await client.query(`SELECT provider_subject FROM user_auth_identities WHERE user_id = $1 AND provider = 'google' FOR UPDATE`, [user.id])
        : { rows: [] };
      if (subjectResult.rows[0] && (!user || subjectResult.rows[0].user_id !== user.id)) {
        throw Object.assign(new Error('Google identity is already linked to another account'), { status: 403 });
      }
      if (linkedResult.rows[0] && linkedResult.rows[0].provider_subject !== identity.subject) {
        throw Object.assign(new Error('A different Google account is already linked'), { status: 403 });
      }
      if (user && !user.is_active) throw Object.assign(new Error('Account is deactivated'), { status: 403 });

      if (!user) {
        const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
        const created = await client.query(
          `INSERT INTO users (email, password_hash, full_name, role, email_verified)
           VALUES ($1, $2, $3, 'student', true) RETURNING *`,
          [identity.email, randomPasswordHash, identity.fullName]
        );
        user = created.rows[0];
      } else if (!user.email_verified) {
        const verified = await client.query(
          `UPDATE users SET email_verified = true, email_verification_token_hash = NULL,
                            email_verification_expires_at = NULL, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [user.id]
        );
        user = verified.rows[0];
      }

      await client.query(
        `INSERT INTO user_profiles (user_id, google_picture_url) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           google_picture_url = COALESCE(user_profiles.google_picture_url, EXCLUDED.google_picture_url),
           updated_at = now()`,
        [user.id, identity.picture || null]
      );
      await client.query(
        `INSERT INTO user_auth_identities (user_id, provider, provider_subject)
         VALUES ($1, 'google', $2) ON CONFLICT (user_id, provider) DO NOTHING`,
        [user.id, identity.subject]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const latest = await loadProfile(user.id);
    res.json(authResult(latest));
  } catch (err) {
    if (err instanceof GoogleIdentityConfigurationError) {
      return res.status(503).json({ error: 'Google sign-in is not configured' });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
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
    if (!isProfileComplete(await loadProfile(user.id))) {
      return res.status(403).json({ error: 'Complete student onboarding before refreshing this session', code: 'PROFILE_INCOMPLETE' });
    }

    // Reject if this refresh token has been revoked (logout).
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const revoked = await pool.query(
      'SELECT 1 FROM revoked_refresh_tokens WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash]
    );
    if (revoked.rows.length > 0) {
      return res.status(401).json({ error: 'Refresh token has been revoked. Sign in again.' });
    }

    const tokens = generateTokens(user);
    res.json({ ...tokens });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout — revoke the refresh token server-side
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body || {};

    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      // Decode the token to get its expiry for the revocation record's expires_at.
      let expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        if (decoded.exp) {
          expiresAt = new Date(decoded.exp * 1000);
        }
      } catch {
        // Keep far-future expiry if the token cannot be decoded.
      }
      await pool.query(
        `INSERT INTO revoked_refresh_tokens (token_hash, user_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_hash) DO NOTHING`,
        [tokenHash, req.user.id, expiresAt]
      );
    }

    res.json({ message: 'Logged out successfully. Refresh token revoked.' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateForProfile, async (req, res) => {
  try {
    const user = await loadProfile(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const requiresOnboarding = !isProfileComplete(user);
    res.json({ user: { ...sanitizeUser(user), profile: profilePayload(user), profileComplete: !requiresOnboarding }, requiresOnboarding });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

function detectAvatarType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function receiveAvatar(req, res, next) {
  avatarUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'Profile photo must be 2 MB or smaller' : 'Choose one profile photo',
      });
    }
    if (err) return res.status(400).json({ error: 'Could not read profile photo' });
    next();
  });
}

// GET /api/auth/avatar — private image bytes; the browser sends the normal API bearer token.
router.get('/avatar', authenticateForProfile, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT content_type, image_data FROM user_avatars WHERE user_id = $1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No uploaded profile photo' });
    res.set('Cache-Control', 'private, no-store');
    res.type(result.rows[0].content_type).send(result.rows[0].image_data);
  } catch (err) {
    console.error('Profile photo read error:', err);
    res.status(500).json({ error: 'Could not load profile photo' });
  }
});

// PUT /api/auth/avatar — photos are stored in Postgres, not Render's ephemeral filesystem.
router.put('/avatar', authenticateForProfile, authLimiter, receiveAvatar, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP profile photo' });
  const contentType = detectAvatarType(req.file.buffer);
  if (!contentType) return res.status(415).json({ error: 'Use a valid JPEG, PNG, or WebP image' });
  try {
    await pool.query(
      `INSERT INTO user_avatars (user_id, content_type, image_data, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE
       SET content_type = EXCLUDED.content_type, image_data = EXCLUDED.image_data, updated_at = now()`,
      [req.user.id, contentType, req.file.buffer]
    );
    res.json({ success: true, hasUploadedPhoto: true });
  } catch (err) {
    console.error('Profile photo upload error:', err);
    res.status(500).json({ error: 'Could not save profile photo' });
  }
});

router.delete('/avatar', authenticateForProfile, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_avatars WHERE user_id = $1', [req.user.id]);
    res.json({ success: true, hasUploadedPhoto: false });
  } catch (err) {
    console.error('Profile photo removal error:', err);
    res.status(500).json({ error: 'Could not remove profile photo' });
  }
});

// Onboarding data is available only to an incomplete account holding its short-lived restricted token.
router.get('/onboarding/options', authenticateOnboarding, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT ac.id, ac.branch_id, ac.batch_id, ac.division_id, br.name AS branch_name, br.code AS branch_code,
             ba.start_year, ba.end_year, d.name AS division_name, s.number AS semester_number
      FROM academic_classes ac
      JOIN branches br ON br.id = ac.branch_id
      JOIN batches ba ON ba.id = ac.batch_id
      JOIN divisions d ON d.id = ac.division_id
      JOIN semesters s ON s.id = ac.semester_id
      ORDER BY br.name, ba.start_year DESC, d.name, s.number
    `);
    const groups = await pool.query(`
      SELECT g.id, g.branch_id, g.batch_id, g.division_id, g.name,
             br.code AS branch_code, ba.start_year, ba.end_year, d.name AS division_name
      FROM academic_lab_groups g
      JOIN branches br ON br.id = g.branch_id
      JOIN batches ba ON ba.id = g.batch_id
      JOIN divisions d ON d.id = g.division_id
      ORDER BY br.name, ba.start_year DESC, d.name, g.name
    `);
    res.json({ classes: result.rows, labGroups: groups.rows });
  } catch (err) {
    console.error('Onboarding options error:', err);
    res.status(500).json({ error: 'Could not load configured academic classes' });
  }
});

router.post('/complete-profile', authenticateOnboarding, async (req, res) => {
  const body = req.body || {};
  const roll = parseStudentRollNumber(body.rollNumber);
  const collegeId = roll?.normalized || null;
  const program = 'B.Tech';
  const rollNumber = collegeId;
  const yearOfStudy = Number(body.yearOfStudy);
  const admissionYear = roll?.admissionYear;
  const expectedGraduationYear = Number(body.expectedGraduationYear);
  const academicClassId = cleanString(body.academicClassId, 64, { required: true });
  const hasBranchSelection = body.academicBranchId !== undefined || body.academicDivisionId !== undefined;
  const academicBranchId = hasBranchSelection ? cleanString(body.academicBranchId, 64, { required: true }) : null;
  const academicDivisionId = hasBranchSelection ? cleanString(body.academicDivisionId, 64, { required: true }) : null;
  const academicLabGroupId = cleanString(body.academicLabGroupId, 64, { required: true });
  const preferredName = cleanString(body.preferredName || '', 80);
  const phone = cleanString(body.phone || '', 32);
  const bio = cleanString(body.bio || '', 500);
  const skills = cleanList(body.skills);
  const interests = cleanList(body.interests);
  const achievements = cleanList(body.achievements);
  const linkedinUrl = safeUrl(body.linkedinUrl);
  const githubUrl = safeUrl(body.githubUrl);
  const portfolioUrl = safeUrl(body.portfolioUrl);
  const optionalTextInvalid = [preferredName, phone, bio].includes(null);
  if (!collegeId || !program || !rollNumber || !academicClassId ||
      (hasBranchSelection && (!academicBranchId || !academicDivisionId)) || !academicLabGroupId || optionalTextInvalid ||
      !Number.isInteger(yearOfStudy) || yearOfStudy < 1 || yearOfStudy > 4 ||
      !Number.isInteger(admissionYear) || admissionYear < 2000 || admissionYear > new Date().getFullYear() + 1 ||
      !Number.isInteger(expectedGraduationYear) || expectedGraduationYear < admissionYear + yearOfStudy - 1 || expectedGraduationYear > admissionYear + 8 ||
      !skills || !interests || !achievements ||
      linkedinUrl === undefined || githubUrl === undefined || portfolioUrl === undefined) {
    return res.status(400).json({ error: 'Check the required profile fields and optional details' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const classResult = await client.query(
      `SELECT ac.id, ac.branch_id, ac.batch_id, ac.division_id,
              br.code AS branch_code, ba.start_year, s.number AS semester_number
       FROM academic_classes ac
       JOIN branches br ON br.id = ac.branch_id
       JOIN batches ba ON ba.id = ac.batch_id
       JOIN semesters s ON s.id = ac.semester_id
       WHERE ac.id = $1 AND ($2::uuid IS NULL OR ac.branch_id = $2)
         AND ($3::uuid IS NULL OR ac.division_id = $3)`,
      [academicClassId, academicBranchId, academicDivisionId]
    );
    const selectedClass = classResult.rows[0];
    const firstSemesterOfYear = (yearOfStudy - 1) * 2 + 1;
    if (!selectedClass || canonicalBranchCode(selectedClass.branch_code) !== roll.branch.code ||
        Number(selectedClass.start_year) !== admissionYear ||
        Number(selectedClass.semester_number) < firstSemesterOfYear ||
        Number(selectedClass.semester_number) > firstSemesterOfYear + 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Select a configured class that matches your roll number branch and admission batch' });
    }
    const groupResult = await client.query(
      `SELECT id FROM academic_lab_groups
       WHERE id = $1 AND branch_id = $2 AND batch_id = $3 AND division_id = $4`,
      [academicLabGroupId, selectedClass.branch_id, selectedClass.batch_id, selectedClass.division_id]
    );
    if (!groupResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Select a lab group configured for your branch, batch, and division' });
    }
    await client.query(
      `INSERT INTO user_profiles
       (user_id, preferred_name, college_id, program, roll_number, year_of_study, admission_year,
        expected_graduation_year, phone, bio, skills, interests, achievements, linkedin_url, github_url,
        portfolio_url, academic_lab_group_id, registration_completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
       ON CONFLICT (user_id) DO UPDATE SET
         preferred_name=EXCLUDED.preferred_name, college_id=EXCLUDED.college_id, program=EXCLUDED.program,
         roll_number=EXCLUDED.roll_number, year_of_study=EXCLUDED.year_of_study,
         admission_year=EXCLUDED.admission_year, expected_graduation_year=EXCLUDED.expected_graduation_year,
         phone=EXCLUDED.phone, bio=EXCLUDED.bio, skills=EXCLUDED.skills, interests=EXCLUDED.interests,
         achievements=EXCLUDED.achievements, linkedin_url=EXCLUDED.linkedin_url,
         github_url=EXCLUDED.github_url, portfolio_url=EXCLUDED.portfolio_url,
         academic_lab_group_id=EXCLUDED.academic_lab_group_id,
         registration_completed_at=COALESCE(user_profiles.registration_completed_at, now()), updated_at=now()`,
      [req.user.id, preferredName || null, collegeId, program, rollNumber, yearOfStudy, admissionYear,
        expectedGraduationYear, phone || null, bio || null, skills, interests, achievements,
        linkedinUrl, githubUrl, portfolioUrl, academicLabGroupId]
    );
    await client.query(
      'UPDATE users SET academic_class_id = $1, full_name = COALESCE(NULLIF($2, \'\'), full_name), updated_at = now() WHERE id = $3',
      [academicClassId, preferredName || null, req.user.id]
    );
    await client.query('COMMIT');
    const user = await loadProfile(req.user.id);
    if (!isProfileComplete(user)) return res.status(500).json({ error: 'Profile could not be completed' });
    res.json({ user: { ...sanitizeUser(user), profile: profilePayload(user), profileComplete: true }, ...generateTokens(user), requiresOnboarding: false });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'That college ID is already registered' });
    console.error('Complete profile error:', err);
    res.status(500).json({ error: 'Could not save your profile' });
  } finally {
    client.release();
  }
});

// PATCH /api/auth/me
router.patch('/me', authenticate, async (req, res) => {
  try {
    const { fullName, password } = req.body || {};
    let updateFields = [];
    let params = [];
    let paramCount = 1;

    if (fullName !== undefined) {
      const safeName = cleanString(fullName, 255, { required: true });
      if (!safeName) return res.status(400).json({ error: 'Full name must be between 1 and 255 characters' });
      updateFields.push(`full_name = $${paramCount++}`);
      params.push(safeName);
    }

    if (password !== undefined && password !== '') {
      if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      updateFields.push(`password_hash = $${paramCount++}`);
      params.push(passwordHash);
    }

    const fields = {
      preferredName: ['preferred_name', (value) => cleanString(value, 80)],
      collegeId: ['college_id', (value) => cleanString(value, 40, { required: true })],
      program: ['program', (value) => cleanString(value, 160, { required: true })],
      rollNumber: ['roll_number', (value) => cleanString(value, 40, { required: true })],
      yearOfStudy: ['year_of_study', (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10 ? Number(value) : undefined],
      admissionYear: ['admission_year', (value) => Number.isInteger(Number(value)) && Number(value) >= 2000 && Number(value) <= new Date().getFullYear() + 1 ? Number(value) : undefined],
      expectedGraduationYear: ['expected_graduation_year', (value) => Number.isInteger(Number(value)) && Number(value) >= 2000 && Number(value) <= new Date().getFullYear() + 13 ? Number(value) : undefined],
      phone: ['phone', (value) => cleanString(value, 32)],
      bio: ['bio', (value) => cleanString(value, 500)],
      skills: ['skills', (value) => cleanList(value)],
      interests: ['interests', (value) => cleanList(value)],
      achievements: ['achievements', (value) => cleanList(value)],
      linkedinUrl: ['linkedin_url', safeUrl],
      githubUrl: ['github_url', safeUrl],
      portfolioUrl: ['portfolio_url', safeUrl],
    };
    const profileUpdates = [];
    const profileValues = [];
    for (const [key, [column, clean]] of Object.entries(fields)) {
      if (req.body?.[key] === undefined) continue;
      const value = clean(req.body[key]);
      if (value === null || value === undefined) return res.status(400).json({ error: `Invalid ${key}` });
      profileUpdates.push(column);
      profileValues.push(value === '' ? null : value);
    }

    if (req.body?.email !== undefined || req.body?.role !== undefined || req.body?.academicClassId !== undefined ||
        req.body?.collegeId !== undefined || req.body?.program !== undefined || req.body?.rollNumber !== undefined ||
        req.body?.admissionYear !== undefined) {
      return res.status(400).json({ error: 'Email, role, roll number / PRN, branch, admission batch, and class assignment cannot be changed here' });
    }

    if (updateFields.length === 0 && profileUpdates.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    if (updateFields.length) {
      params.push(req.user.id);
      await pool.query(
        `UPDATE users SET ${updateFields.join(', ')}, updated_at = now() WHERE id = $${paramCount}`,
        params
      );
    }
    if (req.body?.preferredName !== undefined && req.body?.fullName === undefined) {
      const displayName = cleanString(req.body.preferredName, 80);
      if (displayName === null) return res.status(400).json({ error: 'Invalid preferredName' });
      await pool.query(
        'UPDATE users SET full_name = COALESCE(NULLIF($1, \'\'), full_name), updated_at = now() WHERE id = $2',
        [displayName, req.user.id]
      );
    }
    if (profileUpdates.length) {
      const values = profileValues.map((_, index) => `$${index + 2}`).join(', ');
      const setters = profileUpdates.map((column, index) => `${column} = EXCLUDED.${column}`).join(', ');
      await pool.query(
        `INSERT INTO user_profiles (user_id, ${profileUpdates.join(', ')}) VALUES ($1, ${values})
         ON CONFLICT (user_id) DO UPDATE SET ${setters}, updated_at = now()`,
        [req.user.id, ...profileValues]
      );
    }
    const user = await loadProfile(req.user.id);
    res.json({ user: { ...sanitizeUser(user), profile: profilePayload(user), profileComplete: isProfileComplete(user) } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That college ID is already registered' });
    console.error('Update me error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;
