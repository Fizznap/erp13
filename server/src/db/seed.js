const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
require('dotenv').config();

async function seed() {
  try {
    console.log('Seeding database...');

    // Create admin user
    const adminHash = await bcrypt.hash('admin123', 12);
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      ['admin@snippet.edu', adminHash, 'System Admin', 'admin']
    );

    // Create faculty user
    const facultyHash = await bcrypt.hash('faculty123', 12);
    const facultyResult = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      ['faculty@snippet.edu', facultyHash, 'Dr. Smith', 'faculty']
    );
    const facultyId = facultyResult.rows[0].id;

    // Create student user
    const studentHash = await bcrypt.hash('student123', 12);
    const studentResult = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      ['student@snippet.edu', studentHash, 'Alice Johnson', 'student']
    );
    const studentId = studentResult.rows[0].id;

    // Create subjects
    const subjectResult = await pool.query(
      `INSERT INTO subjects (name, code, description, faculty_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      ['Introduction to Computer Science', 'CS101', 'Fundamentals of programming and computational thinking', facultyId]
    );
    const subjectId = subjectResult.rows[0].id;

    await pool.query(
      `INSERT INTO subjects (name, code, description, faculty_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING`,
      ['Data Structures & Algorithms', 'CS201', 'Arrays, trees, graphs, sorting, and searching algorithms', facultyId]
    );

    // Enroll student
    await pool.query(
      `INSERT INTO subject_enrollments (student_id, subject_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [studentId, subjectId]
    );

    console.log('Seed data created successfully.');
    console.log('');
    console.log('Test accounts:');
    console.log('  Admin:   admin@snippet.edu   / admin123');
    console.log('  Faculty: faculty@snippet.edu  / faculty123');
    console.log('  Student: student@snippet.edu  / student123');

    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
