import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

function authenticatedUser() {
  return vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
}

function lookupResult(data = null, error = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const symbolEq = vi.fn().mockReturnValue({ maybeSingle });
  const userEq = vi.fn().mockReturnValue({ eq: symbolEq });
  return {
    query: { select: vi.fn().mockReturnValue({ eq: userEq }) },
    maybeSingle,
    symbolEq,
    userEq,
  };
}

describe('POST /api/watchlist', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns 409 without inserting when the normalized symbol already exists', async () => {
    authenticatedUser();
    const lookup = lookupResult({ id: 'watchlist-1' });
    const from = vi.spyOn(supabaseAdmin, 'from').mockReturnValue(lookup.query);

    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', 'Bearer fake-token')
      .send({ symbol: ' aapl ' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'AAPL is already on your watchlist.' });
    expect(from).toHaveBeenCalledTimes(1);
    expect(lookup.userEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(lookup.symbolEq).toHaveBeenCalledWith('symbol', 'AAPL');
  });

  it('returns 409 when the unique constraint catches a concurrent insert', async () => {
    authenticatedUser();
    const lookup = lookupResult();
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    vi.spyOn(supabaseAdmin, 'from')
      .mockReturnValueOnce(lookup.query)
      .mockReturnValueOnce({ insert });

    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', 'Bearer fake-token')
      .send({ symbol: 'MSFT' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'MSFT is already on your watchlist.' });
    expect(insert).toHaveBeenCalledWith({ symbol: 'MSFT', user_id: 'user-1' });
  });

  it('creates a normalized symbol when it is not already present', async () => {
    authenticatedUser();
    const lookup = lookupResult();
    const row = { id: 'watchlist-2', symbol: 'BRK.B', inserted_at: '2026-09-01T12:00:00.000Z' };
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    vi.spyOn(supabaseAdmin, 'from')
      .mockReturnValueOnce(lookup.query)
      .mockReturnValueOnce({ insert });

    const res = await request(app)
      .post('/api/watchlist')
      .set('Authorization', 'Bearer fake-token')
      .send({ symbol: 'brk.b' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ row });
    expect(insert).toHaveBeenCalledWith({ symbol: 'BRK.B', user_id: 'user-1' });
  });
});
