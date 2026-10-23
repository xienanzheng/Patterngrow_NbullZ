import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchYahooHistory: vi.fn(), fetchQuote: vi.fn(), fetchNews: vi.fn(), generateMockHistory: vi.fn(),
}));
vi.mock('../utils/marketData.js', () => mocks);

const { computeSignals } = await import('../utils/computeSignals.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request in outage test'));
});
afterEach(() => vi.restoreAllMocks());

describe('analytics when market history is unavailable', () => {
  it('fails safely on a provider outage before building quotes, news or synthetic data', async () => {
    mocks.fetchYahooHistory.mockRejectedValue(new Error('Failed https://provider.invalid?apikey=private-outage-secret'));
    const result = computeSignals('AAPL');
    await expect(result).rejects.toThrow('Market data is unavailable. Please try again later.');
    await expect(result).rejects.not.toThrow('private-outage-secret');
    expect(mocks.fetchQuote).not.toHaveBeenCalled();
    expect(mocks.fetchNews).not.toHaveBeenCalled();
    expect(mocks.generateMockHistory).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', []],
    ['synthetic', [{ date: '2024-01-01', close: 100, source: 'synthetic' }]],
    ['mixed observed and synthetic', [
      { date: '2024-01-01', close: 100, source: 'yahoo' },
      { date: '2024-01-02', close: 101, source: 'synthetic' },
    ]],
  ])('rejects %s history instead of treating it as observed market activity', async (_label, bars) => {
    mocks.fetchYahooHistory.mockResolvedValue(bars);
    await expect(computeSignals('AAPL')).rejects.toThrow('No verified historical data is available');
    expect(mocks.fetchQuote).not.toHaveBeenCalled();
    expect(mocks.fetchNews).not.toHaveBeenCalled();
    expect(mocks.generateMockHistory).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
