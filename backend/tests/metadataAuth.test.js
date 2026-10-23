import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

const endpoints = [
  ['/api/analytics/metadata/manual', { rows: [{ symbol: 'AAPL', sector: 'Technology' }] }],
  ['/api/analytics/metadata/csv', { csv: 'symbol,sector\nAAPL,Technology' }],
];

const originalAdminIds = process.env.METADATA_ADMIN_USER_IDS;

function authenticate(user) {
  return vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({ data: { user }, error: null });
}

describe('shared metadata write authorization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.METADATA_ADMIN_USER_IDS;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAdminIds == null) delete process.env.METADATA_ADMIN_USER_IDS;
    else process.env.METADATA_ADMIN_USER_IDS = originalAdminIds;
  });

  it.each(endpoints)('rejects unauthenticated writes to %s', async (path, body) => {
    const from = vi.spyOn(supabaseAdmin, 'from');
    const response = await request(app).post(path).send(body);
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(endpoints)('defaults to denying ordinary users at %s', async (path, body) => {
    authenticate({ id: 'ordinary-user' });
    const from = vi.spyOn(supabaseAdmin, 'from');
    const response = await request(app).post(path).set('Authorization', 'Bearer valid-token').send(body);
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(endpoints)('does not trust user-editable metadata at %s', async (path, body) => {
    authenticate({ id: 'ordinary-user', user_metadata: { role: 'admin' }, app_metadata: { role: 'member' } });
    process.env.METADATA_ADMIN_USER_IDS = 'another-user';
    const from = vi.spyOn(supabaseAdmin, 'from');
    const response = await request(app).post(path).set('Authorization', 'Bearer valid-token').send(body);
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(endpoints)('allows a verified server-managed admin role at %s', async (path, body) => {
    authenticate({ id: 'admin-user', app_metadata: { role: 'admin' } });
    const select = vi.fn().mockResolvedValue({ data: [{ symbol: 'AAPL' }], error: null });
    const upsert = vi.fn().mockReturnValue({ select });
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue({ upsert });
    const response = await request(app).post(path).set('Authorization', 'Bearer valid-token').send(body);
    expect(response.status).toBe(201);
    expect(upsert).toHaveBeenCalledOnce();
    expect(response.body.insertedCount).toBe(1);
  });

  it.each(endpoints)('allows a user explicitly named in the server allowlist at %s', async (path, body) => {
    authenticate({ id: 'allowed-user' });
    process.env.METADATA_ADMIN_USER_IDS = ' first-user, allowed-user , last-user ';
    const select = vi.fn().mockResolvedValue({ data: [{ symbol: 'AAPL' }], error: null });
    const upsert = vi.fn().mockReturnValue({ select });
    vi.spyOn(supabaseAdmin, 'from').mockReturnValue({ upsert });
    const response = await request(app).post(path).set('Authorization', 'Bearer valid-token').send(body);
    expect(response.status).toBe(201);
    expect(upsert).toHaveBeenCalledOnce();
  });
});
