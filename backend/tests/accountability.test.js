import { describe, expect, it } from 'vitest';
import { gradeSnapshots } from '../utils/accountability.js';
import { addTradingDays } from '../utils/tradingDays.js';

describe('addTradingDays', () => {
  it('adds weekdays across weekends and month boundaries', () => {
    expect(addTradingDays('2026-01-30', 5)).toBe('2026-02-06');
  });

  it('does not count a weekend toward the horizon', () => {
    expect(addTradingDays('2026-01-31', 1)).toBe('2026-02-02');
  });
});

describe('gradeSnapshots', () => {
  const closes = {
    '2026-01-01': 100,
    '2026-01-12': 108,
    '2026-01-19': 92,
  };

  it('grades in-band and direction hits once the horizon is reached', () => {
    const { rows, summary } = gradeSnapshots([
      // Five trading days after Jan 5 is Jan 12: in band and direction hit.
      { snapshot_date: '2026-01-05', horizon: 5, last_close: 101, base: 110, lower: 100, upper: 120, forecast_model: 'drift' },
      // Five trading days after Jan 12 is Jan 19: out of band and direction miss.
      { snapshot_date: '2026-01-12', horizon: 5, last_close: 100, base: 105, lower: 100, upper: 110, forecast_model: 'holt' },
    ], closes);

    expect(rows).toHaveLength(2);
    expect(rows[0].targetDate).toBe('2026-01-12');
    expect(rows[1].targetDate).toBe('2026-01-19');
    expect(rows[0].inBand).toBe(true);
    expect(rows[0].directionHit).toBe(true);
    expect(rows[1].inBand).toBe(false);
    expect(rows[1].directionHit).toBe(false);
    expect(summary.graded).toBe(2);
    expect(summary.bandHitRate).toBeCloseTo(0.5, 6);
    expect(summary.directionHitRate).toBeCloseTo(0.5, 6);
  });

  it('skips snapshots whose target predates the fetched history window', () => {
    // Without this guard the first bar of the window would "match" and the
    // forecast would be graded against a far-later close.
    const { rows } = gradeSnapshots([
      { snapshot_date: '2025-06-01', horizon: 5, last_close: 100, base: 110, lower: 90, upper: 120, forecast_model: 'drift' },
    ], closes);
    expect(rows).toHaveLength(0);
  });

  it('skips snapshots whose horizon has not been reached', () => {
    const { rows } = gradeSnapshots([
      { snapshot_date: '2026-01-19', horizon: 30, last_close: 100, base: 110, lower: 90, upper: 120, forecast_model: 'drift' },
    ], closes);
    expect(rows).toHaveLength(0);
  });
});
