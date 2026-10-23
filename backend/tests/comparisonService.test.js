import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getResearchSnapshot } = vi.hoisted(() => ({ getResearchSnapshot: vi.fn() }));
vi.mock('../utils/researchService.js', () => ({ getResearchSnapshot }));
const { getComparisonSnapshot, validateComparisonQuery } = await import('../utils/comparisonService.js');

function snapshot(symbol, overrides = {}) {
  let close = symbol === 'SPY' ? 200 : 100;
  return {
    symbol, fetchedAt: '2026-10-23T12:00:00.000Z',
    history: Array.from({ length: 30 }, (_, index) => {
      close *= index % 2 ? 1.01 : 0.99;
      return {
        date: new Date(Date.UTC(2024, 0, index + 1)).toISOString(), close,
        source: 'yahoo', currency: 'USD', datePrecision: 'date', exchangeTimezone: 'America/New_York',
      };
    }),
    research: { metadata: { currency: 'USD' }, quality: { exchangeTimezone: 'America/New_York' } },
    ...overrides,
  };
}

beforeEach(() => {
  getResearchSnapshot.mockReset().mockImplementation(async ({ symbol }) => snapshot(symbol));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request in comparison test'));
});
afterEach(() => vi.restoreAllMocks());

describe('comparison query validation', () => {
  it('normalizes instrument identifiers and limits the contract to daily ranges', () => {
    expect(validateComparisonQuery({ symbol: ' aapl ' })).toEqual({ symbol: 'AAPL', benchmark: 'SPY', range: '1y', interval: '1d' });
    expect(validateComparisonQuery({ symbol: '^gspc', benchmark: ' msft ', range: '2y', interval: '1d' })).toMatchObject({ symbol: '^GSPC', benchmark: 'MSFT' });
  });

  it.each([
    undefined, null, [], 'AAPL', {},
    { symbol: ['AAPL'] }, { symbol: 'AAPL', benchmark: ['SPY'] },
    { symbol: 'AAPL', range: ['1y'] }, { symbol: 'AAPL', interval: ['1d'] },
    { symbol: 'https://example.com' }, { symbol: 'AAPL', benchmark: '../private' },
    { symbol: 'AAPL', range: '5y' }, { symbol: 'AAPL', range: 'max' },
    { symbol: 'AAPL', interval: '5m' }, { symbol: 'AAPL', interval: '1wk' },
    { symbol: 'AAPL', extra: 'ignored?' }, { symbol: 'AAPL', limit: 10000 },
    { symbol: 'A'.repeat(21) },
  ])('rejects invalid input without requesting either history: %j', async (query) => {
    await expect(getComparisonSnapshot(query)).rejects.toMatchObject({ status: 400, code: 'INVALID_COMPARISON_QUERY' });
    expect(getResearchSnapshot).not.toHaveBeenCalled();
  });
});

describe('comparison snapshot service', () => {
  it('reuses the research snapshot path for both legs and returns only known response fields', async () => {
    const result = await getComparisonSnapshot({ symbol: ' aapl ', benchmark: ' spy ', range: '3mo' });
    expect(getResearchSnapshot.mock.calls.map(([query]) => query)).toEqual([
      { symbol: 'AAPL', range: '3mo', interval: '1d' },
      { symbol: 'SPY', range: '3mo', interval: '1d' },
    ]);
    expect(result).toMatchObject({
      symbol: 'AAPL', benchmark: 'SPY', range: '3mo', interval: '1d',
      fetchedAt: { symbol: '2026-10-23T12:00:00.000Z', benchmark: '2026-10-23T12:00:00.000Z' },
      comparison: { sample: { commonSessions: 30, pairedReturns: 29 }, metadata: { symbolCurrency: 'USD', benchmarkCurrency: 'USD', fxAdjusted: false } },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('requests the shared snapshot only once for a same-symbol comparison', async () => {
    const result = await getComparisonSnapshot({ symbol: 'aapl', benchmark: ' AAPL ' });
    expect(getResearchSnapshot).toHaveBeenCalledTimes(1);
    expect(result.comparison.metrics).toMatchObject({ beta: 1, relativePerformancePp: 0, trackingErrorPct: 0 });
    expect(result.comparison.metrics.correlation).toBeCloseTo(1, 12);
  });

  it.each(['symbol', 'benchmark'])('redacts all upstream errors when the %s history fails', async (leg) => {
    const secretError = Object.assign(new Error('https://provider.invalid?apikey=private-comparison-secret'), {
      status: 400, code: 'INVALID_COMPARISON_QUERY',
    });
    getResearchSnapshot.mockImplementation(async ({ symbol }) => {
      if ((leg === 'symbol' && symbol === 'AAPL') || (leg === 'benchmark' && symbol === 'SPY')) throw secretError;
      return snapshot(symbol);
    });
    const result = getComparisonSnapshot({ symbol: 'AAPL' });
    await expect(result).rejects.toMatchObject({ status: 503, code: 'COMPARISON_DATA_UNAVAILABLE' });
    await expect(result).rejects.not.toThrow('private-comparison-secret');
  });

  it.each([null, { history: [] }, { history: 'not-a-series' }])('handles a missing or malformed snapshot safely: %j', async (missing) => {
    getResearchSnapshot.mockResolvedValueOnce(missing);
    await expect(getComparisonSnapshot({ symbol: 'AAPL' })).rejects.toMatchObject({ status: 503 });
  });

  it.each(['invalidTimestampBars', 'duplicateBars'])('retains discarded upstream %s evidence instead of inventing adjacency', async (field) => {
    getResearchSnapshot.mockImplementation(async ({ symbol }) => snapshot(symbol, {
      research: { metadata: { currency: 'USD' }, quality: { exchangeTimezone: 'America/New_York', [field]: 1 } },
    }));
    const result = await getComparisonSnapshot({ symbol: 'AAPL' });
    expect(result.comparison.sample.commonSessions).toBe(30);
    expect(result.comparison.sample.pairedReturns).toBe(0);
    expect(result.comparison.metrics.correlation).toBeNull();
    expect(result.comparison.metrics.symbolReturnPct).not.toBeNull();
    expect(result.comparison.series.every((row) => row.rollingCorrelation20 === null)).toBe(true);
    expect(result.comparison.quality.upstream.symbol[field]).toBe(1);
    expect(result.comparison.quality.status).toBe('partial');
    expect(result.comparison.quality.warnings.join(' ')).toContain('Upstream normalization');
  });

  it('retains original future, missing and truncation diagnostics without echoing arbitrary metadata', async () => {
    getResearchSnapshot.mockImplementation(async ({ symbol }) => snapshot(symbol, {
      fetchedAt: 'private-fetched-secret',
      research: { metadata: { currency: 'USD', apiKey: 'private-metadata-secret' }, quality: {
        exchangeTimezone: 'America/New_York', futureBars: 2, missingVolumeBars: 3,
        historyMayBeTruncated: true, warnings: ['private-warning-secret'],
      } },
    }));
    const result = await getComparisonSnapshot({ symbol: 'AAPL' });
    expect(result.comparison.quality.upstream.symbol).toMatchObject({ futureBars: 2, missingVolumeBars: 3, historyMayBeTruncated: true });
    expect(result.comparison.quality.truncated).toBe(true);
    expect(result.fetchedAt.symbol).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-');
  });
});
