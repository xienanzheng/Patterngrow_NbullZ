import { describe, expect, it } from 'vitest';
import { addCalendarDays, gradeSnapshots } from '../utils/accountability.js';

describe('addCalendarDays', () => {
  it('adds days across month boundaries', () => {
    expect(addCalendarDays('2026-01-30', 5)).toBe('2026-02-04');
  });
});

describe('gradeSnapshots', () => {
  const closes = {
    '2026-01-01': 100,
    '2026-01-10': 108,
    '2026-01-20': 92,
  };

  it('grades in-band and direction hits once the horizon is reached', () => {
    const { rows, summary } = gradeSnapshots([
      // predicted up to 110 (band 100-120), actual 108 on target → in band, direction hit
      { snapshot_date: '2026-01-05', horizon: 5, last_close: 101, base: 110, lower: 100, upper: 120, forecast_model: 'drift' },
      // predicted up to 105 (band 100-110), actual 92 → out of band, direction miss
      { snapshot_date: '2026-01-12', horizon: 5, last_close: 100, base: 105, lower: 100, upper: 110, forecast_model: 'holt' },
    ], closes);

    expect(rows).toHaveLength(2);
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
