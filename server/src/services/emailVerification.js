const crypto = require('crypto');
const nodemailer = require('nodemailer');

class EmailDeliveryConfigurationError extends Error {}

function makeVerificationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function sendVerificationEmail(email, fullName, token) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, CLIENT_URL } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !CLIENT_URL) {
    throw new EmailDeliveryConfigurationError('Email delivery is not configured');
  }

  const frontendOrigin = CLIENT_URL.split(',')[0].trim();
  const link = new URL('/auth', frontendOrigin);
  link.searchParams.set('verifyEmail', token);
  const displayName = escapeHtml(fullName);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    requireTLS: Number(SMTP_PORT) !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Verify your Snippet college email',
    text: `Hello ${fullName},\n\nConfirm your college email to activate your Snippet account: ${link}\n\nThis link expires in 24 hours. If you did not request this account, ignore this email.`,
    html: `<p>Hello ${displayName},</p><p>Confirm your college email to activate your Snippet account.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours. If you did not request this account, ignore this email.</p>`,
  });
}

module.exports = { makeVerificationToken, sendVerificationEmail, EmailDeliveryConfigurationError };
