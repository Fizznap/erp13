const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL || '';

const pool = new Pool({
  connectionString: dbUrl,
  // Managed Postgres (Render, Neon, Supabase) requires SSL
  ...(isProduction || dbUrl.includes('sslmode=require')
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  process.exit(-1);
});

module.exports = { pool };
