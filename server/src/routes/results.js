const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

// Helper: Calculate SGPA/CGPA
function calculateSGPA(results) {
  if (!results || results.length === 0) return null;
  
  let totalCredits = 0;
  let totalWeightedPoints = 0;
  
  for (const result of results) {
    const credits = Number(result.credits) || 0;
    const gradePoints = Number(result.grade_points) || 0;
    
    totalCredits += credits;
    totalWeightedPoints += credits * gradePoints;
  }
  
  return totalCredits > 0 ? (totalWeightedPoints / totalCredits).toFixed(2) : '0.00';
}

// Helper: Sanitize result for response
function sanitizeResult(result) {
  return {
    id: result.id,
    studentId: result.student_id,
    subjectId: result.subject_id,
    academicClassId: result.academic_class_id,
    subjectName: result.subject_name,
    subjectCode: result.subject_code,
    studentName: result.student_name,
    rollNumber: result.roll_number,
    branchCode: result.branch_code,
    divisionName: result.division_name,
    semesterNumber: result.semester_number,
    internalMarks: result.internal_marks != null ? Number(result.internal_marks) : null,
    externalMarks: result.external_marks != null ? Number(result.external_marks) : null,
    totalMarks: result.total_marks != null ? Number(result.total_marks) : null,
    grade: result.grade,
    gradePoints: Number(result.grade_points) || 0,
    credits: Number(result.credits) || 0,
    status: result.status,
    examType: result.exam_type,
    academicYear: result.academic_year,
    remarks: result.remarks,
    isSynthetic: result.is_synthetic,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
}

/**
 * GET /api/results
 * List results with optional filters (admin and faculty)
 */
router.get('/', authenticate, requireRole(['admin', 'faculty']), async (req, res) => {
  try {
    const { classId, subjectId, status, studentId, academicYear, limit = 100, offset = 0 } = req.query;

    let whereConditions = [];
    let params = [];
    let paramCount = 1;

    // Faculty scope: only results for subjects/classes they teach
    if (req.user.role === 'faculty') {
      whereConditions.push(`ar.academic_class_id IN (
        SELECT academic_class_id FROM subject_offerings WHERE faculty_id = $${paramCount}
      )`);
      params.push(req.user.id);
      paramCount++;
    }

    if (classId) {
      whereConditions.push(`ar.academic_class_id = $${paramCount}`);
      params.push(classId);
      paramCount++;
    }

    if (subjectId) {
      whereConditions.push(`ar.subject_id = $${paramCount}`);
      params.push(subjectId);
      paramCount++;
    }

    if (status) {
      whereConditions.push(`ar.status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }

    if (academicYear) {
      whereConditions.push(`ar.academic_year = $${paramCount}`);
      params.push(parseInt(academicYear, 10));
      paramCount++;
    }

    if (studentId) {
      // Support studentId as UUID or roll number
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId);
      if (isUuid) {
        whereConditions.push(`ar.student_id = $${paramCount}`);
        params.push(studentId);
        paramCount++;
      } else {
        whereConditions.push(`(LOWER(up.roll_number) = LOWER($${paramCount}) OR LOWER(u.email) = LOWER($${paramCount}))`);
        params.push(studentId);
        paramCount++;
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const listQuery = `
      SELECT ar.*, s.name as subject_name, s.code as subject_code,
             u.full_name as student_name, up.roll_number,
             br.code as branch_code, d.name as division_name, sem.number as semester_number
      FROM academic_results ar
      JOIN subjects s ON s.id = ar.subject_id
      JOIN users u ON u.id = ar.student_id
      LEFT JOIN user_profiles up ON up.user_id = ar.student_id
      LEFT JOIN academic_classes ac ON ac.id = ar.academic_class_id
      LEFT JOIN branches br ON br.id = ac.branch_id
      LEFT JOIN divisions d ON d.id = ac.division_id
      LEFT JOIN semesters sem ON sem.id = ac.semester_id
      ${whereClause}
      ORDER BY ar.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const countQuery = `
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE ar.status = 'published') as published_count,
        COUNT(*) FILTER (WHERE ar.status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE ar.status = 'withheld') as withheld_count
      FROM academic_results ar
      JOIN users u ON u.id = ar.student_id
      LEFT JOIN user_profiles up ON up.user_id = ar.student_id
      ${whereClause}
    `;

    const [rowsResult, countResult] = await Promise.all([
      pool.query(listQuery, [...params, parseInt(limit, 10), parseInt(offset, 10)]),
      pool.query(countQuery, params),
    ]);

    const results = rowsResult.rows.map(r => ({
      ...sanitizeResult(r),
      studentName: r.student_name,
      rollNumber: r.roll_number,
      branchCode: r.branch_code,
      divisionName: r.division_name,
      semesterNumber: r.semester_number,
    }));

    const counts = countResult.rows[0] || { total_count: '0', published_count: '0', draft_count: '0', withheld_count: '0' };

    res.json({
      results,
      count: results.length,
      totalCount: parseInt(counts.total_count || '0', 10),
      publishedCount: parseInt(counts.published_count || '0', 10),
      draftCount: parseInt(counts.draft_count || '0', 10),
      withheldCount: parseInt(counts.withheld_count || '0', 10),
    });
  } catch (err) {
    console.error('List results error:', err);
    res.status(500).json({ error: 'Could not fetch results' });
  }
});

/**
 * GET /api/results/student/:studentId
 * Get all results for a student (admin/faculty can see any, students can only see their own)
 */
router.get('/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { semester, academicYear, status } = req.query;

    let targetStudentId = studentId;

    // Authorization: students can only view their own results
    if (req.user.role === 'student') {
      if (req.user.id !== studentId) {
        return res.status(403).json({ error: 'You can only view your own results' });
      }
    } else {
      // For admin / faculty: resolve studentId if it's a roll number or email
      const isRollOrEmail = studentId.includes('@') || (/^[A-Za-z0-9_]+$/.test(studentId) && !studentId.includes('-'));
      if (isRollOrEmail) {
        const userLookup = await pool.query(
          `SELECT u.id FROM users u
           LEFT JOIN user_profiles up ON up.user_id = u.id
           WHERE LOWER(up.roll_number) = LOWER($1) OR LOWER(u.email) = LOWER($1)`,
          [studentId]
        );
        if (userLookup.rows.length === 0) {
          return res.status(404).json({ error: 'Student not found with this roll number or email' });
        }
        targetStudentId = userLookup.rows[0].id;
      }
    }

    let query = `
      SELECT ar.*, s.name as subject_name, s.code as subject_code,
             sem.number as semester_number, br.code as branch_code, br.name as branch_name,
             bt.start_year as batch_start_year, bt.end_year as batch_end_year,
             d.name as division_name
      FROM academic_results ar
      JOIN subjects s ON s.id = ar.subject_id
      LEFT JOIN academic_classes ac ON ac.id = ar.academic_class_id
      LEFT JOIN semesters sem ON sem.id = ac.semester_id
      LEFT JOIN branches br ON br.id = ac.branch_id
      LEFT JOIN batches bt ON bt.id = ac.batch_id
      LEFT JOIN divisions d ON d.id = ac.division_id
      WHERE ar.student_id = $1
    `;
    const params = [targetStudentId];
    let paramCount = 2;

    // Filter by status (students only see 'published')
    if (req.user.role === 'student') {
      query += ` AND ar.status = 'published'`;
    } else if (status) {
      query += ` AND ar.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    // Filter by academic year
    if (academicYear) {
      query += ` AND ar.academic_year = $${paramCount}`;
      params.push(parseInt(academicYear, 10));
      paramCount++;
    }

    // Filter by semester (via academic_classes)
    if (semester) {
      query += ` AND ar.academic_class_id IN (
        SELECT id FROM academic_classes WHERE semester_id = (
          SELECT id FROM semesters WHERE number = $${paramCount}
        )
      )`;
      params.push(parseInt(semester, 10));
      paramCount++;
    }

    query += ` ORDER BY ar.academic_year DESC, ar.created_at DESC`;

    const result = await pool.query(query, params);
    const results = result.rows.map(sanitizeResult);

    // Calculate semester-wise SGPA and structured terms
    const semesterGroups = {};
    for (const r of result.rows) {
      const key = `${r.academic_year}-${r.academic_class_id}`;
      if (!semesterGroups[key]) semesterGroups[key] = [];
      semesterGroups[key].push(r);
    }

    const sgpaData = Object.entries(semesterGroups).map(([key, semResults]) => ({
      academicYear: semResults[0].academic_year,
      academicClassId: semResults[0].academic_class_id,
      sgpa: calculateSGPA(semResults),
      resultCount: semResults.length,
    }));

    const terms = Object.entries(semesterGroups).map(([key, semResults]) => {
      const first = semResults[0];
      const semNum = first.semester_number || 5;
      const batchYears = first.batch_start_year && first.batch_end_year
        ? `${first.batch_start_year}–${String(first.batch_end_year).slice(-2)}`
        : '2024–28';
      const academicYear = first.academic_year || 2024;
      const termTitle = `ODD Term AY ${academicYear}–${String(academicYear + 1).slice(-2)}`;

      const earnedCredits = semResults
        .filter((r) => r.grade !== 'F' && r.grade !== 'AB')
        .reduce((sum, r) => sum + (Number(r.credits) || 0), 0);

      return {
        termId: key,
        termTitle,
        semesterNumber: semNum,
        academicYear,
        batch: `Batch ${batchYears}`,
        divisionName: first.division_name || 'B',
        branchCode: first.branch_code || 'BTECH-CSE',
        branchName: first.branch_name || 'Computer Science and Engineering',
        declarationDate: first.created_at,
        status: first.status,
        sgpa: calculateSGPA(semResults),
        earnedCredits,
        totalCourses: semResults.length,
        results: semResults.map(sanitizeResult),
      };
    });

    // Calculate overall CGPA and total earned credits
    const cgpa = calculateSGPA(result.rows);
    const totalCredits = results
      .filter((r) => r.grade !== 'F' && r.grade !== 'AB')
      .reduce((sum, r) => sum + (Number(r.credits) || 0), 0);
    const declaredTermsCount = terms.filter((t) => t.status === 'published').length;

    res.json({
      results,
      terms,
      summary: {
        totalResults: results.length,
        totalCredits,
        sgpaData,
        cgpa,
        declaredTermsCount,
        pendingTermsCount: 0,
      },
    });
  } catch (err) {
    console.error('Get student results error:', err);
    res.status(500).json({ error: 'Could not fetch results' });
  }
});

/**
 * GET /api/results/class/:classId
 * Get all results for a class (admin/faculty only)
 */
router.get('/class/:classId', authenticate, requireRole(['admin', 'faculty']), async (req, res) => {
  try {
    const { classId } = req.params;
    const { subjectId, status } = req.query;
    
    let query = `
      SELECT ar.*, s.name as subject_name, s.code as subject_code,
             u.full_name as student_name, up.roll_number
      FROM academic_results ar
      JOIN subjects s ON s.id = ar.subject_id
      JOIN users u ON u.id = ar.student_id
      LEFT JOIN user_profiles up ON up.user_id = ar.student_id
      WHERE ar.academic_class_id = $1
    `;
    const params = [classId];
    let paramCount = 2;
    
    if (subjectId) {
      query += ` AND ar.subject_id = $${paramCount}`;
      params.push(subjectId);
      paramCount++;
    }
    
    if (status) {
      query += ` AND ar.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    query += ` ORDER BY up.roll_number, s.code`;
    
    const result = await pool.query(query, params);
    const results = result.rows.map(r => ({
      ...sanitizeResult(r),
      studentName: r.student_name,
      rollNumber: r.roll_number,
    }));
    
    res.json({ results, count: results.length });
  } catch (err) {
    console.error('Get class results error:', err);
    res.status(500).json({ error: 'Could not fetch results' });
  }
});

/**
 * POST /api/results
 * Create a new result (admin/faculty only)
 */
router.post('/', authenticate, requireRole(['admin', 'faculty']), async (req, res) => {
  try {
    const {
      studentId,
      subjectId,
      academicClassId,
      internalMarks,
      externalMarks,
      totalMarks,
      grade,
      credits,
      examType = 'regular',
      academicYear,
      remarks,
      isSynthetic = false,
      status = 'draft',
    } = req.body;
    
    // Validation
    if (!studentId || !subjectId || !academicClassId || !academicYear) {
      return res.status(400).json({ error: 'studentId, subjectId, academicClassId, and academicYear are required' });
    }
    
    if (credits !== undefined && (credits < 0 || credits > 10)) {
      return res.status(400).json({ error: 'Credits must be between 0 and 10' });
    }

    if (internalMarks !== undefined && internalMarks !== null && (Number(internalMarks) < 0 || Number(internalMarks) > 100)) {
      return res.status(400).json({ error: 'Internal marks must be between 0 and 100' });
    }
    if (externalMarks !== undefined && externalMarks !== null && (Number(externalMarks) < 0 || Number(externalMarks) > 100)) {
      return res.status(400).json({ error: 'External marks must be between 0 and 100' });
    }

    const computedTotal = (totalMarks !== undefined && totalMarks !== null && totalMarks !== '')
      ? Number(totalMarks)
      : (internalMarks !== undefined && internalMarks !== null || externalMarks !== undefined && externalMarks !== null)
        ? (Number(internalMarks) || 0) + (Number(externalMarks) || 0)
        : null;

    if (computedTotal !== null && (computedTotal < 0 || computedTotal > 100)) {
      return res.status(400).json({ error: 'Total marks must be between 0 and 100' });
    }

    const resultStatus = ['draft', 'published', 'withheld'].includes(status) ? status : 'draft';
    
    // Check if result already exists
    const existingResult = await pool.query(
      `SELECT id FROM academic_results 
       WHERE student_id = $1 AND subject_id = $2 AND academic_class_id = $3 AND exam_type = $4`,
      [studentId, subjectId, academicClassId, examType]
    );
    
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'Result already exists for this student-subject-class combination' });
    }
    
    // Insert result
    const result = await pool.query(
      `INSERT INTO academic_results 
       (student_id, subject_id, academic_class_id, internal_marks, external_marks, 
        total_marks, grade, credits, exam_type, academic_year, remarks, is_synthetic, 
        created_by, updated_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14)
       RETURNING *`,
      [
        studentId,
        subjectId,
        academicClassId,
        internalMarks !== undefined && internalMarks !== null ? Number(internalMarks) : null,
        externalMarks !== undefined && externalMarks !== null ? Number(externalMarks) : null,
        computedTotal,
        grade || null,
        credits || 4.0,
        examType,
        academicYear,
        remarks || null,
        isSynthetic,
        req.user.id,
        resultStatus,
      ]
    );
    
    res.status(201).json({ result: sanitizeResult(result.rows[0]) });
  } catch (err) {
    console.error('Create result error:', err);
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid student, subject, or class ID' });
    }
    res.status(500).json({ error: 'Could not create result' });
  }
});

