const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();

/**
 * Face ID match — disabled until real biometric verification and liveness
 * detection are implemented. Never returns a successful match.
 */
router.post('/match', authenticate, authorize('student', 'faculty', 'admin'), async (_req, res) => {
  return res.status(503).json({
    match: false,
    confidence: 0,
    provider: null,
    error: 'Face verification is not configured. Use attendance code or manual approval instead.',
    code: 'FACE_NOT_CONFIGURED',
  });
});

module.exports = router;
