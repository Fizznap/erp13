const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { isCollegeEmail } = require('../utils/collegeEmail');

function isProfileComplete(user) {
  if (user.role !== 'student') return true;
  return Boolean(
    user.college_id && user.program && user.roll_number &&
    user.year_of_study != null && Number.isInteger(Number(user.year_of_study)) &&
    user.admission_year != null && Number.isInteger(Number(user.admission_year)) &&
    user.expected_graduation_year != null && Number.isInteger(Number(user.expected_graduation_year)) &&
    user.academic_class_id
  );
}

function createAuthenticate({ allowOnboarding = false, requireOnboarding = false, allowIncomplete = false } = {}) {
  return async function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  let token;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.id || decoded.type === 'refresh' || ![undefined, 'onboarding'].includes(decoded.purpose)) {
      return res.status(401).json({ error: 'Invalid access token' });
    }
    const isOnboardingToken = decoded.purpose === 'onboarding';
    if (isOnboardingToken && !allowOnboarding) {
      return res.status(403).json({ error: 'Complete student onboarding first', code: 'PROFILE_INCOMPLETE' });
    }
    if (requireOnboarding && !isOnboardingToken) {
      return res.status(403).json({ error: 'A restricted onboarding session is required' });
    }
    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.full_name, u.is_active, u.email_verified, u.academic_class_id,
              p.google_picture_url, p.preferred_name, p.college_id, p.program, p.roll_number,
              p.year_of_study, p.admission_year, p.expected_graduation_year, p.phone, p.bio,
              p.skills, p.interests, p.achievements, p.linkedin_url, p.github_url, p.portfolio_url,
              p.registration_completed_at,
              br.name AS branch_name, br.code AS branch_code, ba.start_year, ba.end_year,
              d.name AS division_name, s.number AS semester_number
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN academic_classes ac ON ac.id = u.academic_class_id
       LEFT JOIN branches br ON br.id = ac.branch_id
       LEFT JOIN batches ba ON ba.id = ac.batch_id
       LEFT JOIN divisions d ON d.id = ac.division_id
       LEFT JOIN semesters s ON s.id = ac.semester_id
       WHERE u.id = $1`,
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !user.email_verified || !isCollegeEmail(user.email)) {
      return res.status(401).json({ error: 'Account is not eligible to access Snippet' });
    }
    const profileComplete = isProfileComplete(user);
    if (requireOnboarding && profileComplete) {
      return res.status(403).json({ error: 'Student registration is already complete' });
    }
    if (!allowIncomplete && !profileComplete) {
      return res.status(403).json({
        error: 'Complete your student profile before using Snippet',
        code: 'PROFILE_INCOMPLETE',
      });
    }
    // Database values are authoritative for current email and role, including old JWTs.
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      academicClassId: user.academic_class_id,
      profileComplete,
      profile: {
        googlePictureUrl: user.google_picture_url,
        preferredName: user.preferred_name,
        collegeId: user.college_id,
        program: user.program,
        rollNumber: user.roll_number,
        yearOfStudy: user.year_of_study,
        admissionYear: user.admission_year,
        expectedGraduationYear: user.expected_graduation_year,
        phone: user.phone,
        bio: user.bio,
        skills: user.skills || [],
        interests: user.interests || [],
        achievements: user.achievements || [],
        linkedinUrl: user.linkedin_url,
        githubUrl: user.github_url,
        portfolioUrl: user.portfolio_url,
        registrationCompletedAt: user.registration_completed_at,
        branchName: user.branch_name,
        branchCode: user.branch_code,
        divisionName: user.division_name,
        semesterNumber: user.semester_number,
        batchStartYear: user.start_year,
        batchEndYear: user.end_year,
      },
    };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Authentication lookup failed:', err);
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  };
}

const authenticate = createAuthenticate();
const authenticateForProfile = createAuthenticate({ allowOnboarding: true, allowIncomplete: true });
const authenticateOnboarding = createAuthenticate({
  allowOnboarding: true,
  requireOnboarding: true,
  allowIncomplete: true,
});

/**
 * Role-based authorization middleware factory.
 * @param  {...string} roles - Allowed roles
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Optional auth — sets req.user if token is valid, but doesn't block.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.id || decoded.type === 'refresh' || decoded.purpose || !isCollegeEmail(decoded.email)) return next();
    // Optional auth never grants permissions; routes using it must still call authenticate.
    req.user = decoded;
  } catch {
    // Ignore invalid tokens in optional auth
  }
  next();
}

module.exports = { authenticate, authenticateForProfile, authenticateOnboarding, authorize, optionalAuth, isProfileComplete };
