import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { evaluateAlertRule } from '../utils/alertRules.js';

const ctx = (overrides = {}) => ({
  close: 100,
  rsiSeries: [50, 50, 50],
  conviction: { score: 0.3, label: 'Buy', votes: {} },
  ...overrides,
});

describe('evaluateAlertRule', () => {
  it('price_above triggers only past the threshold', () => {
    const alert = { symbol: 'AAPL', rule_type: 'price_above', threshold: 95 };
    expect(evaluateAlertRule(alert, ctx()).triggered).toBe(true);
    expect(evaluateAlertRule({ ...alert, threshold: 105 }, ctx()).triggered).toBe(false);
  });

  it('price_below triggers under the threshold', () => {
    const alert = { symbol: 'AAPL', rule_type: 'price_below', threshold: 105 };
    expect(evaluateAlertRule(alert, ctx()).triggered).toBe(true);
  });

  it('rsi rules require the 2-session confirmed state', () => {
    const alert = { symbol: 'AAPL', rule_type: 'rsi_overbought' };
    expect(evaluateAlertRule(alert, ctx({ rsiSeries: [65, 71, 74] })).triggered).toBe(true);
    expect(evaluateAlertRule(alert, ctx({ rsiSeries: [65, 68, 74] })).triggered).toBe(false);
  });

  it('conviction_flip triggers on label change and carries newState', () => {
    const alert = { symbol: 'AAPL', rule_type: 'conviction_flip', last_state: 'Neutral' };
    const outcome = evaluateAlertRule(alert, ctx());
    expect(outcome.triggered).toBe(true);
    expect(outcome.newState).toBe('Buy');
    // first run (no stored state) primes but does not trigger
    const primed = evaluateAlertRule({ ...alert, last_state: null }, ctx());
    expect(primed.triggered).toBe(false);
    expect(primed.newState).toBe('Buy');
  });
});

describe('alerts routes', () => {
  it('CRUD requires auth', async () => {
    expect((await request(app).get('/api/alerts')).status).toBe(401);
    expect((await request(app).post('/api/alerts').send({})).status).toBe(401);
  });

  it('cron run requires CRON_SECRET', async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'testsecret';
    const denied = await request(app).get('/api/alerts/run');
    expect(denied.status).toBe(401);
    const wrong = await request(app).get('/api/alerts/run').set('Authorization', 'Bearer nope');
    expect(wrong.status).toBe(401);
    if (prev) process.env.CRON_SECRET = prev;
    else delete process.env.CRON_SECRET;
  });

  it('cron run rejects when CRON_SECRET is unset', async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const res = await request(app).get('/api/alerts/run').set('Authorization', 'Bearer anything');
    expect(res.status).toBe(401);
    if (prev) process.env.CRON_SECRET = prev;
  });
});
