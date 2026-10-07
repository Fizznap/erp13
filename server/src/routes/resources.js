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
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'), false);
    }
    cb(null, true);
  },
});

// POST /api/resources/upload — upload a PDF
router.post('/upload', authenticate, authorize('faculty'), upload.single('file'), async (req, res) => {
  try {
    const { subjectId } = req.body;
    if (!subjectId) {
      // Clean up uploaded file
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Subject ID is required' });
    }

    // Verify faculty owns this subject
    const subject = await pool.query(
      'SELECT id FROM subjects WHERE id = $1 AND faculty_id = $2',
      [subjectId, req.user.id]
    );
    if (subject.rows.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'You do not own this subject' });
    }

    const result = await pool.query(
      `INSERT INTO resources (subject_id, uploaded_by, filename, original_name, file_path, file_size, mime_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued') RETURNING *`,
      [
        subjectId,
        req.user.id,
        req.file.filename,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
      ]
    );

    const resource = result.rows[0];

    // Queue processing job
    try {
      const { getProcessingQueue } = require('../jobs/queue');
      const queue = getProcessingQueue();
      if (queue) {
        await queue.add('process-resource', { resourceId: resource.id }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
      }
    } catch (queueErr) {
      console.warn('Queue not available, resource will need manual processing:', queueErr.message);
      // Still return success — resource is saved, just not auto-processed
    }

    res.status(201).json({ resource });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/resources?subjectId=X — list resources for a subject
router.get('/', authenticate, async (req, res) => {
  try {
    const { subjectId } = req.query;
    if (!subjectId) {
      return res.status(400).json({ error: 'subjectId query parameter is required' });
    }

    const result = await pool.query(
      `SELECT id, subject_id, filename, original_name, file_size, status,
              summary, key_topics, bullet_points, page_count, chunk_count,
              created_at, processed_at
       FROM resources
       WHERE subject_id = $1
       ORDER BY created_at DESC`,
      [subjectId]
    );

    res.json({ resources: result.rows });
  } catch (err) {
    console.error('List resources error:', err);
    res.status(500).json({ error: 'Failed to list resources' });
  }
});

// GET /api/resources/:id — get resource detail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.full_name AS uploaded_by_name
       FROM resources r
       JOIN users u ON u.id = r.uploaded_by
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    res.json({ resource: result.rows[0] });
  } catch (err) {
    console.error('Get resource error:', err);
    res.status(500).json({ error: 'Failed to get resource' });
  }
});

// GET /api/resources/:id/status — polling endpoint for processing status
router.get('/:id/status', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, status, error_message, chunk_count, processed_at FROM resources WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// DELETE /api/resources/:id — delete resource + chunks
router.delete('/:id', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const resource = await pool.query(
      'SELECT * FROM resources WHERE id = $1',
      [req.params.id]
    );
    if (resource.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Faculty can only delete their own uploads
    if (req.user.role === 'faculty' && resource.rows[0].uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own resources' });
    }

    // Delete file from disk
    try {
      if (fs.existsSync(resource.rows[0].file_path)) {
        fs.unlinkSync(resource.rows[0].file_path);
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

// POST /api/resources/:id/process — manually trigger processing (no queue needed)
router.post('/:id/process', authenticate, authorize('faculty', 'admin'), async (req, res) => {
  try {
    const resource = await pool.query('SELECT * FROM resources WHERE id = $1', [req.params.id]);
    if (resource.rows.length === 0) {
      return res.status(404).json({ error: 'Resource not found' });
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

module.exports = router;
