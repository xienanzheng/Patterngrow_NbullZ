import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../utils/marketData.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    fetchYahooHistory: vi.fn(async (symbol) => Array.from({ length: 150 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      close: symbol === 'UPUP' ? 100 + i : 200 - i,
      high: 201, low: 99, open: 150,
      volume: 1_000_000,
      source: 'yahoo',
    }))),
  };
});

const app = (await import('../index.js')).default;
const { supabaseAdmin } = await import('../utils/supabaseClient.js');

describe('GET /api/watchlist/scan', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('401 without token', async () => {
    const res = await request(app).get('/api/watchlist/scan');
    expect(res.status).toBe(401);
  });

  it('returns ranked conviction rows for the user watchlist', async () => {
    vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue({
      select: () => ({
        eq: async () => ({ data: [{ symbol: 'UPUP' }, { symbol: 'DOWN' }], error: null }),
      }),
    });
    const res = await request(app)
      .get('/api/watchlist/scan')
      .set('Authorization', 'Bearer fake');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    // Ranked: uptrending symbol scores above downtrending one.
    expect(res.body.rows[0].symbol).toBe('UPUP');
    expect(res.body.rows[0].conviction.score).toBeGreaterThan(res.body.rows[1].conviction.score);
  });
});
