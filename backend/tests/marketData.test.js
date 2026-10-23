import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFundamentals, fetchQuote, fetchYahooHistory, fetchYahooProfile } from '../utils/marketData.js';

const chartPayload = {
  chart: {
    result: [{
      timestamp: [1_700_000_000, 1_700_086_400],
      indicators: {
        quote: [{
          open: [99, 101],
          high: [103, 106],
          low: [97, 100],
          close: [100, 102],
          volume: [1_000, 2_000],
        }],
      },
    }],
  },
};

function unauthorizedResponse(description) {
  return new Response(JSON.stringify({
    finance: { result: null, error: { code: 'Unauthorized', description } },
  }), { status: 401, statusText: 'Unauthorized' });
}

function mockUnauthorizedThenChart(description) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(unauthorizedResponse(description))
    .mockResolvedValueOnce(new Response(JSON.stringify(chartPayload), { status: 200 }));
}

describe('market data fallbacks', () => {
  beforeEach(() => {
    vi.stubEnv('MARKET_DATA_PROVIDER', 'yahoo');
    vi.stubEnv('TWELVE_DATA_API_KEY', '');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T12:34:56.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('falls back from the unauthorized Yahoo quote endpoint to Yahoo chart history', async () => {
    const fetchMock = mockUnauthorizedThenChart('User is unable to access this feature');

    await expect(fetchQuote('AAPL')).resolves.toMatchObject({
      symbol: 'AAPL',
      regularMarketPrice: 102,
      regularMarketPreviousClose: 100,
      regularMarketChangePercent: 2,
      averageDailyVolume10Day: 1_500,
      source: 'yahoo',
      asOf: '2023-11-15T22:13:20.000Z',
      currency: null,
      partial: true,
    });
    expect(fetchMock.mock.calls[1][0].toString()).toContain('/v8/finance/chart/AAPL');
  });

  it('returns chart-derived partial fundamentals when quoteSummary is unauthorized', async () => {
    mockUnauthorizedThenChart('Invalid Crumb');

    await expect(fetchFundamentals('AAPL')).resolves.toMatchObject({
      partial: true,
      dataSource: 'yahoo',
      volume: 2_000,
      averageVolume: 1_500,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      observedRangeHigh: 106,
      observedRangeLow: 97,
      quarterlyResults: [],
      currency: null,
    });
  });

  it('only labels observed highs and lows as 52-week metrics when a full year is covered', async () => {
    const payload = structuredClone(chartPayload);
    const now = Date.now() / 1000;
    payload.chart.result[0].timestamp = Array.from({ length: 365 }, (_, index) => now - (364 - index) * 86_400);
    payload.chart.result[0].indicators.quote[0] = {
      close: Array(365).fill(100), high: Array(365).fill(103), low: Array(365).fill(97),
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorizedResponse('Unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)));

    await expect(fetchFundamentals('TEST')).resolves.toMatchObject({ fiftyTwoWeekHigh: 103, fiftyTwoWeekLow: 97, partial: true });
  });

  it('carries known chart currency into partial quotes and fundamentals', async () => {
    const payload = structuredClone(chartPayload);
    payload.chart.result[0].meta = { currency: 'GBP', exchangeTimezoneName: 'Europe/London' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorizedResponse('Invalid Crumb'))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(unauthorizedResponse('Invalid Crumb'))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)));

    await expect(fetchQuote('TEST.L')).resolves.toMatchObject({ currency: 'GBP', exchangeTimezoneName: 'Europe/London' });
    await expect(fetchFundamentals('TEST.L')).resolves.toMatchObject({ currency: 'GBP', dataSource: 'yahoo' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('averages only reported volumes and keeps entirely missing volume unavailable', async () => {
    const payload = structuredClone(chartPayload);
    payload.chart.result[0].indicators.quote[0].volume = [null, '2000'];
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorizedResponse('Unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockResolvedValueOnce(unauthorizedResponse('Unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        chart: { result: [{ ...payload.chart.result[0], indicators: { quote: [{ close: [100, 102] }] } }] },
      })));

    await expect(fetchQuote('AAPL')).resolves.toMatchObject({ averageDailyVolume10Day: 2000 });
    await expect(fetchQuote('AAPL')).resolves.toMatchObject({ averageDailyVolume10Day: null, regularMarketVolume: null });
  });

  it('does not bridge missing closes when calculating a fallback daily change', async () => {
    const payload = structuredClone(chartPayload);
    payload.chart.result[0].timestamp.push(1_700_172_800);
    payload.chart.result[0].indicators.quote[0].close = [100, null, 104];
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorizedResponse('Unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)));

    await expect(fetchQuote('AAPL')).resolves.toMatchObject({
      regularMarketPrice: 104, regularMarketPreviousClose: null, regularMarketChangePercent: null,
    });
  });

  it('normalizes Yahoo data and discards invalid timestamps without discarding valid rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      chart: { result: [{
        timestamp: [null, 'not-a-date', 1e25, 0, 1_700_000_000],
        indicators: { quote: [{ close: [1, 2, 3, '100', '102'], volume: [1, 2, 3, '', null] }] },
      }] },
    })));

    const history = await fetchYahooHistory('AAPL');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ date: '1970-01-01T00:00:00.000Z', close: 100, volume: null });
    expect(history[1]).toMatchObject({ close: 102, volume: null });
  });

  it('tags successful Yahoo quotes with provider time instead of request time', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      quoteResponse: { result: [{ symbol: 'AAPL', regularMarketPrice: 102, regularMarketTime: 1_700_000_000, currency: 'USD' }] },
    })));

    await expect(fetchQuote('AAPL')).resolves.toMatchObject({
      source: 'yahoo', asOf: '2023-11-14T22:13:20.000Z', currency: 'USD', partial: false,
    });
  });

  it('reaches the documented Twelve Data fallback directly after a Yahoo network failure', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network disconnected'))
      .mockResolvedValueOnce(twelveResponse());

    await expect(fetchYahooHistory('AAPL')).resolves.toMatchObject([{ source: 'twelvedata', close: 102, currency: 'USD' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0].hostname).toBe('api.twelvedata.com');
  });

  it('uses Twelve Data first when selected and falls back to Yahoo after failure', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error', message: 'Quota exceeded' })))
      .mockResolvedValueOnce(new Response(JSON.stringify(chartPayload)));

    const history = await fetchYahooHistory('AAPL');
    expect(fetchMock.mock.calls[0][0].hostname).toBe('api.twelvedata.com');
    expect(history).toHaveLength(2);
    expect(history.every((row) => row.source === 'yahoo')).toBe(true);
  });

  it('uses Yahoo when Twelve Data is selected without a configured API key', async () => {
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(chartPayload)));

    await expect(fetchYahooHistory('AAPL')).resolves.toMatchObject([{ source: 'yahoo' }, { source: 'yahoo' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['1mo', '1d', '1day', 32, '2026-02-28'],
    ['1d', '5m', '5min', 289, '2026-03-30T12:34:56'],
    ['5d', '15m', '15min', 481, '2026-03-26T12:34:56'],
    ['5y', '1wk', '1week', 262, '2021-03-31'],
    ['1y', '1mo', '1month', 15, '2025-03-31'],
    ['1y', '5m', '5min', 5000, '2025-03-31T12:34:56'],
    ['ytd', '1d', '1day', 91, '2026-01-01'],
    ['max', '1mo', '1month', 5000, null],
  ])('sizes and bounds %s / %s by its actual interval', async (range, interval, providerInterval, outputsize, startDate) => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    const intraday = ['5m', '15m'].includes(interval);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(twelveResponse({
      values: [{ datetime: intraday ? '2026-03-31 12:30:00' : '2026-03-31', close: '102' }],
    }));

    await fetchYahooHistory('AAPL', range, interval);
    const params = fetchMock.mock.calls[0][0].searchParams;
    expect(params.get('interval')).toBe(providerInterval);
    expect(params.get('outputsize')).toBe(String(outputsize));
    expect(params.get('start_date')).toBe(startDate);
    expect(params.get('timezone')).toBe('UTC');
    expect(params.get('order')).toBe('asc');
  });

  it('does not silently turn an unsupported intraday interval into daily history', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(unauthorizedResponse('Unavailable'));

    await expect(fetchYahooHistory('AAPL', '1mo', '2m')).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses intraday bars explicitly as UTC and skips malformed rows', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(twelveResponse({
      values: [
        { datetime: '2026-03-31 12:30:00', close: '102', volume: null },
        { datetime: 'invalid', close: '102', volume: '1' },
        { datetime: '2026-02-30 12:30:00', close: '102' },
        { datetime: '2026-03-31 25:30:00', close: '102' },
        { datetime: '2026-03-31 12:25:00', close: '101', volume: '0' },
      ],
    }));

    const history = await fetchYahooHistory('AAPL', '1d', '5m');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ date: '2026-03-31T12:25:00.000Z', volume: 0, datePrecision: 'timestamp' });
    expect(history[1]).toMatchObject({ date: '2026-03-31T12:30:00.000Z', volume: null, datePrecision: 'timestamp' });
  });

  it('marks daily values as exchange session dates and preserves unknown volume and currency', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(twelveResponse({
      meta: { exchange_timezone: 'Asia/Tokyo' },
      values: [{ datetime: '2026-03-31', open: '', high: 'NaN', low: false, close: '102' }],
    }));

    await expect(fetchYahooHistory('TEST')).resolves.toMatchObject([{
      date: '2026-03-31T00:00:00.000Z', datePrecision: 'date', exchangeTimezone: 'Asia/Tokyo',
      currency: null, volume: null, open: null, high: null, low: null,
    }]);
  });

  it('discloses capped history instead of claiming full requested coverage', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(twelveResponse({
      values: Array.from({ length: 5000 }, () => ({ datetime: '2026-03-31 12:30:00', close: '102' })),
    }));

    const history = await fetchYahooHistory('AAPL', '1y', '5m');
    expect(history[0].historyMayBeTruncated).toBe(true);
  });

  it('uses native Twelve Data quotes with ten-period volume and actual quote time', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      symbol: 'TEST', currency: 'CAD', close: '102', volume: null, average_volume: '1500',
      previous_close: '100', percent_change: '2', timestamp: 1_700_000_000, last_quote_at: 1_700_086_400,
    })));

    await expect(fetchQuote('TEST')).resolves.toMatchObject({
      source: 'twelvedata', regularMarketPrice: 102, regularMarketChangePercent: 2,
      averageDailyVolume10Day: 1500, regularMarketVolume: null, currency: 'CAD',
      asOf: '2023-11-15T22:13:20.000Z', partial: false,
    });
    expect(fetchMock.mock.calls[0][0].searchParams.get('volume_time_period')).toBe('10');
  });

  it('does not treat a candle opening timestamp as fresh quote time', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ close: '102', timestamp: 1_700_000_000 })));

    await expect(fetchQuote('TEST')).resolves.toMatchObject({ asOf: null, currency: null });
  });

  it('falls back to Yahoo quotes after Twelve Data fails without mixing quote fields', async () => {
    vi.stubEnv('TWELVE_DATA_API_KEY', 'test-key');
    vi.stubEnv('MARKET_DATA_PROVIDER', 'twelvedata');
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ quoteResponse: { result: [{ regularMarketPrice: 102, currency: 'USD' }] } })));

    await expect(fetchQuote('TEST')).resolves.toMatchObject({ source: 'yahoo', regularMarketPrice: 102, currency: 'USD' });
  });

  it.each(['http', 'network', 'json'])('does not leak API keys through %s provider errors', async (failure) => {
    const secret = 'test-secret-must-not-leak';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    if (failure === 'http') {
      fetchMock.mockResolvedValueOnce(new Response(`URL includes apikey=${secret}`, { status: 401, statusText: secret }));
    } else if (failure === 'network') {
      fetchMock.mockRejectedValueOnce(new Error(`Failed https://provider.invalid/?apikey=${secret}`));
    } else {
      fetchMock.mockResolvedValueOnce(new Response(`invalid json ${secret}`));
    }

    const result = fetchYahooProfile('TEST');
    await expect(result).rejects.toThrow(/^Market data /);
    await expect(result).rejects.not.toThrow(secret);
  });
});

function twelveResponse(overrides = {}) {
  return new Response(JSON.stringify({
    status: 'ok',
    meta: { currency: 'USD', exchange_timezone: 'America/New_York' },
    values: [{ datetime: '2026-03-31', open: '100', high: '103', low: '99', close: '102', volume: '2000' }],
    ...overrides,
  }));
}
