import { describe, expect, it } from 'vitest';
import { computeConvictionScore, confirmedState } from '../utils/computeSignals.js';
import { DEFAULT_ENSEMBLE_WEIGHTS, normalizeEnsembleWeights } from '../utils/backtesting.js';
import { calculateADX, calculateBollingerBands, calculateMACD, calculateRSI, calculateSMA, calculateStochasticOscillator, ema } from '../utils/indicators.js';

const mk = (closes) => closes.map((c, i) => ({
  date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
  close: c, high: c * 1.01, low: c * 0.99, open: c, volume: 1_000_000,
}));

describe('confirmedState', () => {
  it('needs n consecutive confirmations', () => {
    expect(confirmedState([60, 65, 72], (v) => v >= 70, 2)).toBe(false); // one bar only
    expect(confirmedState([60, 71, 72], (v) => v >= 70, 2)).toBe(true);
    // a null (data gap) inside the tail breaks consecutiveness
    expect(confirmedState([72, null, 71], (v) => v >= 70, 2)).toBe(false);
    expect(confirmedState([75, null, null, 72], (v) => v >= 70, 2)).toBe(false);
  });
});

describe('computeConvictionScore', () => {
  it('is bearish after a sustained selloff', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 200 - i * 1.5);
    const { score, label, votes } = computeConvictionScore(mk(closes));
    expect(score).toBeLessThan(0);
    expect(['Sell', 'Medium Sell', 'Strong Sell', 'Neutral']).toContain(label);
    expect(votes.sma).toBe(-1);
  });

  it('score stays within [-1, 1] and exposes all six votes', () => {
    const { score, votes } = computeConvictionScore(mk(Array.from({ length: 80 }, (_, i) => 100 + i)));
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
    expect(Object.keys(votes).sort()).toEqual(['adx', 'bollinger', 'macd', 'rsi', 'sma', 'stochastic']);
  });

  it('returns neutral with insufficientData on a near-empty history', () => {
    const out = computeConvictionScore(mk([100, 101, 102]));
    expect(out.score).toBe(0);
    expect(out.label).toBe('Neutral');
    expect(out.insufficientData).toBe(true);
  });

  it('gives identical scores and labels for omitted and explicit default weights', () => {
    const history = mk(Array.from({ length: 40 }, (_, i) => 100 + i));
    const omitted = computeConvictionScore(history);
    const explicit = computeConvictionScore(history, { ...DEFAULT_ENSEMBLE_WEIGHTS });
    expect(omitted.votes).toEqual({ sma: 1, rsi: -1, macd: 1, bollinger: 0, stochastic: -1, adx: 1 });
    expect(omitted.score).toBe(0.15);
    expect(omitted.label).toBe('Buy');
    expect(explicit).toEqual(omitted);
    expect(computeConvictionScore(history, {})).toEqual(omitted);
    expect(computeConvictionScore(history, { sma: 0, rsi: 0, macd: 0, bollinger: 0, stochastic: 0, adx: 0 })).toEqual(omitted);
  });

  it.each([
    [1, 'Strong Buy'], [0.6, 'Strong Buy'], [0.599999999, 'Medium Buy'],
    [0.35, 'Medium Buy'], [0.349999999, 'Buy'], [0.3499, 'Buy'],
    [0.15, 'Buy'], [0.149999999, 'Neutral'], [0, 'Neutral'],
    [-0.15, 'Neutral'], [-0.150000001, 'Sell'], [-0.3499, 'Sell'],
    [-0.349999999, 'Sell'], [-0.35, 'Medium Sell'],
    [-0.599999999, 'Medium Sell'], [-0.6, 'Strong Sell'], [-1, 'Strong Sell'],
  ])('classifies the actual weighted score %s as %s without presentation rounding', (target, expectedLabel) => {
    // In this real history SMA contributes +1, RSI -1, and Bollinger 0.
    // Weight those known votes to exercise every actual classification boundary.
    const history = mk(Array.from({ length: 40 }, (_, i) => 100 + i));
    const weights = {
      sma: Math.max(target, 0), rsi: Math.max(-target, 0),
      bollinger: 1 - Math.abs(target), macd: 0, stochastic: 0, adx: 0,
    };
    const result = computeConvictionScore(history, weights);
    expect(result.votes).toMatchObject({ sma: 1, rsi: -1, bollinger: 0 });
    expect(result.score).toBe(target);
    expect(result.label).toBe(expectedLabel);
    expect(result.scorePrecision).toBe(12);
  });

  it('exposes the actual measured basis, weighted contributions, and stateless calculation version', () => {
    const history = mk(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.2));
    const weights = { sma: 0.5 };
    const result = computeConvictionScore(history, weights);
    const rsi = calculateRSI(history);
    const macd = calculateMACD(history);
    const bands = calculateBollingerBands(history);
    const adx = calculateADX(history);
    expect(result).toMatchObject({
      normalizedWeights: normalizeEnsembleWeights(weights),
      calculationVersion: 'ensemble-conviction.v2',
      previousDecisionsUsed: false,
      scorePrecision: 12,
      inputs: { barCount: 80, validCloseCount: 80 },
      measurements: {
        close: history.at(-1).close,
        sma20: calculateSMA(history).at(-1),
        rsi14: rsi.at(-1),
        rsiSmoothed3: ema(rsi, 3).at(-1),
        macd: macd.macd.at(-1),
        macdSignal: macd.signal.at(-1),
        macdDivergence: macd.macd.at(-1) - macd.signal.at(-1),
        bollingerUpper: bands.upper.at(-1),
        bollingerLower: bands.lower.at(-1),
        stochasticK14: calculateStochasticOscillator(history).percentK.at(-1),
        adx14: adx.adx.at(-1), plusDI: adx.plusDI.at(-1), minusDI: adx.minusDI.at(-1),
      },
    });
    expect(result.measurements.rsiSmoothed3).not.toBe(result.measurements.rsi14);
    for (const key of Object.keys(result.votes)) {
      expect(result.contributions[key]).toBe(result.normalizedWeights[key] * result.votes[key]);
    }
    expect(result.rawScore).toBe(Object.values(result.contributions).reduce((sum, contribution) => sum + contribution, 0));
    expect(result.score).toBe(Number(result.rawScore.toFixed(result.scorePrecision)));
    // Another calculation cannot influence this result or reuse its mutable state.
    computeConvictionScore(mk(Array.from({ length: 80 }, (_, i) => 200 - i)));
    expect(computeConvictionScore(history, weights)).toEqual(result);
  });

  it('provides explicit missing measurements and fresh metadata for insufficient data', () => {
    const history = mk([100, null, 102]);
    const result = computeConvictionScore(history, { sma: 1 });
    expect(result.inputs).toEqual({ barCount: 3, validCloseCount: 2 });
    expect(result.insufficientData).toBe(true);
    expect(Object.values(result.measurements).every((value) => value === null)).toBe(true);
    expect(Object.values(result.contributions).every((value) => value === 0)).toBe(true);
    expect(result.previousDecisionsUsed).toBe(false);
    result.votes.sma = 1;
    expect(computeConvictionScore(history).votes.sma).toBe(0);
  });
});
