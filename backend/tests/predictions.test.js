import { describe, expect, it } from 'vitest';
import { fitAR, fitHolt, predictFuturePrices, solveLinearSystem } from '../utils/predictions.js';

const seeded = (seed) => {
  let v = seed;
  return () => {
    v = (v * 16807) % 2147483647;
    return (v - 1) / 2147483646;
  };
};

describe('solveLinearSystem', () => {
  it('solves a 2x2 system', () => {
    const x = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBeCloseTo(3, 6);
  });

  it('returns null on a singular matrix', () => {
    expect(solveLinearSystem([[1, 1], [2, 2]], [1, 2])).toBeNull();
  });
});

describe('fitAR', () => {
  it('recovers phi≈0.5 from a synthetic AR(1) series', () => {
    const rand = seeded(42);
    const series = [0];
    for (let i = 1; i < 300; i += 1) {
      series.push(0.5 * series[i - 1] + (rand() - 0.5) * 0.02);
    }
    const fit = fitAR(series, 1);
    expect(fit.coefficients[0]).toBeGreaterThan(0.35);
    expect(fit.coefficients[0]).toBeLessThan(0.65);
  });
});

describe('fitHolt', () => {
  it('extrapolates a linear series', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const { level, trend } = fitHolt(closes);
    expect(level + trend).toBeCloseTo(160, 0);
  });
});

describe('predictFuturePrices', () => {
  const points = Array.from({ length: 120 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    close: 100 * Math.exp(0.001 * i),
  }));

  it.each(['drift', 'ar', 'holt'])('%s returns bands with lower<value<upper', (model) => {
    const out = predictFuturePrices(points, 'sma', model, 20);
    expect(out).toHaveLength(20);
    out.forEach((p) => {
      expect(p.lower).toBeLessThan(p.value);
      expect(p.upper).toBeGreaterThan(p.value);
    });
  });

  it('maps legacy model names', () => {
    expect(predictFuturePrices(points, 'sma', 'arima', 5)).toEqual(
      predictFuturePrices(points, 'sma', 'ar', 5),
    );
    expect(predictFuturePrices(points, 'sma', 'simple', 5)).toEqual(
      predictFuturePrices(points, 'sma', 'drift', 5),
    );
    expect(predictFuturePrices(points, 'sma', 'prophet', 5)).toEqual(
      predictFuturePrices(points, 'sma', 'holt', 5),
    );
  });

  it('returns [] on insufficient data or unknown model', () => {
    expect(predictFuturePrices(points.slice(0, 5), 'sma', 'drift', 10)).toEqual([]);
    expect(predictFuturePrices(points, 'sma', 'lstm', 10)).toEqual([]);
  });
});
