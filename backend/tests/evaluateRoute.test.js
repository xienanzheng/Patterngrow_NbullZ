import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../utils/marketData.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    fetchYahooHistory: vi.fn(async () => Array.from({ length: 250 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      close: 100 * Math.exp(0.001 * i) * (1 + 0.01 * Math.sin(i / 5)),
      high: 101,
      low: 99,
      open: 100,
      volume: 1_000_000,
      source: 'yahoo',
    }))),
  };
});

const app = (await import('../index.js')).default;

describe('GET /api/analytics/evaluate', () => {
  it('400 without symbol', async () => {
    const res = await request(app).get('/api/analytics/evaluate');
    expect(res.status).toBe(400);
  });

  it('returns forecast table, baseline, strategy and directional block', async () => {
    const res = await request(app).get('/api/analytics/evaluate?symbol=TEST&horizon=10&folds=3');
    expect(res.status).toBe(200);
    expect(res.body.forecasts.map((f) => f.model).sort()).toEqual(['ar', 'drift', 'holt']);
    expect(res.body.baseline.model).toBe('naive');
    expect(res.body.strategy.indicator).toBe('sma');
    expect(res.body.forecasts[0].mae).toBeTypeOf('number');
  });
});
