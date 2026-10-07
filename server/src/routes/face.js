const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();

/**
 * Phase 2 Placeholder: Face ID MVP Adapter
 * Provides a hook for 1:1 face matching against stored hashed profiles.
 */
router.post('/match', authenticate, authorize('student', 'faculty', 'admin'), async (req, res) => {
  try {
    const { imageBase64, deviceId } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required for face match' });
    }

    // TODO Phase 2:
    // 1. Fetch user's stored profile selfie embedding from DB
    // 2. Call external CV provider (e.g. AWS Rekognition, Google Vision, or custom OpenCV service)
    // 3. Compare similarity score
    // 4. Return confidence and boolean match

    // MVP Mock implementation
    console.log(`[Face-ID] Received match request from user ${req.user.id} on device ${deviceId}`);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));

    // For MVP, always return a mock success payload
    res.json({
      match: true,
      confidence: 0.98,
      provider: 'mock-local',
      message: 'Face ID match successful (MVP mock)'
    });
  } catch (err) {
    console.error('Face match error:', err);
    res.status(500).json({ error: 'Failed to process face match' });
  }
});

module.exports = router;
