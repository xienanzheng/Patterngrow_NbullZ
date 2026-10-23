import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { overview, limiter } = vi.hoisted(() => ({ overview: vi.fn(), limiter: vi.fn((_req, _res, next) => next()) }));
vi.mock('../utils/marketOverview.js', () => ({ getMarketOverview: overview }));
vi.mock('../utils/rateLimits.js', () => ({ publicLimiter: limiter }));
import router from '../routes/marketOverview.js';

const app = express();
app.use('/api/analytics/overview', router);

beforeEach(() => {
  overview.mockReset().mockResolvedValue({ status: 'partial', rows: [], coverage: { available: 0, requested: 6 } });
  limiter.mockClear();
});

describe('GET /api/analytics/overview', () => {
  it('is public, applies the limiter and calls the fixed overview without client arguments', async () => {
    const response = await request(app).get('/api/analytics/overview');
    expect(response.status).toBe(200);
    expect(limiter).toHaveBeenCalledOnce();
    expect(overview).toHaveBeenCalledWith();
    expect(response.body.status).toBe('partial');
  });

  it.each(['?symbol=AAPL', '?symbols=SPY&symbols=QQQ', '?range=max', '?interval=1m', '?refresh=true'])('rejects query-driven amplification: %s', async (query) => {
    const response = await request(app).get(`/api/analytics/overview${query}`);
    expect(response.status).toBe(400);
    expect(overview).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected service errors', async () => {
    overview.mockRejectedValue(new Error('Provider API key private-secret must stay hidden'));
    const response = await request(app).get('/api/analytics/overview');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'The market overview is unavailable. Please try again shortly.' });
    expect(response.text).not.toContain('private-secret');
  });
});
