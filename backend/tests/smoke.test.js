import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../index.js';

describe('api smoke', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
