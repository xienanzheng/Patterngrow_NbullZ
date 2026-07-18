import { describe, expect, it } from 'vitest';
import {
  evaluateForecastModel,
  evaluateNaiveBaseline,
  evaluateStrategy,
  forecastMetrics,
  maxDrawdownPct,
  walkForwardSplits,
} from '../utils/evaluation.js';

const mkHistory = (n, fn) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
  close: fn(i),
  high: fn(i) * 1.01,
  low: fn(i) * 0.99,
  open: fn(i),
  volume: 1_000_000,
}));

describe('walkForwardSplits', () => {
  it('produces chronological non-overlapping test windows with no lookahead', () => {
    const history = mkHistory(120, (i) => 100 + i);
    const splits = walkForwardSplits(history, { folds: 3, horizon: 10, minTrain: 60 });
    expect(splits).toHaveLength(3);
    splits.forEach(({ train, test }) => {
      expect(test).toHaveLength(10);
      // no lookahead: last train row is strictly before first test row
      expect(new Date(train.at(-1).date) < new Date(test[0].date)).toBe(true);
    });
    // non-overlap: consecutive test windows are adjacent
    expect(splits[0].test.at(-1).date < splits[1].test[0].date).toBe(true);
  });

  it('throws when history is too short', () => {
    expect(() => walkForwardSplits(mkHistory(30, (i) => i), { folds: 4, horizon: 10 })).toThrow();
  });
});

describe('forecastMetrics', () => {
  it('computes mae/rmse/directional accuracy', () => {
    const m = forecastMetrics([11, 12], [10, 14], 10);
    expect(m.mae).toBeCloseTo(1.5, 6);
    expect(m.rmse).toBeCloseTo(Math.sqrt((1 + 4) / 2), 6);
    // day1 actual == origin (no direction, skipped); day2 both up → 1/1
    expect(m.directionalAccuracy).toBe(1);
  });
});

describe('evaluateForecastModel', () => {
  it('drift beats flat baseline on a pure exponential trend', () => {
    const history = mkHistory(200, (i) => 100 * Math.exp(0.002 * i));
    const drift = evaluateForecastModel(history, 'drift', { folds: 3, horizon: 10 });
    const naive = evaluateNaiveBaseline(history, { folds: 3, horizon: 10 });
    expect(drift.mae).toBeLessThan(naive.mae);
    expect(drift.directionalAccuracy).toBe(1);
  });
});

describe('evaluateStrategy', () => {
  it('reports strategy vs buy-and-hold on the held-out window', () => {
    const history = mkHistory(200, (i) => 100 + Math.sin(i / 6) * 12);
    const out = evaluateStrategy(history, 'rsi', {});
    expect(out.testBars).toBeGreaterThan(40);
    expect(typeof out.strategyReturn).toBe('number');
    expect(typeof out.buyHoldReturn).toBe('number');
    expect(out.maxDrawdown).toBeLessThanOrEqual(0);
  });
});

describe('maxDrawdownPct', () => {
  it('finds the deepest peak-to-trough drop', () => {
    const dd = maxDrawdownPct([{ value: 100 }, { value: 150 }, { value: 75 }, { value: 120 }]);
    expect(dd).toBeCloseTo(-50, 6);
  });
});
