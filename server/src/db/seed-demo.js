/**
 * Comprehensive, idempotent seed utility for demo student accounts, academic results, and attendance records.
 * Usage:
 *   node server/src/db/seed-demo.js           # Seeds demo data idempotently
 *   node server/src/db/seed-demo.js --dry-run # Previews without making DB changes
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@db:') && !process.env.DOCKER_CONTAINER) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@db:', '@localhost:');
}
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

const CORE_SUBJECTS = [
  { code: 'CS501', name: 'Computer Networks', credits: 4.0, isLab: false },
  { code: 'CS502', name: 'Database Management Systems', credits: 4.0, isLab: false },
  { code: 'CS503', name: 'Operating Systems', credits: 4.0, isLab: false },
  { code: 'CS504', name: 'Theory of Computation', credits: 4.0, isLab: false },
  { code: 'CS505', name: 'Design & Analysis of Algorithms', credits: 4.0, isLab: false },
  { code: 'CS501L', name: 'Computer Networks Lab', credits: 2.0, isLab: true },
];

const DEMO_STUDENTS = [
  {
    email: 'smit.haria@ustu.edu.in',
    fullName: 'Smit Haria',
    rollNumber: 'UST24R0102086',
    targetAttendedCount: 114, // 114 / 142 = 80.28% (exact reference screenshot)
    results: [
      { code: 'CS501', internal: 26, external: 58, total: 84 }, // A+ (9.0 GP)
      { code: 'CS502', internal: 27, external: 61, total: 88 }, // A+ (9.0 GP)
      { code: 'CS503', internal: 28, external: 63, total: 91 }, // O  (10.0 GP)
      { code: 'CS504', internal: 24, external: 54, total: 78 }, // A  (8.0 GP)
      { code: 'CS505', internal: 27, external: 58, total: 85 }, // A+ (9.0 GP)
    ],
  },
  {
    email: 'viraj.mengeri@ustu.edu.in',
    fullName: 'Viraj Mengeri',
    rollNumber: 'UST24R0102087',
    targetAttendedCount: 135, // ~95%
    results: [
      { code: 'CS501', internal: 28, external: 64, total: 92 }, // O  (10.0 GP)
      { code: 'CS502', internal: 29, external: 66, total: 95 }, // O  (10.0 GP)
      { code: 'CS503', internal: 27, external: 62, total: 89 }, // A+ (9.0 GP)
      { code: 'CS504', internal: 29, external: 64, total: 93 }, // O  (10.0 GP)
      { code: 'CS505', internal: 28, external: 62, total: 90 }, // O  (10.0 GP)
    ],
  },
  {
    email: 'sanaf.khan@ustu.edu.in',
    fullName: 'Sanaf Khan',
    rollNumber: 'UST24R0102088',
    targetAttendedCount: 99, // ~69.7% (at-risk)
    results: [
      { code: 'CS501', internal: 21, external: 44, total: 65 }, // B+ (7.0 GP)
      { code: 'CS502', internal: 23, external: 49, total: 72 }, // A  (8.0 GP)
      { code: 'CS503', internal: 22, external: 46, total: 68 }, // B+ (7.0 GP)
      { code: 'CS504', internal: 19, external: 39, total: 58 }, // B  (6.0 GP)
      { code: 'CS505', internal: 23, external: 47, total: 70 }, // A  (8.0 GP)
    ],
  },
  {
    email: 'smit.shinde@ustu.edu.in',
    fullName: 'Smit Shinde',
    rollNumber: 'UST24R0102089',
    targetAttendedCount: 125, // ~88%
    results: [
      { code: 'CS501', internal: 27, external: 61, total: 88 }, // A+ (9.0 GP)
      { code: 'CS502', internal: 26, external: 58, total: 84 }, // A+ (9.0 GP)
      { code: 'CS503', internal: 27, external: 59, total: 86 }, // A+ (9.0 GP)
      { code: 'CS504', internal: 26, external: 56, total: 82 }, // A+ (9.0 GP)
      { code: 'CS505', internal: 28, external: 62, total: 90 }, // O  (10.0 GP)
    ],
  },
];

async function seedDemo() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log(`[Seed-Demo] Starting demo data seed ${isDryRun ? '(DRY RUN MODE — no changes will be made)' : ''}...`);

  try {
    // 1. Locate academic class (B.Tech CSE Div B Sem 5)
    const classRes = await pool.query(`
      SELECT ac.id, ac.branch_id, ac.batch_id, ac.division_id, br.name AS branch_name
      FROM academic_classes ac
      JOIN branches br ON br.id = ac.branch_id
      JOIN divisions d ON d.id = ac.division_id
      JOIN semesters s ON s.id = ac.semester_id
      WHERE br.code = 'BTECH-CSE' AND d.name = 'B' AND s.number = 5
      LIMIT 1
    `);

    if (classRes.rows.length === 0) {
      throw new Error('Target academic class (BTECH-CSE Div B Sem 5) not found');
    }
    const targetClass = classRes.rows[0];
    console.log(`[Seed-Demo] Found target class: ${targetClass.id} (${targetClass.branch_name})`);

    // 2. Locate lab group
    const labRes = await pool.query(
      `SELECT id, name FROM academic_lab_groups
       WHERE branch_id = $1 AND batch_id = $2 AND division_id = $3
       LIMIT 1`,
      [targetClass.branch_id, targetClass.batch_id, targetClass.division_id]
    );
    const targetLabGroup = labRes.rows[0] || null;

    // 3. Locate faculty user for offerings
    const facultyRes = await pool.query(`SELECT id FROM users WHERE role = 'faculty' LIMIT 1`);
    const adminRes = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const defaultFacultyId = facultyRes.rows[0]?.id || adminRes.rows[0]?.id;
    if (!defaultFacultyId) throw new Error('No admin or faculty user found in database');

    // 4. Ensure Core Subjects and Offerings exist
    console.log('\n[Seed-Demo] Ensuring Core Subjects and Offerings exist...');
    const subjectMap = {};
    const offeringMap = {};

    for (const subj of CORE_SUBJECTS) {
      if (!isDryRun) {
        const sRes = await pool.query(
          `INSERT INTO subjects (code, name, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, code, name`,
          [subj.code, subj.name, `${subj.name} course module`]
        );
        const subjectRecord = sRes.rows[0];
        subjectMap[subj.code] = subjectRecord;

        const offRes = await pool.query(
          `INSERT INTO subject_offerings (subject_id, academic_class_id, faculty_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (subject_id, academic_class_id) DO UPDATE SET faculty_id = EXCLUDED.faculty_id
           RETURNING id`,
          [subjectRecord.id, targetClass.id, defaultFacultyId]
        );
        offeringMap[subj.code] = offRes.rows[0].id;
      }
    }
    console.log(`[Seed-Demo] Configured ${CORE_SUBJECTS.length} subjects and offerings.`);

    // 5. Default password hash for demo accounts
    const passwordHash = await bcrypt.hash('DemoStudent@2025', 10);

    // 6. Seed Students and Academic Results
    const studentIds = {};
    for (const student of DEMO_STUDENTS) {
      console.log(`\n--- Processing Demo Student: ${student.fullName} (${student.email}) ---`);

      let studentId;
      const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [student.email]);

      if (userRes.rows.length > 0) {
        studentId = userRes.rows[0].id;
        console.log(`  Existing student found with ID: ${studentId}`);
        if (!isDryRun) {
          await pool.query(
            `UPDATE users
             SET academic_class_id = $1, is_active = true, email_verified = true, updated_at = now()
             WHERE id = $2`,
            [targetClass.id, studentId]
          );
        }
      } else {
        if (isDryRun) {
          console.log(`  [DRY RUN] Would create user: ${student.email}`);
          studentId = 'dry-run-student-id';
        } else {
          const insertUser = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified, academic_class_id)
             VALUES ($1, $2, $3, 'student', true, true, $4)
             RETURNING id`,
            [student.email, passwordHash, student.fullName, targetClass.id]
          );
          studentId = insertUser.rows[0].id;
          console.log(`  Created user: ${student.email} (ID: ${studentId})`);
        }
      }
      studentIds[student.email] = studentId;

      // Upsert user profile
      if (!isDryRun) {
        await pool.query(
          `INSERT INTO user_profiles
           (user_id, roll_number, college_id, program, year_of_study, admission_year, expected_graduation_year,
            academic_lab_group_id, registration_completed_at, updated_at)
           VALUES ($1, $2, $2, 'B.Tech Computer Science and Engineering', 3, 2024, 2028, $3, now(), now())
           ON CONFLICT (user_id) DO UPDATE SET
             roll_number = EXCLUDED.roll_number,
             college_id = EXCLUDED.college_id,
             academic_lab_group_id = EXCLUDED.academic_lab_group_id,
             updated_at = now()`,
          [studentId, student.rollNumber, targetLabGroup ? targetLabGroup.id : null]
        );
      }

      // Upsert academic results for each subject
      for (const res of student.results) {
        const subjRecord = subjectMap[res.code];
        if (!subjRecord && !isDryRun) continue;

        if (isDryRun) {
          console.log(`  [DRY RUN] Would record result: ${res.code} -> ${res.total}/100`);
        } else {
          await pool.query(
            `INSERT INTO academic_results
             (student_id, subject_id, academic_class_id, internal_marks, external_marks, total_marks,
              credits, status, exam_type, academic_year, is_synthetic, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 4.0, 'published', 'regular', 2024, true, now())
             ON CONFLICT (student_id, subject_id, academic_class_id, exam_type)
             DO UPDATE SET
               internal_marks = EXCLUDED.internal_marks,
               external_marks = EXCLUDED.external_marks,
               total_marks = EXCLUDED.total_marks,
               is_synthetic = true,
               status = 'published',
               updated_at = now()`,
            [studentId, subjRecord.id, targetClass.id, res.internal, res.external, res.total]
          );
          console.log(`  Result recorded: ${res.code} (${subjRecord.name}) -> ${res.total}/100 (is_synthetic = true)`);
        }
      }
    }

    // 7. Seed Attendance Sessions & Records (Total sessions = 142)
    // Distribution:
    // CS501 (Computer Networks): 32 sessions (Smit Haria: 25 attended -> 78.13%)
    // CS502 (DBMS): 30 sessions (Smit Haria: 26 attended -> 86.67%)
    // CS503 (Operating Systems): 28 sessions (Smit Haria: 22 attended -> 78.57%)
    // CS504 (Theory of Computation): 24 sessions (Smit Haria: 19 attended -> 79.17%)
    // CS505 (Algorithms): 16 sessions (Smit Haria: 13 attended -> 81.25%)
    // CS501L (CN Lab): 12 sessions (Smit Haria: 9 attended -> 75.00%)
    // Sum: 32 + 30 + 28 + 24 + 16 + 12 = 142 sessions!
    // Smit attended: 25 + 26 + 22 + 19 + 13 + 9 = 114 sessions (114/142 = 80.28% exact!)
    if (!isDryRun) {
      console.log('\n[Seed-Demo] Seeding realistic semester attendance sessions (Total: 142 sessions)...');
      const SESSION_DISTRIBUTION = [
        { code: 'CS501', total: 32, smitAttended: 25 },
        { code: 'CS502', total: 30, smitAttended: 26 },
        { code: 'CS503', total: 28, smitAttended: 22 },
        { code: 'CS504', total: 24, smitAttended: 19 },
        { code: 'CS505', total: 16, smitAttended: 13 },
        { code: 'CS501L', total: 12, smitAttended: 9 },
      ];

      // Check existing synthetic sessions
      const existingSessions = await pool.query(
        `SELECT COUNT(*) FROM attendance_sessions
         WHERE subject_offering_id IN (SELECT id FROM subject_offerings WHERE academic_class_id = $1)`,
        [targetClass.id]
      );

      const existingCount = parseInt(existingSessions.rows[0].count, 10);
      if (existingCount < 142) {
        let globalDayOffset = 70; // start 70 days ago
        for (const dist of SESSION_DISTRIBUTION) {
          const offId = offeringMap[dist.code];
          const subjRecord = subjectMap[dist.code];
          if (!offId || !subjRecord) continue;

          for (let i = 0; i < dist.total; i++) {
            const sessionDate = new Date(Date.now() - (globalDayOffset * 24 * 60 * 60 * 1000) + (i * 12 * 60 * 60 * 1000));
            const endedDate = new Date(sessionDate.getTime() + 50 * 60 * 1000); // 50 min lecture
            const nonce = Math.random().toString(36).substring(2, 8).toUpperCase();

            const sessRes = await pool.query(
              `INSERT INTO attendance_sessions
               (subject_id, faculty_id, subject_offering_id, active_nonce, nonce_expires,
                is_active, started_at, ended_at, latitude, longitude, radius_meters)
               VALUES ($1, $2, $3, $4, $5, false, $5, $6, 19.0760, 72.8777, 50)
               RETURNING id`,
              [subjRecord.id, defaultFacultyId, offId, nonce, sessionDate, endedDate]
            );
            const sessionId = sessRes.rows[0].id;

            // Attendance records for demo students
            // 1. Smit Haria
            const smitPresent = i < dist.smitAttended;
            await pool.query(
              `INSERT INTO attendance_records
               (session_id, student_id, latitude, longitude, distance_meters, status, verification_method, marked_at)
               VALUES ($1, $2, 19.0760, 72.8777, 12, $3, 'geolocation', $4)
               ON CONFLICT (session_id, student_id) DO NOTHING`,
              [sessionId, studentIds['smit.haria@ustu.edu.in'], smitPresent ? 'present' : 'absent', sessionDate]
            );

            // 2. Viraj Mengeri (~95% present)
            const virajPresent = i % 20 !== 0;
            await pool.query(
              `INSERT INTO attendance_records
               (session_id, student_id, latitude, longitude, distance_meters, status, verification_method, marked_at)
               VALUES ($1, $2, 19.0760, 72.8777, 8, $3, 'geolocation', $4)
               ON CONFLICT (session_id, student_id) DO NOTHING`,
              [sessionId, studentIds['viraj.mengeri@ustu.edu.in'], virajPresent ? 'present' : 'absent', sessionDate]
            );

            // 3. Sanaf Khan (~70% present)
            const sanafPresent = i % 3 !== 0;
            await pool.query(
              `INSERT INTO attendance_records
               (session_id, student_id, latitude, longitude, distance_meters, status, verification_method, marked_at)
               VALUES ($1, $2, 19.0760, 72.8777, 15, $3, 'geolocation', $4)
               ON CONFLICT (session_id, student_id) DO NOTHING`,
              [sessionId, studentIds['sanaf.khan@ustu.edu.in'], sanafPresent ? 'present' : 'absent', sessionDate]
            );

            // 4. Smit Shinde (~88% present)
            const shindePresent = i % 8 !== 0;
            await pool.query(
              `INSERT INTO attendance_records
               (session_id, student_id, latitude, longitude, distance_meters, status, verification_method, marked_at)
               VALUES ($1, $2, 19.0760, 72.8777, 10, $3, 'geolocation', $4)
               ON CONFLICT (session_id, student_id) DO NOTHING`,
              [sessionId, studentIds['smit.shinde@ustu.edu.in'], shindePresent ? 'present' : 'absent', sessionDate]
            );
          }
        }
        console.log('[Seed-Demo] 142 attendance sessions seeded with verified records.');
      } else {
        console.log(`[Seed-Demo] Target class already has ${existingCount} sessions. Preserving existing records.`);
      }
    }

    console.log(`\n[Seed-Demo] ✅ ${isDryRun ? 'Dry run preview' : 'Seeding'} completed successfully.`);
  } catch (err) {
    console.error('[Seed-Demo] ❌ Error seeding demo data:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seedDemo();
}

module.exports = { seedDemo, DEMO_STUDENTS, CORE_SUBJECTS };
