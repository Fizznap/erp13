const { pool } = require('./pool');
const fs = require('fs');
require('dotenv').config();

const DEMO_EMAILS = [
  'admin@snippet.edu',
  'faculty@snippet.edu',
  'student@snippet.edu',
  'faculty@ustu.edu.in',
];
const DEMO_SUBJECT_CODES = ['CS101', 'CS201'];

async function cleanupDemoData() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const users = await client.query(
      `SELECT id FROM users
       WHERE lower(email) = ANY($1::text[])
          OR lower(email) LIKE '%@snippet.test'`,
      [DEMO_EMAILS],
    );
    const subjects = await client.query(
      `SELECT id FROM subjects
       WHERE code = ANY($1::text[])
          OR lower(code) LIKE '%e2e%'
          OR lower(name) LIKE '%e2e%'`,
      [DEMO_SUBJECT_CODES],
    );
    const branches = await client.query(
      `SELECT id FROM branches
       WHERE lower(name) LIKE '%test%'
          OR lower(code) LIKE '%test%'`,
    );
    const batches = await client.query(
      'SELECT id FROM batches WHERE start_year >= 2100 OR end_year >= 2100',
    );
    const divisions = await client.query(
      `SELECT id FROM divisions
       WHERE lower(name) ~ '^div[a-z]+[0-9]+$'`,
    );
    const semesters = await client.query('SELECT id FROM semesters WHERE number >= 100');
    const userIds = users.rows.map((row) => row.id);
    const subjectIds = subjects.rows.map((row) => row.id);
    const branchIds = branches.rows.map((row) => row.id);
    const batchIds = batches.rows.map((row) => row.id);
    const divisionIds = divisions.rows.map((row) => row.id);
    const semesterIds = semesters.rows.map((row) => row.id);

    const classes = await client.query(
      `SELECT id FROM academic_classes
       WHERE branch_id = ANY($1::uuid[])
          OR batch_id = ANY($2::uuid[])
          OR division_id = ANY($3::uuid[])
          OR semester_id = ANY($4::uuid[])`,
      [branchIds, batchIds, divisionIds, semesterIds],
    );
    const classIds = classes.rows.map((row) => row.id);
    const labGroups = await client.query(
      `SELECT id FROM academic_lab_groups
       WHERE branch_id = ANY($1::uuid[])
          OR batch_id = ANY($2::uuid[])
          OR division_id = ANY($3::uuid[])`,
      [branchIds, batchIds, divisionIds],
    );
    const labGroupIds = labGroups.rows.map((row) => row.id);
    const offerings = await client.query(
      `SELECT id FROM subject_offerings
       WHERE subject_id = ANY($1::uuid[])
          OR academic_class_id = ANY($2::uuid[])
          OR faculty_id = ANY($3::uuid[])`,
      [subjectIds, classIds, userIds],
    );
    const offeringIds = offerings.rows.map((row) => row.id);
    const resources = await client.query(
      `SELECT file_path FROM resources
       WHERE subject_id = ANY($1::uuid[])
          OR uploaded_by = ANY($2::uuid[])
          OR subject_offering_id = ANY($3::uuid[])`,
      [subjectIds, userIds, offeringIds],
    );

    if (userIds.length || subjectIds.length || classIds.length || branchIds.length || batchIds.length || divisionIds.length || semesterIds.length) {
      await client.query(
        `DELETE FROM attendance_records
         WHERE session_id IN (
           SELECT id FROM attendance_sessions
           WHERE faculty_id = ANY($1::uuid[])
              OR subject_id = ANY($2::uuid[])
              OR subject_offering_id = ANY($3::uuid[])
         )`,
        [userIds, subjectIds, offeringIds],
      );
      await client.query(
        `DELETE FROM attendance_sessions
         WHERE faculty_id = ANY($1::uuid[])
            OR subject_id = ANY($2::uuid[])
            OR subject_offering_id = ANY($3::uuid[])`,
        [userIds, subjectIds, offeringIds],
      );
      await client.query(
        `DELETE FROM resources
         WHERE uploaded_by = ANY($1::uuid[])
            OR subject_id = ANY($2::uuid[])
            OR subject_offering_id = ANY($3::uuid[])`,
        [userIds, subjectIds, offeringIds],
      );
      await client.query('DELETE FROM subject_enrollments WHERE student_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])', [userIds, subjectIds]);
      await client.query(
        `DELETE FROM subject_offerings
         WHERE faculty_id = ANY($1::uuid[])
            OR subject_id = ANY($2::uuid[])
            OR academic_class_id = ANY($3::uuid[])`,
        [userIds, subjectIds, classIds],
      );
      await client.query('DELETE FROM ai_audit_logs WHERE user_id = ANY($1::uuid[]) OR subject_id = ANY($2::uuid[])', [userIds, subjectIds]);
      await client.query('UPDATE subjects SET faculty_id = NULL WHERE faculty_id = ANY($1::uuid[])', [userIds]);
      await client.query('DELETE FROM subjects WHERE id = ANY($1::uuid[])', [subjectIds]);
      await client.query('UPDATE user_profiles SET academic_lab_group_id = NULL WHERE academic_lab_group_id = ANY($1::uuid[])', [labGroupIds]);
      await client.query('UPDATE users SET academic_class_id = NULL WHERE academic_class_id = ANY($1::uuid[])', [classIds]);
      await client.query('DELETE FROM academic_classes WHERE id = ANY($1::uuid[])', [classIds]);
      await client.query('DELETE FROM academic_lab_groups WHERE id = ANY($1::uuid[])', [labGroupIds]);
      await client.query('DELETE FROM branches WHERE id = ANY($1::uuid[])', [branchIds]);
      await client.query('DELETE FROM batches WHERE id = ANY($1::uuid[])', [batchIds]);
      await client.query('DELETE FROM divisions WHERE id = ANY($1::uuid[])', [divisionIds]);
      await client.query('DELETE FROM semesters WHERE id = ANY($1::uuid[])', [semesterIds]);
      await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }

    for (const row of resources.rows) {
      if (row.file_path && fs.existsSync(row.file_path)) {
        try { fs.unlinkSync(row.file_path); } catch { /* Database cleanup is authoritative. */ }
      }
    }

    await client.query('COMMIT');
    console.log(`Removed test data: ${userIds.length} user(s), ${subjectIds.length} subject(s), ${branchIds.length} branch(es), ${classIds.length} class(es)`);
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
