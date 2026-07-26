import { describe, expect, it } from 'vitest';
import {
  runTradingSimulation,
  runTradingSimulationDetailed,
  CONVICTION_THRESHOLDS,
  ENSEMBLE_SIGNAL_THRESHOLDS,
  SIGNAL_POSITION_FRACS,
} from '../utils/backtesting.js';

const day = (i, close) => ({ date: `2025-01-${String(i + 1).padStart(2, '0')}`, close });
const buy = { signal: 'buy_strong', numericSignal: 1 };
const sell = { signal: 'sell_strong', numericSignal: -1 };
const hold = { signal: 'hold', numericSignal: 0 };

describe('runTradingSimulationDetailed', () => {
  it('costs and slippage reduce final value vs frictionless run', () => {
    const points = [100, 100, 110, 120, 130].map((c, i) => day(i, c));
    const signals = [hold, buy, hold, hold, sell];
    const friction = runTradingSimulationDetailed(points, signals, 10000, {});
    const free = runTradingSimulationDetailed(points, signals, 10000, {
      transactionCostPct: 0, slippagePct: 0,
    });
    expect(friction.portfolio.at(-1).value).toBeLessThan(free.portfolio.at(-1).value);
    expect(friction.costsPaid).toBeGreaterThan(0);
  });

  it('stop-loss liquidates the position on breach', () => {
    const points = [100, 100, 89, 88, 87].map((c, i) => day(i, c));
    const signals = [hold, buy, hold, hold, hold];
    const { trades } = runTradingSimulationDetailed(points, signals, 10000, { stopLossPct: 0.05 });
    expect(trades.some((t) => t.type === 'stop')).toBe(true);
  });

  it('marks open positions at the last valid price on bad data bars (no phantom drawdown)', () => {
    const points = [100, 100, NaN, 100, 100].map((c, i) => day(i, c));
    const signals = [hold, buy, hold, hold, hold];
    const { portfolio } = runTradingSimulationDetailed(points, signals, 10000, {
      transactionCostPct: 0, slippagePct: 0,
    });
    // Bar 2 has an invalid close; the position must not be valued at zero.
    expect(portfolio[2].value).toBeCloseTo(portfolio[1].value, 6);
  });

  it('winRate inputs are net of fees: a sub-fee gross gain is a losing trade', () => {
    const points = [100, 100, 100.15].map((c, i) => day(i, c));
    const signals = [hold, buy, sell];
    const { trades, portfolio } = runTradingSimulationDetailed(points, signals, 10000, {});
    const exit = trades.find((t) => t.type === 'sell');
    expect(exit.pnlPct).toBeLessThan(0);
    expect(portfolio.at(-1).value).toBeLessThan(10000);
  });

  it('portfolio has one row per input bar and legacy wrapper matches', () => {
    const points = [100, 101, 102].map((c, i) => day(i, c));
    const signals = [hold, hold, hold];
    const detailed = runTradingSimulationDetailed(points, signals, 5000, {});
    expect(detailed.portfolio).toHaveLength(3);
    expect(runTradingSimulation(points, signals, 5000)).toEqual(detailed.portfolio);
  });
});

describe('threshold constants', () => {
  it('CONVICTION_THRESHOLDS has required keys with correct values', () => {
    expect(CONVICTION_THRESHOLDS.STRONG_BUY).toBe(0.60);
    expect(CONVICTION_THRESHOLDS.MEDIUM_BUY).toBe(0.35);
    expect(CONVICTION_THRESHOLDS.BUY).toBe(0.15);
    expect(CONVICTION_THRESHOLDS.NEUTRAL_LOW).toBe(-0.15);
    expect(CONVICTION_THRESHOLDS.SELL).toBe(-0.35);
    expect(CONVICTION_THRESHOLDS.MEDIUM_SELL).toBe(-0.60);
  });

  it('ENSEMBLE_SIGNAL_THRESHOLDS has correct crossover and label thresholds', () => {
    expect(ENSEMBLE_SIGNAL_THRESHOLDS.ENTRY).toBe(0.3);
    expect(ENSEMBLE_SIGNAL_THRESHOLDS.EXIT).toBe(-0.3);
    expect(ENSEMBLE_SIGNAL_THRESHOLDS.STRONG_BUY_SCORE).toBe(0.6);
    expect(ENSEMBLE_SIGNAL_THRESHOLDS.MEDIUM_BUY_SCORE).toBe(0.45);
    expect(ENSEMBLE_SIGNAL_THRESHOLDS.STRONG_SELL_SCORE).toBe(-0.6);
    expect(ENSEMBLE_SIGNAL_THRESHOLDS.MEDIUM_SELL_SCORE).toBe(-0.45);
  });

  it('SIGNAL_POSITION_FRACS: strong=1.0, medium=0.5, weak=0.25', () => {
    expect(SIGNAL_POSITION_FRACS.strong).toBe(1.0);
    expect(SIGNAL_POSITION_FRACS.medium).toBe(0.5);
    expect(SIGNAL_POSITION_FRACS.weak).toBe(0.25);
  });
});
