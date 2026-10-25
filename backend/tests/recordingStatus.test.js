import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../utils/accountability.js', () => ({
  fetchSnapshots: vi.fn(), gradeSnapshots: vi.fn(),
  isForecastRecordingConfigured: vi.fn(), logForecastSnapshot: vi.fn(),
}));
vi.mock('../utils/computeSignals.js', () => ({ computeSignals: vi.fn() }));
vi.mock('../utils/metadata.js', () => ({
  getTickerMetadata: vi.fn().mockResolvedValue(null), listFacetOptions: vi.fn(),
  listMetadata: vi.fn(), upsertMetadataRows: vi.fn(),
}));
vi.mock('../utils/rateLimits.js', () => {
  const pass = (_req, _res, next) => next();
  return { publicLimiter: pass, chatLimiter: pass, evaluateLimiter: pass };
});

const { computeSignals } = await import('../utils/computeSignals.js');
const { isForecastRecordingConfigured, logForecastSnapshot } = await import('../utils/accountability.js');
const analyticsRouter = (await import('../routes/analytics.js')).default;
const app = express();
app.use('/api/analytics', analyticsRouter);
const payload = () => ({
  symbol: 'AAPL', latestClose: 100, dataSource: 'yahoo', forecastModel: 'drift',
  forecast: [{ value: 101, lower: 98, upper: 104 }],
  research: { quality: { status: 'ok' } }, conviction: { score: 0, label: 'Neutral' },
});

beforeEach(() => {
  vi.clearAllMocks();
  computeSignals.mockResolvedValue(payload());
  isForecastRecordingConfigured.mockReturnValue(true);
  logForecastSnapshot.mockResolvedValue(true);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => vi.restoreAllMocks());

describe('insights recording visibility', () => {
  it('reports a successful forecast write separately from the daily rating archive', async () => {
    const response = await request(app).get('/api/analytics/insights?symbol=AAPL');
    expect(response.status).toBe(200);
    expect(response.body.recording).toEqual({
      forecast: { status: 'saved', mode: 'replaces_same_day_model' },
      rating: { status: 'not_recorded_by_this_request', mode: 'daily_summary_first_observation' },
    });
    expect(logForecastSnapshot).toHaveBeenCalledOnce();
  });
  it('does not present a best-effort write failure as a saved record', async () => {
    logForecastSnapshot.mockResolvedValue(false);
    const response = await request(app).get('/api/analytics/insights?symbol=AAPL');
    expect(response.status).toBe(200);
    expect(response.body.recording.forecast.status).toBe('failed');
    expect(response.body.latestClose).toBe(100);
  });
  it('makes missing database configuration explicit without attempting a write', async () => {
    isForecastRecordingConfigured.mockReturnValue(false);
    const response = await request(app).get('/api/analytics/insights?symbol=AAPL');
    expect(response.body.recording.forecast.status).toBe('not_configured');
    expect(logForecastSnapshot).not.toHaveBeenCalled();
  });
  it.each([
    ['?symbol=AAPL&range=1mo&interval=1h', {}],
    ['?symbol=AAPL', { dataSource: 'twelvedata' }],
    ['?symbol=AAPL', { research: { quality: { status: 'partial' } } }],
    ['?symbol=AAPL', { forecast: [] }],
    ['?symbol=AAPL', { latestClose: null }],
  ])('reports ineligible observations without claiming a saved snapshot: %s %j', async (query, changes) => {
    computeSignals.mockResolvedValue({ ...payload(), ...changes });
    const response = await request(app).get(`/api/analytics/insights${query}`);
    expect(response.body.recording.forecast.status).toBe('not_eligible');
    expect(logForecastSnapshot).not.toHaveBeenCalled();
  });
});
