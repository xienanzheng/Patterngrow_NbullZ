import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

describe('preferences route', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('serves the frontend contract at GET /api/user/preferences', async () => {
    vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
        }),
      }),
    });

    const res = await request(app)
      .get('/api/user/preferences')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: null });
  });

  it('serves the frontend contract at PUT /api/user/preferences', async () => {
    vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: {
        last_symbol: 'MSFT',
        last_range: '1y',
        selected_indicators: ['sma'],
        forecast_model: 'drift',
        initial_capital: 25_000,
      },
      error: null,
    });
    const upsert = vi.fn().mockReturnValue({
      select: () => ({ single }),
    });
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue({ upsert });

    const res = await request(app)
      .put('/api/user/preferences')
      .set('Authorization', 'Bearer fake-token')
      .send({ lastSymbol: 'msft', forecastModel: 'drift', initialCapital: 25_000 });

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      last_symbol: 'MSFT',
      forecast_model: 'drift',
      initial_capital: 25_000,
    }), { onConflict: 'user_id' });
    expect(res.body.preferences.last_symbol).toBe('MSFT');
  });
});
