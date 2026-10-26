const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { pool } = require('./pool');
require('dotenv').config();

const DEFAULT_ROSTER_URL = 'https://docs.google.com/spreadsheets/d/1rPyoy2ORmsyf703dsrrZ7ftirjlPonNwW_I1wZb_0yM/export?format=csv';
const ROSTER_URL = process.env.STUDENT_ROSTER_URL || DEFAULT_ROSTER_URL;
const SEMESTER_NUMBER = Number(process.env.CURRENT_SEMESTER_NUMBER || 5);
const FACULTY_EMAIL = (process.env.ROSTER_FACULTY_EMAIL || 'faculty@ustu.edu.in').trim().toLowerCase();

const SUBJECTS = [
  ['CS301', 'Database Management Systems', 'Relational databases, modelling, SQL, normalization and transactions.'],
  ['CS302', 'Operating Systems', 'Processes, memory, scheduling, filesystems and operating-system design.'],
  ['CS303', 'Computer Networks', 'Networking models, protocols, routing, transport and application services.'],
  ['CS304', 'Software Engineering', 'Requirements, design, testing, delivery and software project practices.'],
  ['CS301L', 'DBMS Lab', 'Practical database exercises and lab attendance.'],
];

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }

  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function branchCode(programme) {
  const value = programme.toLowerCase();
  if (value.includes('artificial intelligence')) return 'BTECH-AIML';
  if (value.includes('computer engineering')) return 'BTECH-CSE';
  if (value.includes('cyber')) return 'BTECH-CYS';
  return null;
}

function sectionDetails(value) {
  const match = /^\s*div\s+([a-z])(?:\s+batch\s+(i|ii))?\s*$/i.exec(value || '');
  if (match) return { division: match[1].toUpperCase(), labBatch: match[2]?.toUpperCase() || null };
  if (/^[a-z]$/i.test((value || '').trim())) return { division: value.trim().toUpperCase(), labBatch: null };
  return null;
}

async function fetchRoster() {
  const response = await fetch(ROSTER_URL);
  if (!response.ok) throw new Error(`Roster download failed with HTTP ${response.status}`);
  return parseCsv(await response.text());
}