/**
 * PATCH /api/results/:id
 * Update a result (admin/faculty only)
 */
router.patch('/:id', authenticate, requireRole(['admin', 'faculty']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      internalMarks,
      externalMarks,
      totalMarks,
      grade,
      credits,
      status,
      remarks,
    } = req.body;
    
    const updates = [];
    const params = [id];
    let paramCount = 2;
    
    if (internalMarks !== undefined) {
      updates.push(`internal_marks = $${paramCount}`);
      params.push(internalMarks);
      paramCount++;
    }
    
    if (externalMarks !== undefined) {
      updates.push(`external_marks = $${paramCount}`);
      params.push(externalMarks);
      paramCount++;
    }
    
    if (totalMarks !== undefined) {
      updates.push(`total_marks = $${paramCount}`);
      params.push(totalMarks);
      paramCount++;
    }
    
    if (grade !== undefined) {
      updates.push(`grade = $${paramCount}`);
      params.push(grade);
      paramCount++;
    }
    
    if (credits !== undefined) {
      if (credits < 0 || credits > 10) {
        return res.status(400).json({ error: 'Credits must be between 0 and 10' });
      }
      updates.push(`credits = $${paramCount}`);
      params.push(credits);
      paramCount++;
    }
    
    if (status !== undefined) {
      if (!['draft', 'published', 'withheld'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updates.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }
    
    if (remarks !== undefined) {
      updates.push(`remarks = $${paramCount}`);
      params.push(remarks);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push(`updated_by = $${paramCount}`);
    params.push(req.user.id);
    paramCount++;
    
    const query = `
      UPDATE academic_results 
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Result not found' });
    }
    
    res.json({ result: sanitizeResult(result.rows[0]) });
  } catch (err) {
    console.error('Update result error:', err);
    res.status(500).json({ error: 'Could not update result' });
  }
});

/**
 * DELETE /api/results/:id
 * Delete a result (admin only)
 */
router.delete('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM academic_results WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Result not found' });
    }
    
    res.json({ message: 'Result deleted successfully', id: result.rows[0].id });
  } catch (err) {
    console.error('Delete result error:', err);
    res.status(500).json({ error: 'Could not delete result' });
  }
});

/**
 * POST /api/results/bulk
 * Bulk create results (admin/faculty only)
 */
router.post('/bulk', authenticate, requireRole(['admin', 'faculty']), async (req, res) => {
  try {
    const { results } = req.body;
    
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results must be a non-empty array' });
    }
    
    if (results.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 results per bulk operation' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const created = [];
      const errors = [];
      
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        
        try {
          // Validate required fields
          if (!r.studentId || !r.subjectId || !r.academicClassId || !r.academicYear) {
            errors.push({ index: i, error: 'Missing required fields' });
            continue;
          }
          
          // Insert result
          const result = await client.query(
            `INSERT INTO academic_results 
             (student_id, subject_id, academic_class_id, internal_marks, external_marks, 
              total_marks, grade, credits, exam_type, academic_year, remarks, is_synthetic, 
              created_by, updated_by, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, 'draft')
             ON CONFLICT (student_id, subject_id, academic_class_id, exam_type) 
             DO UPDATE SET
               internal_marks = EXCLUDED.internal_marks,
               external_marks = EXCLUDED.external_marks,
               total_marks = EXCLUDED.total_marks,
               grade = EXCLUDED.grade,
               credits = EXCLUDED.credits,
               remarks = EXCLUDED.remarks,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
             RETURNING *`,
            [
              r.studentId,
              r.subjectId,
              r.academicClassId,
              r.internalMarks || null,
              r.externalMarks || null,
              r.totalMarks || null,
              r.grade || null,
              r.credits || 4.0,
              r.examType || 'regular',
              r.academicYear,
              r.remarks || null,
              r.isSynthetic || false,
              req.user.id,
            ]
          );
          
          created.push(sanitizeResult(result.rows[0]));
        } catch (err) {
          errors.push({ index: i, error: err.message });
        }
      }
      
      await client.query('COMMIT');
      
      res.status(201).json({
        created: created.length,
        errors: errors.length,
        results: created,
        errorDetails: errors,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Bulk create results error:', err);
    res.status(500).json({ error: 'Could not create results' });
  }
});

/**
 * POST /api/results/publish
 * Publish results (change status from draft to published) - admin/faculty only
 */
router.post('/publish', authenticate, requireRole(['admin', 'faculty']), async (req, res) => {
  try {
    const { resultIds } = req.body;
    
    if (!Array.isArray(resultIds) || resultIds.length === 0) {
      return res.status(400).json({ error: 'resultIds must be a non-empty array' });
    }
    
    const result = await pool.query(
      `UPDATE academic_results 
       SET status = 'published', updated_by = $1, updated_at = now()
       WHERE id = ANY($2::uuid[]) AND status = 'draft'
       RETURNING id`,
      [req.user.id, resultIds]
    );
    
    res.json({
      message: `Published ${result.rows.length} result(s)`,
      publishedCount: result.rows.length,
      publishedIds: result.rows.map(r => r.id),
    });
  } catch (err) {
    console.error('Publish results error:', err);
    res.status(500).json({ error: 'Could not publish results' });
  }
});

module.exports = router;
