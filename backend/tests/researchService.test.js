import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchHistory } = vi.hoisted(() => ({ fetchHistory: vi.fn() }));
vi.mock('../utils/marketData.js', () => ({ fetchYahooHistory: fetchHistory }));

let getResearchSnapshot;
let validateResearchQuery;

function history(overrides = {}) {
  return Array.from({ length: 25 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index,
    volume: 1000 + index, source: 'yahoo', currency: 'CAD', datePrecision: 'timestamp',
    ...overrides,
  }));
}

beforeEach(async () => {
  vi.resetModules();
  fetchHistory.mockReset().mockResolvedValue(history());
  vi.stubEnv('MARKET_DATA_PROVIDER', 'yahoo');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
  ({ getResearchSnapshot, validateResearchQuery } = await import('../utils/researchService.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('research query validation', () => {
  it('normalizes one ticker and supplies daily research defaults', () => {
    expect(validateResearchQuery({ symbol: ' aapl ' })).toEqual({ symbol: 'AAPL', range: '1y', interval: '1d' });
    expect(validateResearchQuery({ symbol: '^gspc', range: '5d', interval: '15m' }).symbol).toBe('^GSPC');
  });

  it.each([
    undefined,
    [],
    { symbol: ['AAPL', 'MSFT'] },
    { symbol: { value: 'AAPL' } },
    { symbol: 'AAPL MSFT' },
    { symbol: 'https://example.com' },
    { symbol: 'A'.repeat(21) },
    { symbol: 'AAPL', range: ['1y'] },
    { symbol: 'AAPL', interval: ['1d'] },
    { symbol: 'AAPL', range: 'forever' },
    { symbol: 'AAPL', interval: '1second' },
    { symbol: 'AAPL', range: '1y', interval: '5m' },
    { symbol: 'AAPL', range: 'max', interval: '1h' },
  ])('rejects invalid or unsupported input before provider access: %j', async (query) => {
    await expect(getResearchSnapshot(query)).rejects.toMatchObject({ status: 400 });
    expect(fetchHistory).not.toHaveBeenCalled();
  });
});

describe('research snapshots', () => {
  it('returns normalized observations and consistent currency provenance', async () => {
    const bars = history();
    const replacement = { ...bars.at(-1), close: 125.5, high: 126, volume: null };
    fetchHistory.mockResolvedValueOnce([
      bars[1], bars[0], ...bars.slice(2), replacement,
      { ...bars[0], date: 'not-a-date' },
      { ...bars[0], date: '2027-01-01T00:00:00.000Z' },
    ]);

    const result = await getResearchSnapshot({ symbol: ' aapl ' });
    expect(fetchHistory).toHaveBeenCalledWith('AAPL', '1y', '1d');
    expect(result).toMatchObject({
      symbol: 'AAPL', range: '1y', interval: '1d',
      fetchedAt: '2026-02-01T12:00:00.000Z', cache: { hit: false, ttlSeconds: 60 },
      research: { metadata: { currency: 'CAD' }, quality: {
        status: 'partial', source: 'yahoo', duplicateBars: 1, invalidTimestampBars: 1, futureBars: 1,
      } },
    });
    expect(result.history).toEqual(result.research.series);
    expect(result.history).toHaveLength(25);
    expect(result.history[0].date).toBe(bars[0].date);
    expect(result.history.at(-1)).toMatchObject({ close: 125.5, volume: null });
    expect(result.research.volume.latest).toBeNull();
  });

  it('preserves missing volume and unknown currency instead of inventing zero or USD', async () => {
    fetchHistory.mockResolvedValueOnce(history({ volume: null, currency: null }));

    const result = await getResearchSnapshot({ symbol: 'NOVOL' });
    expect(result.history.every((bar) => bar.volume === null)).toBe(true);
    expect(result.research.volume).toMatchObject({ latest: null, average20: null, relative20: null, dollarVolume: null });
    expect(result.research.metadata.currency).toBeNull();
    expect(result.research.quality.missingVolumeBars).toBe(25);
  });

  it('does not bridge an invalid last close or display inconsistent OHLC bounds', async () => {
    const bars = history();
    bars[bars.length - 1] = { ...bars.at(-1), close: null, high: 1, low: 500 };
    fetchHistory.mockResolvedValueOnce(bars);

    const result = await getResearchSnapshot({ symbol: 'GAP' });
    expect(result.history.at(-1)).toMatchObject({ close: null, high: null, low: null });
    expect(result.research.risk.return1).toBeNull();
    expect(result.research.quality.status).toBe('partial');
  });

  it('reuses a successful response for 60 seconds and refetches at expiry', async () => {
    const first = await getResearchSnapshot({ symbol: 'aapl' });
    vi.advanceTimersByTime(59_999);
    const cached = await getResearchSnapshot({ symbol: ' AAPL ' });
    expect(cached.cache.hit).toBe(true);
    expect(cached.fetchedAt).toBe(first.fetchedAt);
    expect(fetchHistory).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    const refreshed = await getResearchSnapshot({ symbol: 'AAPL' });
    expect(refreshed.cache.hit).toBe(false);
    expect(refreshed.fetchedAt).toBe('2026-02-01T12:01:00.000Z');
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });

  it('separates cache entries by range, interval and configured primary provider', async () => {
    await getResearchSnapshot({ symbol: 'AAPL' });
    await getResearchSnapshot({ symbol: 'AAPL', range: '1mo' });
    await getResearchSnapshot({ symbol: 'AAPL', range: '1mo', interval: '1h' });
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    await getResearchSnapshot({ symbol: 'AAPL' });
    expect(fetchHistory).toHaveBeenCalledTimes(4);
  });

  it('coalesces concurrent requests for the same normalized query', async () => {
    let resolveHistory;
    fetchHistory.mockImplementationOnce(() => new Promise((resolve) => { resolveHistory = resolve; }));
    const first = getResearchSnapshot({ symbol: 'aapl' });
    const second = getResearchSnapshot({ symbol: ' AAPL ' });
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    resolveHistory(history());

    const [a, b] = await Promise.all([first, second]);
    expect(a.history).toEqual(b.history);
    expect(a.fetchedAt).toBe(b.fetchedAt);
    expect((await getResearchSnapshot({ symbol: 'AAPL' })).cache.hit).toBe(true);
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('clears rejected pending requests and permits a fresh retry', async () => {
    let rejectHistory;
    fetchHistory.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectHistory = reject; }));
    const first = getResearchSnapshot({ symbol: 'AAPL' });
    const second = getResearchSnapshot({ symbol: 'AAPL' });
    const outcomes = Promise.allSettled([first, second]);
    rejectHistory(new Error('Upstream unavailable'));
    expect((await outcomes).every((result) => result.status === 'rejected')).toBe(true);

    const retry = await getResearchSnapshot({ symbol: 'AAPL' });
    expect(retry.cache.hit).toBe(false);
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['empty', []],
    ['synthetic', history({ source: 'synthetic' })],
    ['mixed synthetic', [...history(), ...history({ source: 'synthetic' })]],
    ['all prices missing', history({ open: null, high: null, low: null, close: null })],
    ['all dates invalid', history({ date: 'invalid' })],
  ])('rejects %s data and does not keep the failed result in cache', async (_label, bars) => {
    fetchHistory.mockResolvedValueOnce(bars);
    await expect(getResearchSnapshot({ symbol: 'AAPL' })).rejects.toThrow(/unavailable/i);
    await expect(getResearchSnapshot({ symbol: 'AAPL' })).resolves.toMatchObject({ cache: { hit: false } });
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });
});
