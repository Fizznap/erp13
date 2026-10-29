/**
 * Automatic Class Assignment Service
 * 
 * Assigns students to academic classes based on authoritative metadata:
 * - Roll number pattern (for UST students)
 * - Branch, batch, division, semester
 * - Existing academic class mappings
 * 
 * Only assigns when the match is unambiguous.
 * Preserves existing valid assignments.
 * Reports unresolved cases for manual admin review.
 */

const { pool } = require('../db/pool');
const { parseStudentRollNumber, canonicalBranchCode } = require('../utils/studentRollNumber');

/**
 * Demo student configurations
 * Maps known demo students to their intended academic assignments
 */
const DEMO_STUDENT_MAPPINGS = {
  'smit.haria': {
    branch: 'BTECH-CSE',
    batch: { start: 2024, end: 2028 },
    division: 'A',
    semester: 3,
  },
  'viraj.mengeri': {
    branch: 'BTECH-CSE',
    batch: { start: 2024, end: 2028 },
    division: 'B',
    semester: 3,
  },
  'sanaf.khan': {
    branch: 'BTECH-AIML',
    batch: { start: 2024, end: 2028 },
    division: 'A',
    semester: 3,
  },
  'smit.shinde': {
    branch: 'BTECH-CYS',
    batch: { start: 2024, end: 2028 },
    division: 'B',
    semester: 3,
  },
};

/**
 * Determine academic class assignment metadata from available student information
 * 
 * @param {Object} student - Student record with user and profile data
 * @returns {Object|null} Assignment metadata or null if insufficient information
 */
function determineAssignmentMetadata(student) {
  // Try roll number parsing first
  if (student.rollNumber) {
    const parsed = parseStudentRollNumber(student.rollNumber);
    if (parsed) {
      return {
        branchCode: parsed.branch.code,
        startYear: parsed.admissionYear,
        endYear: parsed.admissionYear + 4, // Assuming 4-year program
        source: 'roll_number',
      };
    }
  }

  // Check demo student mappings
  const emailUsername = student.email?.split('@')[0]?.toLowerCase();
  const demoConfig = DEMO_STUDENT_MAPPINGS[emailUsername];
  
  if (demoConfig) {
    return {
      branchCode: demoConfig.branch,
      startYear: demoConfig.batch.start,
      endYear: demoConfig.batch.end,
      divisionName: demoConfig.division,
      semesterNumber: demoConfig.semester,
      source: 'demo_mapping',
    };
  }

  // Check explicit profile metadata (if admin has set it)
  if (student.branchId && student.batchId && student.divisionId && student.semesterId) {
    return {
      branchId: student.branchId,
      batchId: student.batchId,
      divisionId: student.divisionId,
      semesterId: student.semesterId,
      source: 'explicit_ids',
    };
  }

  return null;
}

/**
 * Find matching academic class for given metadata
 * 
 * @param {Object} metadata - Assignment metadata
 * @returns {Promise<Object|null>} Matching class or null
 */
