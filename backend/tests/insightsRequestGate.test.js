import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLatestRequestGate, getInsights, getRecordedHistory } from '../../frontend/src/services/api.js';

const response = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn().mockRejectedValue(new Error('Unexpected network access in test.'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('analytics request cancellation', () => {
  it('forwards the real AbortSignal to fetch without serializing it as an insights query parameter', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(response({ symbol: 'AAPL', range: '1y', interval: '1d' }));
    await getInsights('AAPL', { range: '1y', interval: '1d', weights: '{"sma":0.2}', signal: controller.signal });
    const [path, init] = fetchMock.mock.calls[0];
    const query = new URL(path, 'https://test.invalid').searchParams;
    expect(query.get('symbol')).toBe('AAPL');
    expect(query.get('weights')).toBe('{"sma":0.2}');
    expect(query.has('signal')).toBe(false);
    expect(path).not.toContain('AbortSignal');
    expect(init.signal).toBe(controller.signal);
  });

  it.each(['success', 'failure'])('ignores an old manual %s and its finally after a newer automatic request', async (outcome) => {
    const gate = createLatestRequestGate();
    const writes = [];
    let resolveOld;
    let rejectOld;
    fetchMock.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }));
    fetchMock.mockResolvedValueOnce(response({ symbol: 'MSFT' }));

    const run = (symbol) => {
      const request = gate.start();
      const done = getInsights(symbol, { signal: request.signal })
        .then((data) => { if (request.isCurrent()) writes.push(`display:${data.symbol}`); })
        .catch(() => { if (request.isCurrent()) writes.push(`error:${symbol}`); })
        .finally(() => { if (request.isCurrent()) writes.push(`finished:${symbol}`); });
      return { request, done };
    };

    const oldManual = run('AAPL');
    const newAutomatic = run('MSFT');
    expect(oldManual.request.signal.aborted).toBe(true);
    expect(oldManual.request.isCurrent()).toBe(false);
    await newAutomatic.done;
    if (outcome === 'success') resolveOld(response({ symbol: 'AAPL' }));
    else rejectOld(new Error('Late failure from superseded manual request.'));
    await oldManual.done;
    expect(writes).toEqual(['display:MSFT', 'finished:MSFT']);
  });

  it('makes a manual refresh supersede an in-flight automatic request as well', () => {
    const gate = createLatestRequestGate();
    const automatic = gate.start();
    const manual = gate.start();
    expect(automatic.signal.aborted).toBe(true);
    expect(automatic.isCurrent()).toBe(false);
    expect(manual.isCurrent()).toBe(true);
  });

  it('invalidates success, error and completion paths after cancellation and permits a fresh request', () => {
    const gate = createLatestRequestGate();
    const previous = gate.start();
    gate.cancel();
    gate.cancel();
    expect(previous.signal.aborted).toBe(true);
    expect(previous.isCurrent()).toBe(false);
    const next = gate.start();
    expect(next.signal.aborted).toBe(false);
    expect(next.isCurrent()).toBe(true);
    expect(previous.isCurrent()).toBe(false);
  });

  it('sends archive credentials in the authorization header and supports cancellation', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(response({ symbol: 'AAPL' }));
    await getRecordedHistory('AAPL', { token: 'test-auth-token', signal: controller.signal });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toContain('/api/analytics/recorded-history?symbol=AAPL');
    expect(path).not.toContain('test-auth-token');
    expect(init.headers.Authorization).toBe('Bearer test-auth-token');
    expect(init.signal).toBe(controller.signal);
  });
});
