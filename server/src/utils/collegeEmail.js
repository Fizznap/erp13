const COLLEGE_DOMAIN = 'ustu.edu.in';

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function isCollegeEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized !== null && normalized.endsWith(`@${COLLEGE_DOMAIN}`);
}

module.exports = { COLLEGE_DOMAIN, normalizeEmail, isCollegeEmail };
