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

  const issuerValid = payload?.iss === 'https://accounts.google.com' || payload?.iss === 'accounts.google.com';
  const audienceValid = payload?.aud === clientId || (Array.isArray(payload?.aud) && payload.aud.includes(clientId));
  const expiryValid = Number.isFinite(payload?.exp) && payload.exp > Math.floor(Date.now() / 1000);
  if (!issuerValid || !audienceValid || !expiryValid) {
    throw new Error('Google ID token issuer, audience, or expiration is invalid');
  }
  if (!payload || payload.email_verified !== true) {
    throw new Error('Google account email is not verified');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('Google account subject is missing');
  }

  const email = normalizeEmail(payload.email);
  if (!email || !isCollegeEmail(email)) {
    throw new Error('A verified @ustu.edu.in account is required');
  }

  // Snippet uses the institution's managed Google Workspace domain.
  if (typeof payload.hd !== 'string' || payload.hd.toLowerCase() !== COLLEGE_DOMAIN) {
    throw new Error('A managed ustu.edu.in Google account is required');
  }

  let picture = null;
  if (typeof payload.picture === 'string') {
    try {
      const pictureUrl = new URL(payload.picture);
      if (pictureUrl.protocol === 'https:' && pictureUrl.hostname.toLowerCase().endsWith('.googleusercontent.com')) {
        picture = pictureUrl.toString();
      }
    } catch {
      // Ignore malformed Google profile photo claims.
    }
  }

  return {
    subject: payload.sub,
    email,
    fullName: typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 255)
      : email.split('@')[0],
    picture,
  };
}

module.exports = { verifyGoogleIdToken, GoogleIdentityConfigurationError };
