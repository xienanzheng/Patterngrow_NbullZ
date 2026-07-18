import { describe, expect, it } from 'vitest';
import {
  backtestStrategy,
  computeEnsembleScoreSeries,
  DEFAULT_ENSEMBLE_WEIGHTS,
  normalizeEnsembleWeights,
} from '../utils/backtesting.js';
import { computeConvictionScore } from '../utils/computeSignals.js';

const mk = (closes) => closes.map((c, i) => ({
  date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
  close: c, high: c * 1.01, low: c * 0.99, open: c, volume: 1_000_000,
}));

describe('normalizeEnsembleWeights', () => {
  it('normalizes to sum 1 and drops negatives', () => {
    const w = normalizeEnsembleWeights({ sma: 2, rsi: 2, macd: -5, bollinger: 0, stochastic: 0, adx: 0 });
    expect(w.sma).toBeCloseTo(0.5, 6);
    expect(w.rsi).toBeCloseTo(0.5, 6);
    expect(w.macd).toBe(0);
  });

  it('falls back to defaults on garbage', () => {
    expect(normalizeEnsembleWeights(null)).toEqual(DEFAULT_ENSEMBLE_WEIGHTS);
    expect(normalizeEnsembleWeights({ sma: 'x' })).toEqual(DEFAULT_ENSEMBLE_WEIGHTS);
  });
});

describe('ensemble strategy', () => {
  it('score series stays within [-1, 1] and emits crossing signals', () => {
    // Downtrend then sharp uptrend: the score should cross the +0.3 line somewhere.
    const closes = [
      ...Array.from({ length: 60 }, (_, i) => 200 - i),
      ...Array.from({ length: 60 }, (_, i) => 140 + i * 2),
    ];
    const points = mk(closes);
    const score = computeEnsembleScoreSeries(points);
    score.forEach((s) => {
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    });
    const { signals } = backtestStrategy(points, 'ensemble');
    expect(signals.some((s) => s.numericSignal === 1)).toBe(true);
  });

  it('custom weights change the conviction score', () => {
    // Uptrending series: SMA vote is +1, RSI vote is 0 or -1.
    const points = mk(Array.from({ length: 80 }, (_, i) => 100 + i));
    const smaOnly = computeConvictionScore(points, { sma: 1, rsi: 0, macd: 0, bollinger: 0, stochastic: 0, adx: 0 });
    const defaults = computeConvictionScore(points);
    expect(smaOnly.score).toBe(1);
    expect(smaOnly.score).not.toBe(defaults.score);
  });

  it('latest ensemble score matches computeConvictionScore with same weights', () => {
    const points = mk(Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.2));
    const series = computeEnsembleScoreSeries(points);
    const conviction = computeConvictionScore(points);
    expect(series.at(-1)).toBeCloseTo(conviction.score, 2);
  });
});
