import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { researchSnapshot } = vi.hoisted(() => ({ researchSnapshot: vi.fn() }));
vi.mock('../utils/researchService.js', () => ({ getResearchSnapshot: researchSnapshot }));

const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'USO'];
const NOW = new Date('2026-10-23T12:00:00Z');
let getMarketOverview;

function snapshot(overrides = {}) {
  const history = Array.from({ length: 25 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 9, index - 2, 20)).toISOString(), close: 100 + index,
    currency: 'USD', exchangeTimezone: 'America/New_York',
  }));
  return {
    history, fetchedAt: '2026-10-23T11:59:00Z',
    research: {
      metadata: { currency: 'USD' },
      quality: { status: 'ok', source: 'yahoo', asOf: history.at(-1).date, asOfPrecision: 'timestamp', exchangeTimezone: 'America/New_York', warnings: ['Feed delay is unknown.'] },
      risk: { return1: 1.25, return5: -3, return20: 8.75 }, volume: { relative20: 1.2 },
    },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('MARKET_DATA_PROVIDER', 'yahoo');
  researchSnapshot.mockReset().mockImplementation(async () => snapshot());
  ({ getMarketOverview } = await import('../utils/marketOverview.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('fixed daily market overview', () => {
  it('requests only six fixed daily proxies and exposes bounded descriptive summaries', async () => {
    const result = await getMarketOverview({ symbols: ['UNEXPECTED'], range: 'max' });
    expect(researchSnapshot.mock.calls.map(([query]) => query)).toEqual(SYMBOLS.map((symbol) => ({ symbol, range: '3mo', interval: '1d' })));
    expect(result.rows.map((row) => row.symbol)).toEqual(SYMBOLS);
    expect(result).toMatchObject({ interval: '1d', range: '3mo', status: 'ok', generatedAt: NOW.toISOString(), cache: { hit: false, ttlSeconds: 60 } });
    expect(result.rows[0]).toMatchObject({ latestClose: 124, currency: 'USD', return1: 1.25, return5: -3, return20: 8.75, relativeVolume20: 1.2, source: 'yahoo', asOfPrecision: 'timestamp', sessionDate: '2026-10-22' });
    expect(result.rows.every((row) => row.sparkline.length === 20)).toBe(true);
    expect(result.rows[5].description).toContain('not spot oil returns');
    expect(result.coverage).toMatchObject({ available: 6, requested: 6, sameSession: true, sessionDates: [{ date: '2026-10-22', symbols: SYMBOLS }], missingSymbols: [] });
    expect(result.warnings.join(' ')).toContain('not a measure of market breadth');
  });

  it('limits active research requests to three and coalesces simultaneous overview requests', async () => {
    let active = 0;
    let maximum = 0;
    const releases = [];
    researchSnapshot.mockImplementation(() => {
      active += 1;
      maximum = Math.max(maximum, active);
      return new Promise((resolve) => releases.push(() => resolve(snapshot()))).finally(() => { active -= 1; });
    });
    const first = getMarketOverview();
    const second = getMarketOverview();
    expect(researchSnapshot).toHaveBeenCalledTimes(3);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(researchSnapshot).toHaveBeenCalledTimes(6));
    expect(active).toBe(3);
    releases.splice(0).forEach((release) => release());
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(maximum).toBe(3);
    expect(active).toBe(0);
    expect(researchSnapshot).toHaveBeenCalledTimes(6);
  });

  it('caches the summary for exactly 60 seconds and protects it from caller mutations', async () => {
    const first = await getMarketOverview();
    first.rows[0].latestClose = 999;
    first.coverage.sessionDates[0].symbols.push('FAKE');
    vi.setSystemTime(new Date(NOW.getTime() + 59_999));
    const cached = await getMarketOverview();
    expect(cached.cache.hit).toBe(true);
    expect(cached.rows[0].latestClose).toBe(124);
    expect(cached.coverage.sessionDates[0].symbols).toEqual(SYMBOLS);
    expect(researchSnapshot).toHaveBeenCalledTimes(6);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    expect((await getMarketOverview()).cache.hit).toBe(false);
    expect(researchSnapshot).toHaveBeenCalledTimes(12);
  });

  it('keeps one bounded cache entry and refreshes after a configured provider change', async () => {
    await getMarketOverview();
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    await getMarketOverview();
    vi.stubEnv('MARKET_DATA_PROVIDER', 'yahoo');
    await getMarketOverview();
    expect(researchSnapshot).toHaveBeenCalledTimes(18);
  });

  it('isolates failures, preserves unavailable cards and never forwards provider secrets', async () => {
    researchSnapshot.mockImplementation(async ({ symbol }) => {
      if (symbol === 'QQQ') throw new Error('https://provider.invalid?apikey=private-overview-secret');
      return snapshot();
    });
    const result = await getMarketOverview();
    expect(result.status).toBe('partial');
    expect(result.coverage).toMatchObject({ available: 5, missingSymbols: ['QQQ'], sameSession: null });
    expect(result.rows[1]).toMatchObject({ symbol: 'QQQ', status: 'unavailable', latestClose: null, return1: null, source: null, sparkline: [] });
    expect(JSON.stringify(result)).not.toContain('private-overview-secret');
    expect(result.rows).toHaveLength(6);
  });

  it('caches a complete outage to prevent repeated public request amplification', async () => {
    researchSnapshot.mockRejectedValue(new Error('Private upstream failure.'));
    const result = await getMarketOverview();
    expect(result.status).toBe('unavailable');
    expect(result.coverage).toMatchObject({ available: 0, sameSession: null, missingSymbols: SYMBOLS });
    expect((await getMarketOverview()).cache.hit).toBe(true);
    expect(researchSnapshot).toHaveBeenCalledTimes(6);
  });

  it('reports different as-of sessions without implying synchronized cross-sectional coverage', async () => {
    researchSnapshot.mockImplementation(async ({ symbol }) => {
      const result = snapshot();
      if (symbol === 'USO') result.research.quality.asOf = '2026-10-21T20:00:00Z';
      return result;
    });
    const result = await getMarketOverview();
    expect(result.status).toBe('partial');
    expect(result.coverage).toMatchObject({ sameSession: false, latestSessionDate: '2026-10-22', latestSessionCount: 5, sessionDates: [{ date: '2026-10-21', symbols: ['USO'] }, { date: '2026-10-22', symbols: SYMBOLS.slice(0, 5) }] });
    expect(result.warnings.join(' ')).toContain('not synchronized');
  });

  it('does not invent a session date when timestamp timezone is missing or invalid', async () => {
    researchSnapshot.mockImplementation(async ({ symbol }) => {
      const result = snapshot();
      if (symbol === 'SPY' || symbol === 'QQQ') {
        result.research.quality.exchangeTimezone = symbol === 'SPY' ? null : 'Not/A_Timezone';
        result.history.forEach((row) => { row.exchangeTimezone = null; });
      }
      return result;
    });
    const result = await getMarketOverview();
    expect(result.coverage).toMatchObject({ sameSession: null, unverifiedSessionSymbols: ['SPY', 'QQQ'], latestSessionCount: 4 });
    expect(result.rows[0]).toMatchObject({ sessionDate: null, status: 'partial' });
  });

  it('uses exchange-local calendar dates for timestamps and literal labels for date-only observations', async () => {
    researchSnapshot.mockImplementation(async ({ symbol }) => {
      const result = snapshot();
      result.research.quality.asOf = symbol === 'SPY' ? '2026-10-23T00:30:00Z' : '2026-10-22T00:00:00Z';
      result.research.quality.asOfPrecision = symbol === 'SPY' ? 'timestamp' : 'date';
      return result;
    });
    const result = await getMarketOverview();
    expect(result.coverage.sameSession).toBe(true);
    expect(result.rows.every((row) => row.sessionDate === '2026-10-22')).toBe(true);
  });

  it('does not substitute older prices or turn missing measurements into zero', async () => {
    researchSnapshot.mockImplementation(async () => {
      const result = snapshot();
      result.history[result.history.length - 1].close = null;
      result.research.metadata.currency = null;
      result.research.risk.return1 = Infinity;
      result.research.volume.relative20 = null;
      return result;
    });
    const result = await getMarketOverview();
    expect(result.status).toBe('unavailable');
    expect(result.rows[0]).toMatchObject({ latestClose: null, currency: null, return1: null, relativeVolume20: null });
    expect(result.rows[0].sparkline.at(-1).close).toBeNull();
  });
});
