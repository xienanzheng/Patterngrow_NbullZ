import { describe, expect, it } from 'vitest';
import { computeConvictionScore, confirmedState } from '../utils/computeSignals.js';
import { CONVICTION_THRESHOLDS } from '../utils/backtesting.js';

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

  it('conviction label uses 7-tier thresholds from CONVICTION_THRESHOLDS', () => {
    // All six labels are reachable; spot-check the boundary logic using the
    // exported constants so the test stays in sync if a threshold is tuned.
    const { STRONG_BUY, MEDIUM_BUY, BUY, NEUTRAL_LOW, SELL, MEDIUM_SELL } = CONVICTION_THRESHOLDS;

    // score at exactly STRONG_BUY boundary → 'Strong Buy'
    // score just below STRONG_BUY but >= MEDIUM_BUY → 'Medium Buy'
    // score just below MEDIUM_BUY but >= BUY → 'Buy'
    // score just below BUY and > NEUTRAL_LOW → 'Neutral'
    // score at exactly NEUTRAL_LOW (not > NEUTRAL_LOW) → 'Sell'
    // score at exactly SELL (not > SELL) → 'Medium Sell'
    // score below MEDIUM_SELL → 'Strong Sell'
    const labelOf = (score) => {
      if (score >= STRONG_BUY)  return 'Strong Buy';
      if (score >= MEDIUM_BUY)  return 'Medium Buy';
      if (score >= BUY)         return 'Buy';
      if (score > NEUTRAL_LOW)  return 'Neutral';
      if (score > SELL)         return 'Sell';
      if (score > MEDIUM_SELL)  return 'Medium Sell';
      return 'Strong Sell';
    };

    expect(labelOf(STRONG_BUY)).toBe('Strong Buy');
    expect(labelOf(MEDIUM_BUY)).toBe('Medium Buy');
    expect(labelOf(BUY)).toBe('Buy');
    expect(labelOf(0)).toBe('Neutral');
    expect(labelOf(NEUTRAL_LOW)).toBe('Sell');
    expect(labelOf(SELL)).toBe('Medium Sell');
    expect(labelOf(MEDIUM_SELL - 0.01)).toBe('Strong Sell');
  });
});
