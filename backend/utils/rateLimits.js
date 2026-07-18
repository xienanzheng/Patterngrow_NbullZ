import { rateLimit } from 'express-rate-limit';

// Vercel serverless note: stores are per-instance memory, so these are
// best-effort cost bounds, not hard global guarantees. Acceptable at this scale.
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
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
