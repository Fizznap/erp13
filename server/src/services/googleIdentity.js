const { OAuth2Client } = require('google-auth-library');
const { COLLEGE_DOMAIN, isCollegeEmail, normalizeEmail } = require('../utils/collegeEmail');

class GoogleIdentityConfigurationError extends Error {}

async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new GoogleIdentityConfigurationError('Google sign-in is not configured');
  }

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();

  if (!payload || payload.email_verified !== true) {
    throw new Error('Google account email is not verified');
  }

  const email = normalizeEmail(payload.email);
  if (!email || !isCollegeEmail(email)) {
    throw new Error('A verified @ustu.edu.in account is required');
  }

  // Snippet uses the institution's managed Google Workspace domain.
  if (typeof payload.hd !== 'string' || payload.hd.toLowerCase() !== COLLEGE_DOMAIN) {
    throw new Error('A managed ustu.edu.in Google account is required');
  }

  return {
    email,
    fullName: typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 255)
      : email.split('@')[0],
  };
}

module.exports = { verifyGoogleIdToken, GoogleIdentityConfigurationError };
