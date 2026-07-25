import { describe, expect, it } from 'vitest';
import { computeConvictionScore, confirmedState } from '../utils/computeSignals.js';

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
    expect(['Sell', 'Strong Sell', 'Neutral']).toContain(label);
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
});
