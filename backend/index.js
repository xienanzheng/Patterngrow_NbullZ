import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import analyticsRouter from './routes/analytics.js';
import watchlistRouter from './routes/watchlist.js';

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['http://localhost:5173'];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      // Allow server-to-server requests or same-origin requests.
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'stock-dashboard-api' });
});

app.use('/api/analytics', analyticsRouter);
app.use('/api/watchlist', watchlistRouter);

app.use((err, _req, res, _next) => {
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
