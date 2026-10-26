const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
require('dotenv').config();

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured before provisioning the admin account`);
  return value;
}

async function seedAdmin() {
  const email = requiredEnv('ADMIN_EMAIL').toLowerCase();
  const name = requiredEnv('ADMIN_NAME');
  const password = requiredEnv('ADMIN_PASSWORD');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
     VALUES ($1, $2, $3, 'admin', true, true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name, role = 'admin', is_active = true,
       email_verified = true, updated_at = now()`,
    [email, passwordHash, name],
  );
  console.log(`Admin account provisioned for ${email}`);
}

seedAdmin()
  .catch((error) => {
    console.error('Admin provisioning failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
