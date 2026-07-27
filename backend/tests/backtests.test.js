import { describe, it, expect } from 'vitest';
import { runTradingSimulationDetailed } from '../utils/backtesting.js';

// Synthetic history: 10 bars, price rising from 100 to 115.
function makeHistory(prices) {
  return prices.map((close, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: close, high: close, low: close, close, volume: 1000,
  }));
}

describe('runTradingSimulationDetailed — takeProfitPct', () => {
  it('exits with type "target" when price rises above entry by takeProfitPct', () => {
    // Buy on bar 1, price rises 12% by bar 8, takeProfitPct = 10 (fraction 0.10)
    const prices = [100, 100, 102, 105, 108, 110, 112, 115, 115, 115];
    const history = makeHistory(prices);
    const signals = history.map((_, i) => ({
      signal: i === 1 ? 'buy_strong' : 'hold',
      numericSignal: i === 1 ? 1 : 0,
    }));
    const { trades } = runTradingSimulationDetailed(history, signals, 10000, {
      takeProfitPct: 0.10,
    });
    const targetTrade = trades.find((t) => t.type === 'target');
    expect(targetTrade).toBeDefined();
    expect(targetTrade.price).toBeGreaterThan(100 * 1.10);
  });

  it('does not exit if price never reaches takeProfitPct threshold', () => {
    const prices = [100, 100, 102, 103, 104, 105, 106, 107, 108, 109];
    const history = makeHistory(prices);
    const signals = history.map((_, i) => ({
      signal: i === 1 ? 'buy_strong' : 'hold',
      numericSignal: i === 1 ? 1 : 0,
    }));
    const { trades } = runTradingSimulationDetailed(history, signals, 10000, {
      takeProfitPct: 0.20,
    });
    expect(trades.some((t) => t.type === 'target')).toBe(false);
  });

  it('stop-loss still fires even when takeProfitPct is set', () => {
    const prices = [100, 100, 90, 90, 90, 90, 90, 90, 90, 90];
    const history = makeHistory(prices);
    const signals = history.map((_, i) => ({
      signal: i === 1 ? 'buy_strong' : 'hold',
      numericSignal: i === 1 ? 1 : 0,
    }));
    const { trades } = runTradingSimulationDetailed(history, signals, 10000, {
      stopLossPct: 0.05,
      takeProfitPct: 0.20,
    });
    expect(trades.some((t) => t.type === 'stop')).toBe(true);
  });
});
