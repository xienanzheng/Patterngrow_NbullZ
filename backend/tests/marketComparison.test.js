import { describe, expect, it } from 'vitest';
import { buildMarketComparison, MAX_COMPARISON_BARS } from '../utils/marketComparison.js';

const options = { now: new Date('2026-10-23T12:00:00Z') };
const alternating = (length = 20) => Array.from({ length }, (_, index) => index % 2 ? 0.01 : -0.01);
function bars(returns = alternating(), { initial = 100, currency = 'USD', source = 'yahoo' } = {}) {
  let close = initial;
  return [0, ...returns].map((change, index) => {
    close *= 1 + change;
    return {
      date: new Date(Date.UTC(2024, 0, index + 1)).toISOString(), close,
      datePrecision: 'date', exchangeTimezone: 'America/New_York', currency, source,
    };
  });
}

describe('daily benchmark comparisons', () => {
  it('matches exact base-100, price-return, correlation, beta and tracking-error fixtures', () => {
    const benchmark = bars(alternating(), { initial: 200 });
    const symbol = bars(alternating().map((value) => value * 2));
    const result = buildMarketComparison(symbol, benchmark, options);
    expect(result.sample).toMatchObject({ commonSessions: 21, pairedReturns: 20, longestPairedRun: 20, startDate: '2024-01-01', endDate: '2024-01-21' });
    expect(result.series[0]).toMatchObject({ symbolIndex: 100, benchmarkIndex: 100, relativePerformancePp: 0 });
    const symbolReturn = (0.9996 ** 10 - 1) * 100;
    const benchmarkReturn = (0.9999 ** 10 - 1) * 100;
    expect(result.metrics.symbolReturnPct).toBeCloseTo(symbolReturn, 10);
    expect(result.metrics.benchmarkReturnPct).toBeCloseTo(benchmarkReturn, 10);
    expect(result.metrics.relativePerformancePp).toBeCloseTo(symbolReturn - benchmarkReturn, 10);
    expect(result.metrics.correlation).toBeCloseTo(1, 12);
    expect(result.metrics.beta).toBeCloseTo(2, 12);
    expect(result.metrics.trackingErrorPct).toBeCloseTo(Math.sqrt(20 / 19 * 0.01 ** 2) * Math.sqrt(252) * 100, 10);
    expect(result.series.slice(0, 20).every((row) => row.rollingCorrelation20 === null)).toBe(true);
    expect(result.series.at(-1).rollingCorrelation20).toBeCloseTo(1, 12);
    expect(result.quality.status).toBe('ok');
  });

  it('makes self-comparison deterministic with zero active price change and tracking error', () => {
    const history = bars();
    const result = buildMarketComparison(history, history, options);
    expect(result.metrics).toMatchObject({ relativePerformancePp: 0, beta: 1, trackingErrorPct: 0 });
    expect(result.metrics.correlation).toBeCloseTo(1, 12);
    expect(result.series.every((row) => row.symbolIndex === row.benchmarkIndex)).toBe(true);
  });

  it('reports inverse daily movements with negative correlation and beta', () => {
    const result = buildMarketComparison(bars(alternating().map((value) => -value)), bars(), options);
    expect(result.metrics.correlation).toBeCloseTo(-1, 12);
    expect(result.metrics.beta).toBeCloseTo(-1, 12);
  });

  it('keeps statistical measures unavailable before 20 paired returns', () => {
    const result = buildMarketComparison(bars(alternating(19)), bars(alternating(19)), options);
    expect(result.sample.pairedReturns).toBe(19);
    expect(result.metrics).toMatchObject({ correlation: null, beta: null, trackingErrorPct: null });
    expect(result.metrics.symbolReturnPct).not.toBeNull();
    expect(result.quality.status).toBe('partial');
  });

  it('does not report a zero period return from only one common observation', () => {
    const result = buildMarketComparison(bars([]), bars([]), options);
    expect(result.series[0]).toMatchObject({ symbolIndex: 100, benchmarkIndex: 100 });
    expect(result.metrics).toMatchObject({ symbolReturnPct: null, benchmarkReturnPct: null, relativePerformancePp: null });
    expect(result.sample.startDate).toBe(result.sample.endDate);
  });

  it('handles zero variance without NaN, infinity or a fictitious correlation', () => {
    const result = buildMarketComparison(bars(Array(20).fill(0)), bars(Array(20).fill(0)), options);
    expect(result.metrics).toMatchObject({ correlation: null, beta: null, trackingErrorPct: 0 });
    expect(result.series.at(-1).rollingCorrelation20).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('allows zero beta but undefined correlation for a constant symbol and varying benchmark', () => {
    const result = buildMarketComparison(bars(Array(20).fill(0)), bars(), options);
    expect(result.metrics.beta).toBe(0);
    expect(result.metrics.correlation).toBeNull();
    expect(result.metrics.trackingErrorPct).toBeGreaterThan(0);
  });

  it('treats negligible floating-point variance of constant growth as undefined correlation', () => {
    const result = buildMarketComparison(bars(Array(20).fill(0.01)), bars(Array(20).fill(0.01)), options);
    expect(result.metrics).toMatchObject({ correlation: null, beta: null, trackingErrorPct: 0 });
  });

  it('keeps unmatched dates as chart gaps and never bridges their daily return intervals', () => {
    const symbol = bars();
    symbol.splice(10, 1);
    const result = buildMarketComparison(symbol, bars(), options);
    expect(result.series).toHaveLength(21);
    expect(result.series[10]).toMatchObject({ symbolClose: null, symbolIndex: null, relativePerformancePp: null });
    expect(result.sample).toMatchObject({ commonSessions: 20, pairedReturns: 18 });
    expect(result.metrics.correlation).toBeNull();
    expect(result.quality.benchmark.unmatchedSessions).toBe(1);
  });

  it('breaks paired and rolling return windows at a missing close instead of jumping across it', () => {
    const symbol = bars(alternating(49));
    symbol[21].close = null;
    const result = buildMarketComparison(symbol, bars(alternating(49)), options);
    expect(result.sample.pairedReturns).toBe(47);
    expect(result.series[20].rollingCorrelation20).toBeCloseTo(1, 12);
    expect(result.series[21].rollingCorrelation20).toBeNull();
    expect(result.series[41].rollingCorrelation20).toBeNull();
    expect(result.series[42].rollingCorrelation20).toBeCloseTo(1, 12);
    expect(result.quality.symbol.invalidCloseBars).toBe(1);
  });

  it('does not classify a long missing interval on both sides as a daily return', () => {
    const symbol = bars(alternating(39));
    symbol.splice(10, 8);
    const result = buildMarketComparison(symbol, symbol, options);
    expect(result.sample.pairedReturns).toBe(30);
    expect(result.quality.skippedIntervals).toBe(1);
    expect(result.quality.warnings.join(' ')).toContain('Missing sessions in both inputs cannot always be detected');
  });

  it('does not bridge a timestamped observation whose exchange timezone is unknown', () => {
    const symbol = bars().map((bar) => ({ ...bar, datePrecision: 'timestamp' }));
    delete symbol[10].exchangeTimezone;
    const benchmark = bars().map((bar) => ({ ...bar, datePrecision: 'timestamp' }));
    const result = buildMarketComparison(symbol, benchmark, options);
    expect(result.sample.pairedReturns).toBe(18);
    expect(result.quality.symbol.unknownTimezoneBars).toBe(1);
  });

  it('uses the last duplicate session and interrupts the affected adjacent interval', () => {
    const symbol = bars();
    symbol.splice(10, 0, { ...symbol[10], close: 999 });
    const result = buildMarketComparison(symbol, bars(), options);
    expect(result.series[10].symbolClose).not.toBe(999);
    expect(result.quality.symbol.duplicateSessions).toBe(1);
    expect(result.sample.pairedReturns).toBe(19);
  });

  it('suppresses daily statistics when an invalid date makes adjacency unverifiable', () => {
    const symbol = bars();
    symbol.splice(10, 0, { ...symbol[10], date: '2024-02-30' });
    const result = buildMarketComparison(symbol, bars(), options);
    expect(result.quality.symbol.invalidDates).toBe(1);
    expect(result.sample.pairedReturns).toBe(0);
    expect(result.metrics.correlation).toBeNull();
  });

  it('rejects nonpositive and missing prices rather than coercing them to zero', () => {
    const symbol = bars();
    [null, '', ' ', false, -1, 0, Infinity].forEach((value, index) => { symbol[index + 1].close = value; });
    const result = buildMarketComparison(symbol, bars(), options);
    expect(result.quality.symbol.invalidCloseBars).toBe(7);
    expect(result.series.slice(1, 8).every((row) => row.symbolClose === null)).toBe(true);
  });
});

describe('comparison alignment and provenance', () => {
  it('matches exchange-local session dates across UTC date boundaries', () => {
    const symbol = [
      { date: '2024-01-01T15:15:00Z', close: 100 },
      { date: '2024-01-02T15:15:00Z', close: 110 },
    ].map((bar) => ({ ...bar, datePrecision: 'timestamp', exchangeTimezone: 'Asia/Tokyo', source: 'yahoo', currency: 'JPY' }));
    const benchmark = [
      { date: '2024-01-02T14:30:00Z', close: 200 },
      { date: '2024-01-03T14:30:00Z', close: 210 },
    ].map((bar) => ({ ...bar, datePrecision: 'timestamp', exchangeTimezone: 'America/New_York', source: 'yahoo', currency: 'USD' }));
    const result = buildMarketComparison(symbol, benchmark, options);
    expect(result.sample).toMatchObject({ commonSessions: 2, startDate: '2024-01-02', endDate: '2024-01-03' });
    expect(result.metrics.symbolReturnPct).toBeCloseTo(10);
    expect(result.metrics.benchmarkReturnPct).toBeCloseTo(5);
    expect(result.metadata).toMatchObject({ symbolTimezones: ['Asia/Tokyo'], benchmarkTimezones: ['America/New_York'], currencyMatch: false });
  });

  it('preserves encoded session labels instead of converting midnight into the preceding US date', () => {
    const symbol = bars().map((bar) => ({ ...bar, exchangeTimezone: 'America/Los_Angeles' }));
    const benchmark = bars().map((bar) => ({ ...bar, date: bar.date.slice(0, 10), exchangeTimezone: undefined }));
    const result = buildMarketComparison(symbol, benchmark, options);
    expect(result.sample.commonSessions).toBe(21);
    expect(result.sample.startDate).toBe('2024-01-01');
    expect(result.quality.benchmark.unverifiedSessionDates).toBe(21);
  });

  it('does not substitute UTC session dates for timestamped bars with unknown or invalid zones', () => {
    const symbol = bars().map((bar) => ({ ...bar, datePrecision: 'timestamp', exchangeTimezone: 'secret-invalid-zone' }));
    const result = buildMarketComparison(symbol, bars(), options);
    expect(result.sample.commonSessions).toBe(0);
    expect(result.quality.status).toBe('unavailable');
    expect(result.quality.symbol).toMatchObject({ unknownTimezoneBars: 21, invalidTimezoneBars: 21 });
    expect(JSON.stringify(result)).not.toContain('secret-invalid-zone');
  });

  it('can use a verified instrument timezone supplied in options for timestamped input', () => {
    const symbol = bars().map((bar) => ({ ...bar, datePrecision: 'timestamp', date: bar.date.replace('00:00:00', '14:30:00'), exchangeTimezone: undefined }));
    const result = buildMarketComparison(symbol, bars(), { ...options, symbolTimezone: 'America/New_York' });
    expect(result.sample.commonSessions).toBe(21);
    expect(result.quality.symbol.unknownTimezoneBars).toBe(0);
  });

  it('excludes genuinely future observations while preserving a current session ahead of UTC', () => {
    const base = { close: 100, datePrecision: 'date', exchangeTimezone: 'Asia/Tokyo', source: 'yahoo', currency: 'JPY' };
    const history = [{ ...base, date: '2024-01-02' }, { ...base, date: '2024-01-03' }];
    const result = buildMarketComparison(history, history, { now: new Date('2024-01-01T23:00:00Z') });
    expect(result.sample.commonSessions).toBe(1);
    expect(result.series[0].date).toBe('2024-01-02');
    expect(result.quality.symbol.futureBars).toBe(1);
  });

  it('discloses different native currencies without silently converting prices', () => {
    const result = buildMarketComparison(bars(), bars(alternating(), { initial: 500, currency: 'CAD' }), options);
    expect(result.metadata).toMatchObject({ symbolCurrency: 'USD', benchmarkCurrency: 'CAD', currencyMatch: false, fxAdjusted: false });
    expect(result.series[0]).toMatchObject({ symbolClose: 100, benchmarkClose: 500, symbolIndex: 100, benchmarkIndex: 100 });
    expect(result.metrics.correlation).toBeCloseTo(1, 12);
    expect(result.quality.warnings.join(' ')).toContain('no FX conversion');
  });

  it('does not equate pounds and pence or infer a missing quote currency', () => {
    const result = buildMarketComparison(bars(alternating(), { currency: 'GBP' }), bars(alternating(), { currency: 'GBp' }), options);
    expect(result.metadata.currencyMatch).toBe(false);
    const unknown = buildMarketComparison(bars(alternating(), { currency: null }), bars(), options);
    expect(unknown.metadata).toMatchObject({ symbolCurrency: null, currencyMatch: null });
  });

  it('suppresses indexed metrics when a quote denomination changes inside one input', () => {
    const symbol = bars();
    symbol[10].currency = 'EUR';
    const result = buildMarketComparison(symbol, bars(), options);
    expect(result.quality.status).toBe('unavailable');
    expect(result.metrics.symbolReturnPct).toBeNull();
    expect(result.metrics.correlation).toBeNull();
    expect(result.series.every((row) => row.symbolIndex === null)).toBe(true);
  });

  it('never treats synthetic prices as an observed comparison', () => {
    const result = buildMarketComparison(bars(alternating(), { source: 'synthetic' }), bars(), options);
    expect(result.quality.status).toBe('unavailable');
    expect(result.metrics.symbolReturnPct).toBeNull();
    expect(result.metrics.correlation).toBeNull();
  });

  it('bounds input and output size and exposes the truncation', () => {
    const long = bars(alternating(600));
    const result = buildMarketComparison(long, long, options);
    expect(result.series).toHaveLength(MAX_COMPARISON_BARS);
    expect(result.sample.symbolBars).toBe(MAX_COMPARISON_BARS);
    expect(result.quality.truncated).toBe(true);
    expect(result.series[0].symbolIndex).toBe(100);
  });

  it('returns safe known fields and diagnostic counts without echoing arbitrary provider strings', () => {
    const symbol = bars().map((bar) => ({ ...bar, apiKey: 'private-key-value', source: 'private-source-secret', currency: 'private-currency-secret' }));
    const result = buildMarketComparison(symbol, bars(), options);
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(result.metadata.symbolSources).toEqual(['unknown']);
    expect(result.metadata.symbolCurrency).toBeNull();
  });
});
