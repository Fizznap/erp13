const express = require('express');
const path = require('path');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const uploadDir = path.resolve(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');

router.use(authenticate, authorize('admin'), express.static(uploadDir));

module.exports = router;
