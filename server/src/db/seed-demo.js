/**
 * Seed utility for demo student accounts and academic data.
 * Usage:
 *   node server/src/db/seed-demo.js           # Seeds demo data
 *   node server/src/db/seed-demo.js --dry-run # Previews without making DB changes
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@db:') && !process.env.DOCKER_CONTAINER) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@db:', '@localhost:');
}
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

const DEMO_STUDENTS = [
  {
    email: 'smit.haria@ustu.edu.in',
    fullName: 'Smit Haria',
    rollNumber: 'UST24R0102086',
    marks: { internal: 26, external: 58, total: 84 }, // Grade: A+
    attendanceRate: 0.92,
  },
  {
    email: 'viraj.mengeri@ustu.edu.in',
    fullName: 'Viraj Mengeri',
    rollNumber: 'UST24R0102087',
    marks: { internal: 28, external: 64, total: 92 }, // Grade: O
    attendanceRate: 0.95,
  },
  {
    email: 'sanaf.khan@ustu.edu.in',
    fullName: 'Sanaf Khan',
    rollNumber: 'UST24R0102088',
    marks: { internal: 21, external: 44, total: 65 }, // Grade: B+
    attendanceRate: 0.70, // At-risk student for demo analytics
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
    const labRes = await pool.query(`
      SELECT id, name FROM academic_lab_groups
      WHERE branch_id = $1 AND batch_id = $2 AND division_id = $3
      LIMIT 1
    `, [targetClass.branch_id, targetClass.batch_id, targetClass.division_id]);
    const targetLabGroup = labRes.rows[0] || null;

    // 3. Locate subjects
    const subjectsRes = await pool.query(`SELECT id, name, code FROM subjects ORDER BY code`);
    if (subjectsRes.rows.length === 0) {
      throw new Error('No subjects found in database');
    }
    const cnSubject = subjectsRes.rows.find((s) => s.code.includes('CS3') || s.name.includes('Networks')) || subjectsRes.rows[0];
    console.log(`[Seed-Demo] Found subject for grading: ${cnSubject.name} (${cnSubject.code})`);

    // 4. Default password hash for demo accounts
    const passwordHash = await bcrypt.hash('DemoStudent@2025', 10);

    for (const student of DEMO_STUDENTS) {
      console.log(`\n--- Processing Demo Student: ${student.fullName} (${student.email}) ---`);

      // Check if user already exists
      const userRes = await pool.query('SELECT id, email, academic_class_id FROM users WHERE email = $1', [student.email]);
      let studentId;

      if (userRes.rows.length > 0) {
        studentId = userRes.rows[0].id;
        console.log(`  Existing student found with ID: ${studentId}`);
        if (!isDryRun) {
          await pool.query(
            'UPDATE users SET academic_class_id = $1, is_active = true, email_verified = true, updated_at = now() WHERE id = $2',
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

      // Upsert user profile
      if (isDryRun) {
        console.log(`  [DRY RUN] Would set profile roll number: ${student.rollNumber}`);
      } else {
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
        console.log(`  Profile upserted for roll number: ${student.rollNumber}`);
      }

      // Seed academic result with is_synthetic = true
      if (isDryRun) {
        console.log(`  [DRY RUN] Would insert academic result for subject ${cnSubject.name}: total=${student.marks.total}, is_synthetic=true`);
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
          [studentId, cnSubject.id, targetClass.id, student.marks.internal, student.marks.external, student.marks.total]
        );
        console.log(`  Academic result recorded: ${student.marks.total}/100 (is_synthetic = true)`);
      }
    }

    // Also seed a demo result for Smit Shinde if he doesn't have one
    const smitRes = await pool.query("SELECT id FROM users WHERE email = 'smit.shinde@ustu.edu.in'");
    if (smitRes.rows.length > 0) {
      const smitId = smitRes.rows[0].id;
      if (isDryRun) {
        console.log(`\n  [DRY RUN] Would ensure demo result for Smit Shinde: total=88, is_synthetic=true`);
      } else {
        await pool.query(
          `INSERT INTO academic_results
           (student_id, subject_id, academic_class_id, internal_marks, external_marks, total_marks,
            credits, status, exam_type, academic_year, is_synthetic, updated_at)
           VALUES ($1, $2, $3, 27, 61, 88, 4.0, 'published', 'regular', 2024, true, now())
           ON CONFLICT (student_id, subject_id, academic_class_id, exam_type)
           DO UPDATE SET
             internal_marks = EXCLUDED.internal_marks,
             external_marks = EXCLUDED.external_marks,
             total_marks = EXCLUDED.total_marks,
             is_synthetic = true,
             status = 'published',
             updated_at = now()`,
          [smitId, cnSubject.id, targetClass.id]
        );
        console.log(`\n  Demo result ensured for Smit Shinde: 88/100 (Grade: A+, is_synthetic = true)`);
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

module.exports = { seedDemo, DEMO_STUDENTS };
