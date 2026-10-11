import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFundamentals, fetchQuote } from '../utils/marketData.js';

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
  afterEach(() => vi.restoreAllMocks());

  it('falls back from the unauthorized Yahoo quote endpoint to Yahoo chart history', async () => {
    const fetchMock = mockUnauthorizedThenChart('User is unable to access this feature');

    await expect(fetchQuote('AAPL')).resolves.toMatchObject({
      symbol: 'AAPL',
      regularMarketPrice: 102,
      regularMarketPreviousClose: 100,
      regularMarketChangePercent: 2,
      averageDailyVolume10Day: 1_500,
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
      fiftyTwoWeekHigh: 106,
      fiftyTwoWeekLow: 97,
      quarterlyResults: [],
    });
  });
});