async function ensureUser(client, { email, fullName, role }) {
  const passwordHash = await bcrypt.hash(
    process.env.ROSTER_DEFAULT_PASSWORD || crypto.randomBytes(32).toString('hex'),
    12,
  );
  const result = await client.query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
     VALUES ($1, $2, $3, $4, true, true)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name,
       role = EXCLUDED.role, is_active = true, email_verified = true, updated_at = now()
     RETURNING id`,
    [email, passwordHash, fullName, role],
  );
  return result.rows[0].id;
}

async function importStudents() {
  const sourceRows = await fetchRoster();
  const records = sourceRows.map((row) => {
    const details = sectionDetails(row['Programme Section']);
    return {
      registrationId: row['Registration Id'],
      name: row.Name,
      email: row.Email.toLowerCase(),
      programme: row.Programme,
      branchCode: branchCode(row.Programme),
      division: details?.division,
      labBatch: details?.labBatch,
      admissionYear: Number(row['Batch Year']) || 2024,
      graduationYear: Number(row['Expected Graduation Year']) || 2028,
    };
  }).filter((record) => record.registrationId && record.name && record.email && record.branchCode && record.division);

  // The supplied CYS rows contain only "A" and no lab batch. Keep their split
  // deterministic until the department publishes the actual lab roster.
  const cysRows = records.filter((record) => record.branchCode === 'BTECH-CYS' && !record.labBatch)
    .sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  cysRows.forEach((record, index) => { record.labBatch = index % 2 === 0 ? 'I' : 'II'; });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const facultyId = await ensureUser(client, {
      email: FACULTY_EMAIL,
      fullName: process.env.ROSTER_FACULTY_NAME || 'Course Faculty',
      role: 'faculty',
    });

    const batch = await client.query(
      `INSERT INTO batches (start_year, end_year) VALUES (2024, 2028)
       ON CONFLICT (start_year, end_year) DO UPDATE SET end_year = EXCLUDED.end_year
       RETURNING id`,
    );
    const batchId = batch.rows[0].id;

    await client.query(
      `INSERT INTO semesters (number) VALUES ($1)
       ON CONFLICT (number) DO NOTHING`,
      [SEMESTER_NUMBER],
    );
    const semester = await client.query('SELECT id FROM semesters WHERE number = $1', [SEMESTER_NUMBER]);
    const semesterId = semester.rows[0].id;

    const subjects = {};
    for (const [code, name, description] of SUBJECTS) {
      const result = await client.query(
        `INSERT INTO subjects (name, code, description, faculty_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
           faculty_id = COALESCE(subjects.faculty_id, EXCLUDED.faculty_id)
         RETURNING id`,
        [name, code, description, facultyId],
      );
      subjects[code] = result.rows[0].id;
    }

    const classIds = new Set();
    const labGroups = new Map();
    for (const record of records) {
      const branch = await client.query('SELECT id FROM branches WHERE code = $1', [record.branchCode]);
      const division = await client.query('SELECT id FROM divisions WHERE name = $1', [record.division]);
      if (!branch.rows[0] || !division.rows[0]) continue;

      const academicClass = await client.query(
        `INSERT INTO academic_classes (branch_id, batch_id, division_id, semester_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (branch_id, batch_id, division_id, semester_id) DO UPDATE SET semester_id = EXCLUDED.semester_id
         RETURNING id`,
        [branch.rows[0].id, batchId, division.rows[0].id, semesterId],
      );
      const academicClassId = academicClass.rows[0].id;
      classIds.add(academicClassId);

      const labKey = `${record.branchCode}:${record.division}:${record.labBatch}`;
      let labGroupId = null;
      if (record.labBatch) {
        if (!labGroups.has(labKey)) {
          const labGroup = await client.query(
            `INSERT INTO academic_lab_groups (branch_id, batch_id, division_id, name)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (branch_id, batch_id, division_id, name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [branch.rows[0].id, batchId, division.rows[0].id, `Batch ${record.labBatch}`],
          );
          labGroups.set(labKey, labGroup.rows[0].id);
        }
        labGroupId = labGroups.get(labKey);
      }

      const userId = await ensureUser(client, { email: record.email, fullName: record.name, role: 'student' });
      await client.query('UPDATE users SET academic_class_id = $1, updated_at = now() WHERE id = $2', [academicClassId, userId]);
      await client.query(
        `INSERT INTO user_profiles (user_id, college_id, program, roll_number, year_of_study,
                                    admission_year, expected_graduation_year, academic_lab_group_id,
                                    registration_completed_at)
         VALUES ($1, $2, $3, $4, 3, $5, $6, $7, now())
         ON CONFLICT (user_id) DO UPDATE SET college_id = EXCLUDED.college_id,
           program = EXCLUDED.program, roll_number = EXCLUDED.roll_number,
           year_of_study = EXCLUDED.year_of_study, admission_year = EXCLUDED.admission_year,
           expected_graduation_year = EXCLUDED.expected_graduation_year,
           academic_lab_group_id = EXCLUDED.academic_lab_group_id,
           registration_completed_at = COALESCE(user_profiles.registration_completed_at, EXCLUDED.registration_completed_at),
           updated_at = now()`,
        [userId, record.registrationId, record.programme, record.registrationId, record.admissionYear, record.graduationYear, labGroupId],
      );
    }

    for (const academicClassId of classIds) {
      for (const subjectId of Object.values(subjects)) {
        await client.query(
          `INSERT INTO subject_offerings (subject_id, academic_class_id, faculty_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (subject_id, academic_class_id) DO UPDATE SET faculty_id = EXCLUDED.faculty_id`,
          [subjectId, academicClassId, facultyId],
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Imported ${records.length} students, ${classIds.size} classes, and ${Object.keys(subjects).length} subjects from ${ROSTER_URL}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

importStudents()
  .catch((error) => {
    console.error('Student roster import failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
