import express from 'express';
import { getMarketOverview } from '../utils/marketOverview.js';
import { publicLimiter } from '../utils/rateLimits.js';

const router = express.Router();
router.use(publicLimiter);

router.get('/', async (req, res) => {
  if (Object.keys(req.query).length) {
    return res.status(400).json({ error: 'This overview uses six fixed daily fund proxies and takes no query parameters.' });
  }
  try {
    const overview = await getMarketOverview();
    // Provider outages are represented by unavailable rows, without raw upstream errors.
    return res.json(overview);
  } catch {
    return res.status(503).json({ error: 'The market overview is unavailable. Please try again shortly.' });
  }
});

export default router;
