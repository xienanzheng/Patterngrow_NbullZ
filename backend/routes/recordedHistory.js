import express from 'express';
import { requireAuth } from '../utils/authMiddleware.js';
import { publicLimiter } from '../utils/rateLimits.js';
import { getRecordedHistory, validateRecordedHistoryQuery } from '../utils/recordedHistory.js';

const router = express.Router();
router.use(requireAuth, publicLimiter);

router.get('/', async (req, res) => {
  try {
    validateRecordedHistoryQuery(req.query);
  } catch {
    return res.status(400).json({ error: 'Provide one valid symbol only.' });
  }
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await getRecordedHistory(req.query));
  } catch {
    return res.status(503).json({ error: 'Recorded history is unavailable. Please try again shortly.' });
  }
});

export default router;
