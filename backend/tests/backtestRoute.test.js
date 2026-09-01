import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../utils/marketData.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    fetchYahooHistory: vi.fn(async (symbol) => {
      if (symbol === 'MISSING') return [];
      return Array.from({ length: 50 }, (_, index) => {
        const close = symbol === 'SPY' ? 100 + index : 100;
        return {
          date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
          open: close,
          high: close,
          low: close,
          close,
          volume: 1_000_000,
        };
      });
    }),
  };
});

const app = (await import('../index.js')).default;

describe('POST /api/backtests/run', () => {
  it('returns a true buy-and-hold benchmark rather than an SMA strategy', async () => {
    const res = await request(app).post('/api/backtests/run').send({
      symbol: 'FLAT',
      benchmark: 'SPY',
      strategy: 'sma',
      initialCapital: 10_000,
    });

    expect(res.status).toBe(200);
    // A monotonically rising series never crosses upward through its SMA, so
    // the previous SMA-strategy benchmark returned 0%. Buy-and-hold captures it.
    expect(res.body.benchmark.metrics.totalReturn).toBeGreaterThan(40);
    expect(res.body.benchmark.trades).toHaveLength(1);
    expect(res.body.benchmark.trades[0].type).toBe('BUY');
  });

  it('does not report a fake flat benchmark when benchmark data is missing', async () => {
    const res = await request(app).post('/api/backtests/run').send({
      symbol: 'FLAT',
      benchmark: 'MISSING',
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('benchmark MISSING');
  });
});
