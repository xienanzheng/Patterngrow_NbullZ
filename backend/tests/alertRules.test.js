import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { evaluateAlertRule } from '../utils/alertRules.js';
import { filterNewSignalRows } from '../routes/alerts.js';

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

  it('level rules are edge-triggered: no re-fire while the condition holds', () => {
    const alert = { symbol: 'AAPL', rule_type: 'price_above', threshold: 95, last_state: null };
    const first = evaluateAlertRule(alert, ctx());
    expect(first.triggered).toBe(true);
    expect(first.newState).toBe('above');
    // Next run with the stored state: condition still true, but no new event.
    const second = evaluateAlertRule({ ...alert, last_state: 'above' }, ctx());
    expect(second.triggered).toBe(false);
    expect(second.newState).toBe('above');
    // Price drops back, state resets, then a re-entry fires again.
    const reset = evaluateAlertRule({ ...alert, last_state: 'above' }, ctx({ close: 90 }));
    expect(reset.triggered).toBe(false);
    expect(reset.newState).toBe('below');
    expect(evaluateAlertRule({ ...alert, last_state: 'below' }, ctx()).triggered).toBe(true);
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

// Direction-aware dedup — pure logic tests, no DB needed.
describe('filterNewSignalRows — direction-aware dedup', () => {
  const makeHistory = (dates) => dates.map((date) => ({ date, close: 100 }));
  const makeSig = (signal) => ({ signal, numericSignal: signal.startsWith('buy') ? 1 : signal.startsWith('sell') ? -1 : 0 });

  it('a buy signal after a sell is persisted', () => {
    const history = makeHistory(['2025-01-11']);
    const signals = [makeSig('buy_strong')];
    const lastCommitted = { signal_date: '2025-01-10', signal: 'sell_medium', price: 95 };
    const rows = filterNewSignalRows(history, signals, lastCommitted);
    expect(rows).toHaveLength(1);
    expect(rows[0].signal).toBe('buy_strong');
  });

  it('a buy signal after a buy is skipped (same direction)', () => {
    const history = makeHistory(['2025-01-11']);
    const signals = [makeSig('buy_weak')];
    const lastCommitted = { signal_date: '2025-01-10', signal: 'buy_medium', price: 95 };
    const rows = filterNewSignalRows(history, signals, lastCommitted);
    expect(rows).toHaveLength(0);
  });

  it('a sell signal after a buy is persisted', () => {
    const history = makeHistory(['2025-01-11']);
    const signals = [makeSig('sell_strong')];
    const lastCommitted = { signal_date: '2025-01-10', signal: 'buy_strong', price: 95 };
    const rows = filterNewSignalRows(history, signals, lastCommitted);
    expect(rows).toHaveLength(1);
    expect(rows[0].signal).toBe('sell_strong');
  });

  it('a sell signal when no prior position (lastCommitted=null) is skipped', () => {
    const history = makeHistory(['2025-01-11']);
    const signals = [makeSig('sell_weak')];
    const rows = filterNewSignalRows(history, signals, null);
    expect(rows).toHaveLength(0);
  });

  it('a sell signal after a sell is skipped (same direction + no open position)', () => {
    const history = makeHistory(['2025-01-11']);
    const signals = [makeSig('sell_medium')];
    const lastCommitted = { signal_date: '2025-01-10', signal: 'sell_strong', price: 95 };
    const rows = filterNewSignalRows(history, signals, lastCommitted);
    expect(rows).toHaveLength(0);
  });
});
