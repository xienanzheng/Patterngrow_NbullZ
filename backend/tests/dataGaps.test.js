import { describe, expect, it } from 'vitest';
import { calculateRSI } from '../utils/indicators.js';
import { computeConvictionScore } from '../utils/computeSignals.js';
import { buildAlertContext, evaluateAlertRule } from '../utils/alertRules.js';

const mk = (closes) => closes.map((c, i) => ({
  date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
  close: c, high: c != null ? c * 1.01 : null, low: c != null ? c * 0.99 : null, open: c, volume: 1_000_000,
}));

// Regression for the Number(null) === 0 coercion: data gaps must not read as
// price-0 crashes that flip RSI, conviction, or alerts.
describe('null-close data gaps', () => {
  const uptrend = Array.from({ length: 80 }, (_, i) => 100 + i);

  it('trailing null closes do not crater RSI', () => {
    const clean = calculateRSI(mk(uptrend));
    const gappy = calculateRSI(mk([...uptrend, null, null, null, null]));
    // The gap carries the last real reading instead of registering a crash.
    expect(gappy.at(-1)).toBeCloseTo(clean.at(-1), 6);
  });

  it('trailing null closes do not flip the conviction label', () => {
    const clean = computeConvictionScore(mk(uptrend));
    const gappy = computeConvictionScore(mk([...uptrend, null, null]));
    expect(gappy.label).toBe(clean.label);
  });

  it('a data gap does not fire a false rsi_oversold alert', () => {
    const context = buildAlertContext(mk([...uptrend, null, null, null, null]));
    const outcome = evaluateAlertRule({ symbol: 'T', rule_type: 'rsi_oversold', last_state: null }, context);
    expect(outcome.triggered).toBe(false);
  });
});
