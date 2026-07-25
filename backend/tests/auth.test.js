import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

describe('route protection', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    ['post', '/api/analytics/metadata/manual'],
    ['post', '/api/analytics/metadata/csv'],
    ['post', '/api/analytics/chat'],
  ])('%s %s returns 401 without a bearer token', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it('chat with valid token but no key configured returns 400 (auth passed)', async () => {
    vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const res = await request(app)
      .post('/api/analytics/chat')
      .set('Authorization', 'Bearer fake-token')
      .send({ prompt: 'hello', provider: 'openai' });
    if (prevKey) process.env.OPENAI_API_KEY = prevKey;
    expect(res.status).toBe(400);
  });
});
