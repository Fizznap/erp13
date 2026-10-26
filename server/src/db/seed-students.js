const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { pool } = require('./pool');
require('dotenv').config();

const DEFAULT_ROSTER_URL = 'https://docs.google.com/spreadsheets/d/1rPyoy2ORmsyf703dsrrZ7ftirjlPonNwW_I1wZb_0yM/export?format=csv';
const ROSTER_URL = process.env.STUDENT_ROSTER_URL || DEFAULT_ROSTER_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const SEMESTER_NUMBER = Number(process.env.CURRENT_SEMESTER_NUMBER);

function configuredSubjects() {
  if (!process.env.ACADEMIC_SUBJECTS_JSON?.trim()) return [];
  let values;
  try {
    values = JSON.parse(process.env.ACADEMIC_SUBJECTS_JSON);
  } catch {
    throw new Error('ACADEMIC_SUBJECTS_JSON must be valid JSON');
  }
  if (!Array.isArray(values)) throw new Error('ACADEMIC_SUBJECTS_JSON must be an array');
  return values.map((subject) => {
    if (!subject || !subject.code || !subject.name) {
      throw new Error('Each configured subject needs code and name');
    }
    return [String(subject.code).trim(), String(subject.name).trim(), subject.description ? String(subject.description).trim() : null];
  });
}

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
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
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
  if (!ADMIN_EMAIL) throw new Error('ADMIN_EMAIL must be configured before importing the roster');
  if (!Number.isInteger(SEMESTER_NUMBER) || SEMESTER_NUMBER < 1) {
    console.warn('CURRENT_SEMESTER_NUMBER is not configured; skipping roster import.');
    return;
  }
  const subjectsToImport = configuredSubjects();
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
      admissionYear: Number(row['Batch Year']),
      graduationYear: Number(row['Expected Graduation Year']),
    };
  }).filter((record) => record.registrationId && record.name && record.email && record.branchCode && record.division &&
    Number.isInteger(record.admissionYear) && Number.isInteger(record.graduationYear));

  const batchStartYear = records[0]?.admissionYear;
  const batchEndYear = records[0]?.graduationYear;
  if (!batchStartYear || !batchEndYear || records.some((record) => record.admissionYear !== batchStartYear || record.graduationYear !== batchEndYear)) {
    throw new Error('The roster must contain one consistent admission and graduation year');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const admin = await client.query(
      'SELECT id FROM users WHERE lower(email) = $1 AND role = \'admin\' AND is_active = true',
      [ADMIN_EMAIL],
    );
    if (!admin.rows.length) throw new Error(`Configured admin account ${ADMIN_EMAIL} was not found`);
    const adminId = admin.rows[0].id;

    const batch = await client.query(
      `INSERT INTO batches (start_year, end_year) VALUES ($1, $2)
       ON CONFLICT (start_year, end_year) DO UPDATE SET end_year = EXCLUDED.end_year
       RETURNING id`,
      [batchStartYear, batchEndYear],
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
    for (const [code, name, description] of subjectsToImport) {
      const result = await client.query(
        `INSERT INTO subjects (name, code, description, faculty_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
           faculty_id = COALESCE(subjects.faculty_id, EXCLUDED.faculty_id)
         RETURNING id`,
        [name, code, description, adminId],
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
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (user_id) DO UPDATE SET college_id = EXCLUDED.college_id,
           program = EXCLUDED.program, roll_number = EXCLUDED.roll_number,
           year_of_study = EXCLUDED.year_of_study, admission_year = EXCLUDED.admission_year,
           expected_graduation_year = EXCLUDED.expected_graduation_year,
           academic_lab_group_id = EXCLUDED.academic_lab_group_id,
           registration_completed_at = COALESCE(user_profiles.registration_completed_at, EXCLUDED.registration_completed_at),
           updated_at = now()`,
        [userId, record.registrationId, record.programme, record.registrationId, Math.ceil(SEMESTER_NUMBER / 2), record.admissionYear, record.graduationYear, labGroupId],
      );
    }

    for (const academicClassId of classIds) {
      for (const subjectId of Object.values(subjects)) {
        await client.query(
          `INSERT INTO subject_offerings (subject_id, academic_class_id, faculty_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (subject_id, academic_class_id) DO UPDATE SET faculty_id = EXCLUDED.faculty_id`,
          [subjectId, academicClassId, adminId],
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Imported ${records.length} students, ${classIds.size} classes, and ${Object.keys(subjects).length} configured subjects from ${ROSTER_URL}`);
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
