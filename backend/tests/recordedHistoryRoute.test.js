import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), user: vi.fn(), limiter: vi.fn((_req, _res, next) => next()),
}));
vi.mock('../utils/supabaseClient.js', () => ({ supabaseAdmin: { from: mocks.from }, getUserFromRequest: mocks.user }));
vi.mock('../utils/rateLimits.js', () => ({ publicLimiter: mocks.limiter }));
const router = (await import('../routes/recordedHistory.js')).default;
const app = express();
app.use('/api/analytics/recorded-history', router);

beforeEach(() => {
  mocks.from.mockReset().mockImplementation((table) => {
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(() => chain),
      abortSignal: vi.fn(async () => table === 'forecast_log'
        ? { error: { message: 'private-db-key' } } : { data: [] }),
    };
    return chain;
  });
  mocks.user.mockReset().mockImplementation(async (req) => req.headers.authorization === 'Bearer verified-test-token'
    ? { user: { id: 'verified-user' }, token: 'verified-test-token' }
    : { user: null, error: 'Unauthorized' });
  mocks.limiter.mockClear();
});

describe('GET /api/analytics/recorded-history', () => {
  it('requires verified authentication before the limiter or storage reads', async () => {
    const response = await request(app).get('/api/analytics/recorded-history?symbol=AAPL');
    expect(response.status).toBe(401);
    expect(mocks.limiter).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('serves independently available sources to an authenticated user with no-store', async () => {
    const response = await request(app).get('/api/analytics/recorded-history?symbol=aapl').set('Authorization', 'Bearer verified-test-token');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toMatchObject({ symbol: 'AAPL', decisionLog: { status: 'available', rows: [] }, forecastLog: { status: 'unavailable', rows: [] } });
    expect(mocks.limiter).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(response.text).not.toMatch(/private-db-key|verified-user|verified-test-token/);
  });

  it.each(['', '?symbol=AAPL&symbol=MSFT', '?symbol[]=AAPL', '?symbol=AAPL&limit=1000', '?symbol=AAPL&table=alerts', '?symbol=https%3A%2F%2Fexample.com', '?symbol=ABCDEFGHIJKLMNOPQRSTU'])('rejects invalid queries before storage reads: %s', async (query) => {
    const response = await request(app).get(`/api/analytics/recorded-history${query}`).set('Authorization', 'Bearer verified-test-token');
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
