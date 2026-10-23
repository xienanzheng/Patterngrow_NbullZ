import express from 'express';
import { getComparisonSnapshot } from '../utils/comparisonService.js';
import { publicLimiter } from '../utils/rateLimits.js';

const router = express.Router();
router.use(publicLimiter);

router.get('/', async (req, res) => {
  try {
    res.json(await getComparisonSnapshot(req.query));
  } catch (error) {
    if (error.code === 'INVALID_COMPARISON_QUERY') {
      return res.status(400).json({ error: 'Provide one valid symbol and benchmark, a supported range, and daily interval only.' });
    }
    return res.status(503).json({ error: 'Historical comparison data is unavailable. Please try again shortly.' });
  }
});

export default router;
