const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Configure multer for PDF uploads
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf' && path.extname(file.originalname).toLowerCase() !== '.pdf') {
      return cb(new Error('Only PDF files are allowed'), false);
    }
    cb(null, true);
  },
});

/**
 * Return SQL WHERE clause + params to scope a resource list query to the
 * caller's authorized scope.
 *
 * Students: only resources tied to offerings in their enrolled class.
 * Faculty: resources they uploaded, or resources for offerings they teach.
 * Admin: no extra scope (all resources).
 *
 * Returns { whereClause, params }. whereClause is ready to append after the
 * base WHERE (it starts with "AND ").
 */
function resourceListScope(user, subjectParamIndex) {
  const classParamIndex = subjectParamIndex + 1;
  if (user.role === 'admin') {
    return { whereClause: '', params: [] };
  }
  if (user.role === 'faculty') {
    return {
      whereClause: `AND (
        r.uploaded_by = $${subjectParamIndex}
        OR r.subject_offering_id IN (
          SELECT so.id FROM subject_offerings so WHERE so.faculty_id = $${classParamIndex}
        )
      )`,
      params: [user.id, user.id],
    };
  }
  // student
  return {
    whereClause: `AND r.subject_offering_id IN (
      SELECT so.id FROM subject_offerings so
      JOIN academic_classes ac ON ac.id = so.academic_class_id
      WHERE ac.id = $${classParamIndex}
    )`,
    params: [user.academicClassId],
  };
}

/**
 * Fetch a resource and verify the caller is authorized to access it.
 * Returns { authorized: boolean, resource: object|null, reason: string|null }.
 */
async function canAccessResource(user, resourceId) {
  const result = await pool.query(
    `SELECT r.id, r.subject_id, r.subject_offering_id, r.uploaded_by, r.filename,
            r.original_name, r.file_path, r.file_size, r.mime_type, r.status,
            r.kind, r.progress, r.stage, r.error_message, r.created_at, r.processed_at,
            so.faculty_id AS offering_faculty_id, ac.id AS class_id
     FROM resources r
     LEFT JOIN subject_offerings so ON so.id = r.subject_offering_id
     LEFT JOIN academic_classes ac ON ac.id = so.academic_class_id
     WHERE r.id = $1`,
    [resourceId]
  );
  if (result.rows.length === 0) {
    return { authorized: false, resource: null, reason: 'not found' };
  }
  const r = result.rows[0];
  if (user.role === 'admin') {
    return { authorized: true, resource: r, reason: null };
  }
  if (user.role === 'faculty') {
    if (r.uploaded_by === user.id) {
      return { authorized: true, resource: r, reason: null };
    }
    if (r.offering_faculty_id === user.id) {
      return { authorized: true, resource: r, reason: null };
    }
    return { authorized: false, resource: r, reason: 'not owner or instructor' };
  }
  // student
  if (r.subject_offering_id && r.class_id === user.academicClassId) {
    return { authorized: true, resource: r, reason: null };
  }
  return { authorized: false, resource: r, reason: 'not enrolled in this offering' };
}

// POST /api/resources/upload — upload a PDF
router.post('/upload', authenticate, authorize('faculty'), upload.single('file'), async (req, res) => {
  try {
    const { subjectOfferingId, subjectId, kind } = req.body;
    
    // Support either subjectOfferingId (new) or subjectId (legacy)
    if (!subjectOfferingId && !subjectId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'subjectOfferingId or subjectId is required' });
    }

    let actualSubjectId = subjectId;
    let offeringId = subjectOfferingId || null;

    if (subjectOfferingId) {
      // Verify faculty owns this offering
      const offering = await pool.query(
        'SELECT subject_id FROM subject_offerings WHERE id = $1 AND faculty_id = $2',
        [subjectOfferingId, req.user.id]
      );
      if (offering.rows.length === 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'You do not own this subject offering' });
      }
      actualSubjectId = offering.rows[0].subject_id;
    } else {
      // Legacy path
      const subject = await pool.query(
        'SELECT id FROM subjects WHERE id = $1 AND faculty_id = $2',
        [subjectId, req.user.id]
      );
      if (subject.rows.length === 0) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'You do not own this subject' });
      }
    }

    const result = await pool.query(
      `INSERT INTO resources (subject_id, subject_offering_id, uploaded_by, filename, original_name, file_path, file_size, mime_type, status, kind, progress, stage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9, 0, 'UPLOAD COMPLETE') RETURNING *`,
      [
        actualSubjectId,
        offeringId,
        req.user.id,
        req.file.filename,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        kind || 'Notes'
      ]
    );

    const resource = result.rows[0];

    // Queue processing job
    try {
      const { getProcessingQueue } = require('../jobs/queue');
      const queue = getProcessingQueue();
      if (queue) {
        await Promise.race([
          queue.add('process-resource', { resourceId: resource.id }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Resource queue timed out')), 5000)),
        ]);
      } else {
        throw new Error('Resource queue is unavailable');
      }
    } catch (queueErr) {
      console.warn('Queue unavailable; processing resource inline:', queueErr.message);
      const { processResource } = require('../services/processor');
      void processResource(resource.id).catch((processingErr) => {
        console.error(`Inline processing failed for resource ${resource.id}:`, processingErr.message);
      });
    }

    res.status(201).json({ resource });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed', details: err.message, stack: err.stack });
  }
});

