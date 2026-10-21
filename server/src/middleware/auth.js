const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { isCollegeEmail } = require('../utils/collegeEmail');

/**
 * JWT authentication middleware.
 * Extracts token from Authorization header, verifies it,
 * and attaches the user object to req.user.
 */
async function authenticate(req, res, next) {
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
    if (!decoded.id || decoded.type === 'refresh') {
      return res.status(401).json({ error: 'Invalid access token' });
    }
    const result = await pool.query(
      'SELECT id, email, role, full_name, is_active, email_verified, academic_class_id FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !user.email_verified || !isCollegeEmail(user.email)) {
      return res.status(401).json({ error: 'Account is not eligible to access Snippet' });
    }
    // Database values are authoritative for current email and role, including old JWTs.
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      academicClassId: user.academic_class_id,
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
}

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
    if (!decoded.id || decoded.type === 'refresh' || !isCollegeEmail(decoded.email)) return next();
    // Optional auth never grants permissions; routes using it must still call authenticate.
    req.user = decoded;
  } catch {
    // Ignore invalid tokens in optional auth
  }
  next();
}

module.exports = { authenticate, authorize, optionalAuth };
