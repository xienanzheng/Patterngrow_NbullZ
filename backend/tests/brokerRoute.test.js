import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

function authenticate() {
  vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
}

function connectionQuery(result) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          single: async () => result,
        }),
      }),
    }),
  };
}

describe('broker connection persistence errors', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('treats a missing connection as disconnected', async () => {
    authenticate();
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue(connectionQuery({
      data: null,
      error: { code: 'PGRST116', message: 'No rows' },
    }));

    const res = await request(app)
      .get('/api/broker/connect')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('does not hide database failures as a disconnected account', async () => {
    authenticate();
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue(connectionQuery({
      data: null,
      error: { code: 'XX000', message: 'database unavailable' },
    }));

    const res = await request(app)
      .get('/api/broker/connect')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('database unavailable');
  });

  it('does not report disconnect success when credential deletion fails', async () => {
    authenticate();
    const brokerEq = vi.fn().mockResolvedValue({ error: { message: 'delete failed' } });
    const userEq = vi.fn().mockReturnValue({ eq: brokerEq });
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue({
      delete: () => ({ eq: userEq }),
    });

    const res = await request(app)
      .delete('/api/broker/connect')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('delete failed');
  });
});
