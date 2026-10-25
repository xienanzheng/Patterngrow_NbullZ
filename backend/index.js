import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import alertsRouter from './routes/alerts.js';
import analyticsRouter from './routes/analytics.js';
import positionsRouter from './routes/positions.js';
import watchlistRouter from './routes/watchlist.js';
import preferencesRouter from './routes/preferences.js';
import brokerRouter from './routes/broker.js';
import backtestsRouter from './routes/backtests.js';
import comparisonRouter from './routes/comparison.js';
import marketOverviewRouter from './routes/marketOverview.js';
import recordedHistoryRouter from './routes/recordedHistory.js';

const app = express();

app.set('trust proxy', 1); // Vercel terminates TLS in front of the function

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['http://localhost:5173'];

function firstForwardedValue(value) {
  return value?.split(',')[0]?.trim();
}

function isSameOriginRequest(req, origin) {
  try {
    const parsedOrigin = new URL(origin);
    const requestProtocol = firstForwardedValue(req.get('x-forwarded-proto')) ?? req.protocol;
    const requestHosts = [
      firstForwardedValue(req.get('x-forwarded-host')),
      req.get('host'),
    ].filter(Boolean);

    return parsedOrigin.protocol === `${requestProtocol}:`
      && requestHosts.some((host) => parsedOrigin.host.toLowerCase() === host.toLowerCase());
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.get('origin');
  const originAllowed = !origin
    || allowedOrigins.includes('*')
    || allowedOrigins.includes(origin)
    || isSameOriginRequest(req, origin);

  if (!originAllowed) {
    const error = new Error(`Origin ${origin} not allowed by CORS`);
    error.code = 'CORS_ORIGIN_DENIED';
    return next(error);
  }

  return cors({ origin: true, credentials: true })(req, res, next);
});
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'stock-dashboard-api' });
});

app.use('/api/alerts', alertsRouter);
app.use('/api/analytics/comparison', comparisonRouter);
app.use('/api/analytics/overview', marketOverviewRouter);
app.use('/api/analytics/recorded-history', recordedHistoryRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/positions', positionsRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/user/preferences', preferencesRouter);
app.use('/api/broker', brokerRouter);
app.use('/api/backtests', backtestsRouter);

app.use((err, _req, res, _next) => {
  if (err.code === 'CORS_ORIGIN_DENIED') {
    return res.status(403).json({ error: err.message });
  }
  console.error('Unhandled API error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`API server running on http://localhost:${port}`);
  });
}

export default app;
