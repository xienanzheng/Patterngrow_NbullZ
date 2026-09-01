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

  it('uses trading weekdays for every forecast horizon', () => {
    const fridayPoints = points.map((point) => ({ ...point }));
    fridayPoints.at(-1).date = '2025-05-02T00:00:00.000Z';
    const out = predictFuturePrices(fridayPoints, 'sma', 'drift', 3);

    expect(out.map((point) => point.date)).toEqual([
      '2025-05-05',
      '2025-05-06',
      '2025-05-07',
    ]);
    expect(out.every((point) => ![0, 6].includes(new Date(`${point.date}T00:00:00Z`).getUTCDay()))).toBe(true);
  });

  it('uses true central 68%, 80%, and 95% Monte Carlo quantile bands', () => {
    const out = predictFuturePrices(points, 'sma', 'montecarlo', 5);
    const cloud = out.forecastCloud;

    expect(cloud).not.toBeNull();
    out.forEach((point, index) => {
      expect(point.lower68).toBe(cloud.p16[index]);
      expect(point.upper68).toBe(cloud.p84[index]);
      expect(point.lower).toBe(cloud.p10[index]);
      expect(point.upper).toBe(cloud.p90[index]);
      expect(point.lower95).toBe(cloud.p2_5[index]);
      expect(point.upper95).toBe(cloud.p97_5[index]);
      expect(point.lower95).toBeLessThanOrEqual(point.lower);
      expect(point.lower).toBeLessThanOrEqual(point.lower68);
      expect(point.lower68).toBeLessThanOrEqual(point.value);
      expect(point.value).toBeLessThanOrEqual(point.upper68);
      expect(point.upper68).toBeLessThanOrEqual(point.upper);
      expect(point.upper).toBeLessThanOrEqual(point.upper95);
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
