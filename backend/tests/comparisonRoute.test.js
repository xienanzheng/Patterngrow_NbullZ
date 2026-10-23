import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), limiter: vi.fn((_req, _res, next) => next()) }));
vi.mock('../utils/researchService.js', () => ({ getResearchSnapshot: mocks.snapshot }));
vi.mock('../utils/rateLimits.js', () => ({ publicLimiter: mocks.limiter }));
const router = (await import('../routes/comparison.js')).default;
const app = express();
app.use('/api/analytics/comparison', router);

beforeEach(() => {
  mocks.limiter.mockClear();
  mocks.snapshot.mockReset().mockImplementation(async ({ symbol }) => ({
    symbol, fetchedAt: '2026-10-23T12:00:00Z',
    history: Array.from({ length: 25 }, (_, index) => ({
      date: new Date(Date.UTC(2024, 0, index + 1)).toISOString(), close: 100 + index,
      datePrecision: 'date', exchangeTimezone: 'America/New_York', currency: 'USD', source: 'yahoo',
    })),
    research: { metadata: { currency: 'USD' }, quality: { exchangeTimezone: 'America/New_York' } },
  }));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/analytics/comparison', () => {
  it('serves a public daily benchmark comparison through the shared limiter', async () => {
    const response = await request(app).get('/api/analytics/comparison').query({ symbol: ' aapl ', benchmark: 'spy', range: '1mo' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ symbol: 'AAPL', benchmark: 'SPY', range: '1mo', interval: '1d', comparison: { sample: { commonSessions: 25 } } });
    expect(mocks.limiter).toHaveBeenCalledTimes(1);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    '', '?symbol=AAPL&symbol=MSFT', '?symbol=AAPL&benchmark=SPY&benchmark=QQQ',
    '?symbol=AAPL&range=1y&range=2y', '?symbol=AAPL&range=5y', '?symbol=AAPL&interval=5m',
    '?symbol=AAPL&unknown=1', '?symbol=AAPL&benchmark=https%3A%2F%2Fexample.com',
  ])('rejects invalid or ambiguous queries before fetching data: %s', async (query) => {
    const response = await request(app).get(`/api/analytics/comparison${query}`);
    expect(response.status).toBe(400);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('does not leak upstream secrets even when a provider error claims to be a validation failure', async () => {
    mocks.snapshot.mockRejectedValueOnce(Object.assign(new Error('private-upstream-key'), { status: 400, code: 'INVALID_COMPARISON_QUERY' }));
    const response = await request(app).get('/api/analytics/comparison?symbol=AAPL');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Historical comparison data is unavailable. Please try again shortly.' });
    expect(response.text).not.toContain('private-upstream-key');
    expect(response.body.comparison).toBeUndefined();
  });
});
