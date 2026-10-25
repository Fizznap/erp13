const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function initDatabase() {
  try {
    console.log('Initializing database...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schema);
    console.log('Database schema created successfully.');

    const studentProfilesMigration = fs.readFileSync(
      path.join(__dirname, 'migration_02_student_profiles.sql'),
      'utf-8'
    );
    await pool.query(studentProfilesMigration);
    console.log('Student profile schema is up to date.');

    const studentPhotosAndAttendanceMigration = fs.readFileSync(
      path.join(__dirname, 'migration_03_student_photos_and_manual_attendance.sql'),
      'utf-8'
    );
    await pool.query(studentPhotosAndAttendanceMigration);
    console.log('Student photos and manual attendance schema is up to date.');

    const revokedRefreshTokensMigration = fs.readFileSync(
      path.join(__dirname, 'migration_04_revoked_refresh_tokens.sql'),
      'utf-8'
    );
    await pool.query(revokedRefreshTokensMigration);
    console.log('Revoked refresh tokens schema is up to date.');

    const passwordResetTokensMigration = fs.readFileSync(
      path.join(__dirname, 'migration_05_password_reset_tokens.sql'),
      'utf-8'
    );
    await pool.query(passwordResetTokensMigration);
    console.log('Password reset tokens schema is up to date.');

    // Add subject_offering_id and new tracking columns to resources
    await pool.query(`
      ALTER TABLE resources ADD COLUMN IF NOT EXISTS subject_offering_id UUID REFERENCES subject_offerings(id) ON DELETE CASCADE;
      ALTER TABLE resources ADD COLUMN IF NOT EXISTS kind VARCHAR(50) DEFAULT 'Notes';
      ALTER TABLE resources ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;
      ALTER TABLE resources ADD COLUMN IF NOT EXISTS stage VARCHAR(50) DEFAULT 'QUEUED';
    `);

    // Create IVFFlat index for vector search (requires existing data for training)
    // We'll create it as a post-step after initial data is loaded
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chunks_embedding 
        ON resource_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      `);
      console.log('Vector index created.');
    } catch (err) {
      // IVFFlat index creation may fail if no data exists yet — that's fine
      console.log('Vector index deferred (will be created when data exists).');
    }

    process.exit(0);
  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  }
}

initDatabase();
