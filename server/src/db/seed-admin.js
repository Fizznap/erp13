const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./pool');
require('dotenv').config();

const DEFAULT_ADMIN_EMAIL = 'smit2shinde2@gmail.com';
const DEFAULT_ADMIN_NAME = 'Smit Shinde';

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL).toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || DEFAULT_ADMIN_NAME;
  const configuredPassword = process.env.ADMIN_PASSWORD?.trim();
  if (configuredPassword && configuredPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
  }

  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  let initialPassword = null;
  if (!existing.rows.length) {
    initialPassword = configuredPassword || crypto.randomBytes(24).toString('base64url');
    const passwordHash = await bcrypt.hash(initialPassword, 12);
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
       VALUES ($1, $2, $3, 'admin', true, true)`,
      [email, passwordHash, name],
    );
  } else if (configuredPassword) {
    const passwordHash = await bcrypt.hash(configuredPassword, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, full_name = $2, role = 'admin',
                        is_active = true, email_verified = true, updated_at = now()
       WHERE id = $3`,
      [passwordHash, name, existing.rows[0].id],
    );
  } else {
    await pool.query(
      `UPDATE users SET full_name = $1, role = 'admin', is_active = true,
                        email_verified = true, updated_at = now()
       WHERE id = $2`,
      [name, existing.rows[0].id],
    );
  }

  console.log(`Admin account provisioned for ${email}`);
  if (initialPassword && !configuredPassword) {
    console.log(`Initial admin password (save it now): ${initialPassword}`);
  }
}

seedAdmin()
  .catch((error) => {
    console.error('Admin provisioning failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
