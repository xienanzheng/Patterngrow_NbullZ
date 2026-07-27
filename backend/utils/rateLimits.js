import { rateLimit } from 'express-rate-limit';

// Vercel serverless note: stores are per-instance memory, so these are
// best-effort cost bounds, not hard global guarantees. Acceptable at this scale.
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Walk-forward evaluation is the most CPU-expensive route (grid-search fits,
// logistic training, multiple folds) — cap it tighter than general reads.
export const evaluateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Mounted after requireAuth, so req.user is always present — no IP fallback needed.
export const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: 'Chat rate limit reached (20/hour). Try again later.' },
});

// GET /watchlist/scan fans out up to 20 parallel Yahoo history fetches per call —
// cap per-user polling so one user can't exhaust the shared upstream quota.
export const scanLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: { error: 'Scan rate limit reached (5 per 5 minutes). Try again later.' },
});

// GET /positions fetches up to 30 quotes + 1 SPY history per call — throttle
// per-user to bound the fan-out to Yahoo Finance.
export const portfolioLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: { error: 'Portfolio rate limit reached (10/minute). Try again later.' },
});

// POST /order places paper trades against Alpaca — throttle per-user so a runaway
// client loop can't spam order submissions.
export const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: { error: 'Order rate limit reached (20/minute). Try again later.' },
});
