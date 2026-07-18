import { describe, expect, it } from 'vitest';
import { buildDataset, directionalForecast, predictProba, trainLogistic } from '../utils/classifier.js';

// Momentum regime series: 20 bars up 1%, then 20 bars down 1%, repeated.
// ret1/ret5 are strongly informative for the 5-day-ahead label.
const mkMomentumHistory = (n) => {
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    const up = Math.floor(i / 20) % 2 === 0;
    price *= up ? 1.01 : 0.99;
    return {
      date: new Date(Date.UTC(2023, 0, 1 + i)).toISOString(),
      close: price,
      high: price * 1.005,
      low: price * 0.995,
      open: price,
      volume: 1_000_000 + (i % 7) * 10_000,
    };
  });
};

describe('buildDataset', () => {
  it('builds finite feature rows with binary labels', () => {
    const { X, y } = buildDataset(mkMomentumHistory(300), 5);
    expect(X.length).toBeGreaterThan(200);
    expect(X.length).toBe(y.length);
    X.forEach((row) => {
      expect(row).toHaveLength(6);
      row.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    });
    y.forEach((label) => expect([0, 1]).toContain(label));
  });
});

describe('trainLogistic + predictProba', () => {
  it('learns a separable pattern', () => {
    const X = Array.from({ length: 200 }, (_, i) => [i < 100 ? -1 : 1, 0, 0, 0, 0, 0]);
    const y = Array.from({ length: 200 }, (_, i) => (i < 100 ? 0 : 1));
    const model = trainLogistic(X, y);
    expect(predictProba(model, [1, 0, 0, 0, 0, 0])).toBeGreaterThan(0.7);
    expect(predictProba(model, [-1, 0, 0, 0, 0, 0])).toBeLessThan(0.3);
  });
});

describe('directionalForecast', () => {
  it('beats coin-flip on a strong momentum series and reports accuracy', () => {
    const out = directionalForecast(mkMomentumHistory(400), { horizon: 5 });
    expect(out).not.toBeNull();
    expect(out.probUp).toBeGreaterThanOrEqual(0);
    expect(out.probUp).toBeLessThanOrEqual(1);
    expect(out.accuracy).toBeGreaterThan(0.55);
  });

  it('returns null on insufficient history', () => {
    expect(directionalForecast(mkMomentumHistory(50), { horizon: 5 })).toBeNull();
  });
});
