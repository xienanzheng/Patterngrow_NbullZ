import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../index.js';

const productionOrigin = 'https://trading.night-zone.com';

function fromProduction(requestBuilder) {
  return requestBuilder
    .set('Origin', productionOrigin)
    .set('Host', 'trading.night-zone.com')
    .set('X-Forwarded-Proto', 'https');
}

describe('CORS', () => {
  it('allows same-origin watchlist POST requests to reach authentication', async () => {
    const res = await fromProduction(request(app).post('/api/watchlist')).send({ symbol: 'AAPL' });

    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(productionOrigin);
  });

  it('allows same-origin watchlist DELETE preflights', async () => {
    const res = await fromProduction(request(app).options('/api/watchlist/watchlist-id'))
      .set('Access-Control-Request-Method', 'DELETE');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(productionOrigin);
  });

  it('rejects foreign origins without reporting an internal server error', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .set('Origin', 'https://example.com')
      .set('Host', 'trading.night-zone.com')
      .set('X-Forwarded-Proto', 'https')
      .send({ symbol: 'AAPL' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Origin https://example.com not allowed by CORS');
  });
});