async function findMatchingClass(metadata) {
  try {
    // If we have explicit IDs, use them directly
    if (metadata.source === 'explicit_ids') {
      const result = await pool.query(
        `SELECT id FROM academic_classes 
         WHERE branch_id = $1 AND batch_id = $2 
           AND division_id = $3 AND semester_id = $4`,
        [metadata.branchId, metadata.batchId, metadata.divisionId, metadata.semesterId]
      );
      return result.rows[0] || null;
    }

    // Otherwise, resolve by names/codes
    let query = `
      SELECT ac.id, ac.branch_id, ac.batch_id, ac.division_id, ac.semester_id,
             br.name AS branch_name, br.code AS branch_code,
             d.name AS division_name, s.number AS semester_number
      FROM academic_classes ac
      JOIN branches br ON br.id = ac.branch_id
      JOIN batches ba ON ba.id = ac.batch_id
      JOIN divisions d ON d.id = ac.division_id
      JOIN semesters s ON s.id = ac.semester_id
      WHERE br.code = $1 
        AND ba.start_year = $2 
        AND ba.end_year = $3
    `;

    const params = [metadata.branchCode, metadata.startYear, metadata.endYear];
    let paramCount = 3;

    if (metadata.divisionName) {
      query += ` AND d.name = $${++paramCount}`;
      params.push(metadata.divisionName);
    }

    if (metadata.semesterNumber) {
      query += ` AND s.number = $${++paramCount}`;
      params.push(metadata.semesterNumber);
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 1) {
      return result.rows[0];
    } else if (result.rows.length > 1) {
      // Ambiguous - multiple classes match
      console.warn(`Ambiguous class assignment: ${result.rows.length} matches for`, metadata);
      return null;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error finding matching class:', error);
    return null;
  }
}

/**
 * Find appropriate lab group for student
 * 
 * @param {string} branchId
 * @param {string} batchId
 * @param {string} divisionId
 * @returns {Promise<string|null>} Lab group ID or null
 */
async function findDefaultLabGroup(branchId, batchId, divisionId) {
  try {
    const result = await pool.query(
      `SELECT id FROM academic_lab_groups
       WHERE branch_id = $1 AND batch_id = $2 AND division_id = $3
       ORDER BY name LIMIT 1`,
      [branchId, batchId, divisionId]
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    console.error('Error finding default lab group:', error);
    return null;
  }
}

/**
 * Assign a student to their academic class automatically
 * 
 * @param {string} userId - Student user ID
 * @param {Object} options - Assignment options
 * @returns {Promise<Object>} Assignment result
 */
async function assignStudentToClass(userId, options = {}) {
  const { force = false, dryRun = false } = options;

  try {
    // Fetch student information
    const studentQuery = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.academic_class_id, u.role,
              p.roll_number, p.college_id, p.preferred_name
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    if (studentQuery.rows.length === 0) {
      return { success: false, reason: 'user_not_found' };
    }

    const student = studentQuery.rows[0];

    if (student.role !== 'student') {
      return { success: false, reason: 'not_a_student', role: student.role };
    }

    // Check if already assigned
    if (student.academic_class_id && !force) {
      return {
        success: false,
        reason: 'already_assigned',
        existingClassId: student.academic_class_id,
      };
    }

    // Determine assignment metadata
    const metadata = determineAssignmentMetadata({
      email: student.email,
      rollNumber: student.roll_number,
      collegeId: student.college_id,
    });

    if (!metadata) {
      return {
        success: false,
        reason: 'insufficient_metadata',
        message: 'Cannot determine branch, batch, or division from available data',
      };
    }

    // Find matching class
    const matchingClass = await findMatchingClass(metadata);

    if (!matchingClass) {
      return {
        success: false,
        reason: metadata.source === 'explicit_ids' ? 'class_not_found' : 'no_matching_class',
        metadata,
        message: 'No academic class matches the student metadata',
      };
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        classId: matchingClass.id,
        className: `${matchingClass.branch_code} ${metadata.startYear}-${metadata.endYear} Div ${matchingClass.division_name} Sem ${matchingClass.semester_number}`,
        metadata,
      };
    }

    // Find default lab group
    const labGroupId = await findDefaultLabGroup(
      matchingClass.branch_id,
      matchingClass.batch_id,
      matchingClass.division_id
    );

    // Perform assignment
    await pool.query(
      'UPDATE users SET academic_class_id = $1, updated_at = now() WHERE id = $2',
      [matchingClass.id, userId]
    );

    if (labGroupId) {
      await pool.query(
        `INSERT INTO user_profiles (user_id, academic_lab_group_id, updated_at) 
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) 
         DO UPDATE SET academic_lab_group_id = EXCLUDED.academic_lab_group_id, 
                       updated_at = now()`,
        [userId, labGroupId]
      );
    }

    return {
      success: true,
      classId: matchingClass.id,
      labGroupId,
      metadata,
      message: `Assigned to ${matchingClass.branch_code} ${metadata.startYear}-${metadata.endYear}`,
    };
  } catch (error) {
    console.error('Error assigning student to class:', error);
    return {
      success: false,
      reason: 'database_error',
      error: error.message,
    };
  }
}

/**
 * Batch assign multiple students to classes
 * 
 * @param {string[]} userIds - Array of student user IDs
 * @param {Object} options - Assignment options
 * @returns {Promise<Object>} Batch assignment results
 */
async function batchAssignStudents(userIds, options = {}) {
  const results = {
    total: userIds.length,
    assigned: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const userId of userIds) {
    const result = await assignStudentToClass(userId, options);
    
    if (result.success) {
      results.assigned++;
    } else if (result.reason === 'already_assigned') {
      results.skipped++;
    } else {
      results.failed++;
    }

    results.details.push({
      userId,
      ...result,
    });
  }

  return results;
}

/**
 * Get unassigned students who are eligible for automatic assignment
 * 
 * @returns {Promise<Array>} List of unassigned students with available metadata
 */
async function getUnassignedStudents() {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, 
              p.roll_number, p.college_id
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.role = 'student' 
         AND u.is_active = true
         AND u.email_verified = true
         AND u.academic_class_id IS NULL
       ORDER BY u.created_at DESC`
    );

    return result.rows.map((student) => ({
      ...student,
      hasRollNumber: !!student.roll_number,
      isDemoStudent: !!DEMO_STUDENT_MAPPINGS[student.email?.split('@')[0]?.toLowerCase()],
    }));
  } catch (error) {
    console.error('Error fetching unassigned students:', error);
    return [];
  }
}

module.exports = {
  assignStudentToClass,
  batchAssignStudents,
  getUnassignedStudents,
  determineAssignmentMetadata,
  findMatchingClass,
  DEMO_STUDENT_MAPPINGS,
};
