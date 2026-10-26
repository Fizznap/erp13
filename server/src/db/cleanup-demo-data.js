const { pool } = require('./pool');
require('dotenv').config();

const DEMO_EMAILS = [
  'admin@snippet.edu',
  'faculty@snippet.edu',
  'student@snippet.edu',
  'faculty@ustu.edu.in',
];
const DEMO_SUBJECT_CODES = ['CS101', 'CS201', 'CS301', 'CS302', 'CS303', 'CS304', 'CS301L'];

async function cleanupDemoData() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const users = await client.query(
      'SELECT id FROM users WHERE lower(email) = ANY($1::text[])',
      [DEMO_EMAILS],
    );
    const subjects = await client.query(
      'SELECT id FROM subjects WHERE code = ANY($1::text[])',
      [DEMO_SUBJECT_CODES],
    );
    const userIds = users.rows.map((row) => row.id);
    const subjectIds = subjects.rows.map((row) => row.id);

    if (userIds.length || subjectIds.length) {
      await client.query(
        `DELETE FROM attendance_records
         WHERE session_id IN (
           SELECT id FROM attendance_sessions
           WHERE faculty_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])
         )`,
        [userIds, subjectIds],
      );
      await client.query(
        `DELETE FROM attendance_sessions
         WHERE faculty_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])`,
        [userIds, subjectIds],
      );
      await client.query('DELETE FROM resources WHERE uploaded_by = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])', [userIds, subjectIds]);
      await client.query('DELETE FROM subject_enrollments WHERE student_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])', [userIds, subjectIds]);
      await client.query('DELETE FROM subject_offerings WHERE faculty_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])', [userIds, subjectIds]);
      await client.query('DELETE FROM ai_audit_logs WHERE user_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])', [userIds, subjectIds]);
      await client.query('UPDATE subjects SET faculty_id = NULL WHERE faculty_id = ANY($1::uuid[])', [userIds]);
      await client.query('DELETE FROM subjects WHERE id = ANY($1::uuid[])', [subjectIds]);
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }

    await client.query('COMMIT');
    console.log(`Removed ${userIds.length} demo user(s) and ${subjectIds.length} demo subject(s)`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

cleanupDemoData()
  .catch((error) => {
    console.error('Demo-data cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