// GET /api/resources?subjectOfferingId=X — list resources for a subject offering
// Access is scoped to the caller's enrolled class (students), owned/taught
// offerings (faculty), or all resources (admin).
router.get('/', authenticate, async (req, res) => {
  try {
    const { subjectOfferingId, subjectId } = req.query;
    if (!subjectOfferingId && !subjectId) {
      return res.status(400).json({ error: 'subjectOfferingId or subjectId query parameter is required' });
    }

    const scope = resourceListScope(req.user, 1);
    const baseParams = subjectOfferingId ? [subjectOfferingId] : [subjectId];
    const allParams = [...baseParams, ...scope.params];
    const scopeClause = scope.whereClause ? ` ${scope.whereClause}` : '';

    let result;
    if (subjectOfferingId) {
      result = await pool.query(
        `SELECT id, subject_id, subject_offering_id, filename, original_name, file_size, status,
                summary, key_topics, bullet_points, page_count, chunk_count,
                created_at, processed_at
         FROM resources
         WHERE subject_offering_id = $1${scopeClause}
         ORDER BY created_at DESC`,
        allParams
      );
    } else {
      result = await pool.query(
        `SELECT id, subject_id, subject_offering_id, filename, original_name, file_size, status,
                summary, key_topics, bullet_points, page_count, chunk_count,
                created_at, processed_at
         FROM resources
         WHERE subject_id = $1${scopeClause}
         ORDER BY created_at DESC`,
        allParams
      );
    }

    res.json({ resources: result.rows });
  } catch (err) {
    console.error('List resources error:', err);
    res.status(500).json({ error: 'Failed to list resources' });
  }
});

// GET /api/resources/:id/status — get processing status (authorized)
router.get('/:id/status', authenticate, async (req, res) => {
  try {
    const { authorized, resource, reason } = await canAccessResource(req.user, req.params.id);
    if (!authorized) {
      if (reason === 'not found') {
        return res.status(404).json({ error: 'Resource not found' });
      }
      return res.status(403).json({ error: `Access denied: ${reason}` });
    }
    res.json({
      resourceId: resource.id,
      status: (resource.status || 'queued').toUpperCase(),
      stage: resource.stage || 'QUEUED',
      progress: resource.progress || 0,
      message: resource.error_message || resource.stage || 'Processing',
      ready: resource.status === 'ready',
      error: resource.status === 'failed' ? resource.error_message || 'Processing failed' : null
    });
  } catch (err) {
    console.error('Status check error:', err);
    res.status(500).json({ error: 'Failed to retrieve status' });
  }
});

// GET /api/resources/:id — get resource detail (authorized)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { authorized, resource, reason } = await canAccessResource(req.user, req.params.id);
    if (!authorized) {
      if (reason === 'not found') {
        return res.status(404).json({ error: 'Resource not found' });
      }
      return res.status(403).json({ error: `Access denied: ${reason}` });
    }
    const result = await pool.query(
      `SELECT r.*, u.full_name AS uploaded_by_name
       FROM resources r
       JOIN users u ON u.id = r.uploaded_by
       WHERE r.id = $1`,
      [req.params.id]
    );
    res.json({ resource: result.rows[0] });
  } catch (err) {
    console.error('Get resource error:', err);
    res.status(500).json({ error: 'Failed to get resource' });
  }
});

// DELETE /api/resources/:id — delete resource + chunks (authorized)
router.delete('/:id', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { authorized, resource, reason } = await canAccessResource(req.user, req.params.id);
    if (!authorized) {
      if (reason === 'not found') {
        return res.status(404).json({ error: 'Resource not found' });
      }
      return res.status(403).json({ error: `Access denied: ${reason}` });
    }

    // Delete file from disk
    try {
      if (fs.existsSync(resource.file_path)) {
        fs.unlinkSync(resource.file_path);
      }
    } catch (fileErr) {
      console.warn('Failed to delete file:', fileErr.message);
    }

    // Delete from DB (cascades to chunks)
    await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);

    res.json({ message: 'Resource deleted' });
  } catch (err) {
    console.error('Delete resource error:', err);
    res.status(500).json({ error: 'Failed to delete resource' });
  }
});

// POST /api/resources/:id/process — manually trigger processing (authorized)
router.post('/:id/process', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const { authorized, resource, reason } = await canAccessResource(req.user, req.params.id);
    if (!authorized) {
      if (reason === 'not found') {
        return res.status(404).json({ error: 'Resource not found' });
      }
      return res.status(403).json({ error: `Access denied: ${reason}` });
    }

    // Run processing inline (for when Bull/Redis is not available)
    const { processResource } = require('../services/processor');
    // Don't await — run in background
    processResource(req.params.id).catch(err => {
      console.error('Processing failed:', err);
    });

    res.json({ message: 'Processing started' });
  } catch (err) {
    console.error('Process trigger error:', err);
    res.status(500).json({ error: 'Failed to start processing' });
  }
});

// GET /api/resources/:id/download — download the original PDF (authorized)
router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const { authorized, resource, reason } = await canAccessResource(req.user, req.params.id);
    if (!authorized) {
      if (reason === 'not found') {
        return res.status(404).json({ error: 'Resource not found' });
      }
      return res.status(403).json({ error: `Access denied: ${reason}` });
    }

    const filePath = resource.file_path;
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File is no longer available in ephemeral storage. It may have been cleared by a server restart.');
    }

    res.download(filePath, resource.original_name);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

module.exports = router;
