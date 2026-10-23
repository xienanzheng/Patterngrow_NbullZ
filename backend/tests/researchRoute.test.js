import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../utils/marketData.js', async (importOriginal) => ({
  ...await importOriginal(),
  fetchYahooHistory: vi.fn(),
}));
vi.mock('../utils/rateLimits.js', () => {
  const pass = (_req, _res, next) => next();
  return { publicLimiter: pass, chatLimiter: pass, evaluateLimiter: pass };
});

const { fetchYahooHistory } = await import('../utils/marketData.js');
const analyticsRouter = (await import('../routes/analytics.js')).default;
const app = express();
app.use('/api/analytics', analyticsRouter);

function history() {
  return Array.from({ length: 25 }, (_, index) => ({
    date: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index,
    volume: 1000, source: 'twelvedata', currency: 'GBP', datePrecision: 'date',
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchYahooHistory.mockReset().mockResolvedValue(history());
  vi.stubEnv('MARKET_DATA_PROVIDER', 'yahoo');
  vi.stubEnv('TWELVE_DATA_API_KEY', '');
  vi.stubEnv('POLYGON_API_KEY', '');
  vi.stubEnv('ALPHA_VANTAGE_KEY', '');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request in route test'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /api/analytics/research', () => {
  it('serves real normalized analytics without authentication or upstream secrets', async () => {
    const rows = history();
    rows[0].providerSecret = 'must-not-be-serialized';
    fetchYahooHistory.mockResolvedValueOnce(rows);
    const response = await request(app).get('/api/analytics/research').query({ symbol: ' routeok ', range: '1mo', interval: '1d' });

    expect(response.status).toBe(200);
    expect(fetchYahooHistory).toHaveBeenCalledWith('ROUTEOK', '1mo', '1d');
    expect(response.body).toMatchObject({
      symbol: 'ROUTEOK', range: '1mo', interval: '1d',
      research: { metadata: { currency: 'GBP' }, quality: { source: 'twelvedata', barCount: 25 }, volume: { latest: 1000, relative20: 1 } },
    });
    expect(response.body.history).toEqual(response.body.research.series);
    expect(response.text).not.toContain('must-not-be-serialized');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '?symbol=AAPL&symbol=MSFT',
    '?symbol=AAPL&range=1y&range=1mo',
    '?symbol=AAPL&interval=1d&interval=1h',
    '?symbol=AAPL&range=unknown',
    '?symbol=AAPL&interval=2m',
    '?symbol=AAPL&range=1y&interval=5m',
    '?symbol=https%3A%2F%2Fexample.com',
  ])('rejects invalid queries before requesting a provider: %s', async (query) => {
    const response = await request(app).get(`/api/analytics/research${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTypeOf('string');
    expect(fetchYahooHistory).not.toHaveBeenCalled();
  });

  it('returns a safe retryable error when a provider fails, without synthetic history', async () => {
    fetchYahooHistory.mockRejectedValueOnce(new Error('Request https://provider.invalid?apikey=private-route-secret failed'));
    const response = await request(app).get('/api/analytics/research?symbol=ROUTEFAIL');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Historical market data is unavailable. Please try again shortly.' });
    expect(response.text).not.toContain('private-route-secret');
    expect(response.body.history).toBeUndefined();
  });

  it.each([
    ['EMPTYROUTE', []],
    ['SYNTHROUTE', history().map((bar) => ({ ...bar, source: 'synthetic' }))],
    ['BADROUTE', history().map((bar) => ({ ...bar, close: null }))],
  ])('reports unavailable history for %s instead of a successful empty chart', async (symbol, rows) => {
    fetchYahooHistory.mockResolvedValueOnce(rows);
    const response = await request(app).get('/api/analytics/research').query({ symbol });
    expect(response.status).toBe(503);
    expect(response.body.history).toBeUndefined();
  });
});

describe('GET /api/analytics/providers', () => {
  it('returns configuration inventory without probing providers', async () => {
    const response = await request(app).get('/api/analytics/providers');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ mode: 'historical-research', primary: 'yahoo' });
    expect(response.body.providers.find((provider) => provider.id === 'yahoo')).toMatchObject({ configured: true, delay: 'Unverified' });
    expect(response.body.providers.filter((provider) => provider.id !== 'yahoo').every((provider) => provider.configured === false)).toBe(true);
    expect(fetchYahooHistory).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('reports selected and configured providers without returning credentials', async () => {
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    vi.stubEnv('TWELVE_DATA_API_KEY', 'private-twelve-secret');
    vi.stubEnv('POLYGON_API_KEY', 'private-polygon-secret');
    vi.stubEnv('ALPHA_VANTAGE_KEY', 'private-alpha-secret');
    const response = await request(app).get('/api/analytics/providers');
    expect(response.status).toBe(200);
    expect(response.body.primary).toBe('twelvedata');
    expect(response.body.providers.find((provider) => provider.id === 'twelvedata')).toMatchObject({ configured: true, role: 'Primary prices' });
    expect(response.body.providers.find((provider) => provider.id === 'massive')).toMatchObject({ configured: true, role: 'Company reference' });
    expect(response.body.providers.every((provider) => provider.configured)).toBe(true);
    expect(response.text).not.toContain('private-');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
