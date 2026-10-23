import { describe, expect, it } from 'vitest';
import { buildMarketResearch } from '../utils/marketResearch.js';

const NOW = new Date('2025-06-01T00:00:00Z');
const options = { now: NOW };
const history = (closes = Array(21).fill(100)) => closes.map((close, index) => ({
  date: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
  open: close, high: close + 1, low: close - 1, close,
  volume: 100, source: 'test-feed', complete: true,
}));

function expectOnlyFiniteNumbers(value) {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === 'object') Object.values(value).forEach(expectOnlyFiniteNumbers);
}

describe('buildMarketResearch', () => {
  it('keeps unavailable measurements null and gives a stable schema for absent input', () => {
    for (const input of [undefined, null, {}, []]) {
      const result = buildMarketResearch(input, options);
      expect(result.volume).toEqual({
        latest: null, average20: null, relative20: null, percentile20: null,
        dollarVolume: null, obvChange20: null, sampleSize: 0,
      });
      expect(Object.values(result.risk)).toEqual(Array(7).fill(null));
      expect(result.quality).toMatchObject({ status: 'unavailable', source: null, sources: [], asOf: null, ageHours: null, barCount: 0 });
      expect(result.metadata.currency).toBeNull();
      expect(result.series).toEqual([]);
    }
  });

  it('compares the latest volume only with the 20 preceding bars and does not mutate input', () => {
    const input = history(Array.from({ length: 22 }, (_, index) => 100 + index));
    input.forEach((bar, index) => { bar.volume = index + 1; });
    input[21].volume = 1_000;
    const original = structuredClone(input);
    const result = buildMarketResearch(input, options);

    expect(result.volume.average20).toBe(11.5); // volumes 2 through 21, excludes 1 and 1,000
    expect(result.volume.relative20).toBeCloseTo(1_000 / 11.5);
    expect(result.volume.percentile20).toBe(100);
    expect(result.volume.sampleSize).toBe(20);
    expect(result.volume.dollarVolume).toBe(121_000);
    expect(result.volume.obvChange20).toBe(1_228); // volumes 3 through 21 plus latest 1,000
    expect(result.quality.status).toBe('ok');
    expect(input).toEqual(original);
  });

  it('uses mid-rank percentile ties and preserves genuine zero volume', () => {
    const tied = buildMarketResearch(history(), options);
    expect(tied.volume.percentile20).toBe(50);
    expect(tied.volume.relative20).toBe(1);
    const zero = buildMarketResearch(history().map((bar) => ({ ...bar, volume: 0 })), options);
    expect(zero.volume).toMatchObject({ latest: 0, average20: 0, relative20: null, percentile20: 50, dollarVolume: 0, obvChange20: 0, sampleSize: 20 });
    expect(zero.quality.missingVolumeBars).toBe(0);
  });

  it('adds up-bar volume, subtracts down-bar volume and ignores flat closes for OBV change', () => {
    const input = history([100, 101, ...Array(19).fill(100)]);
    input[0].volume = null; // the starting observation has no contribution to a change
    input[1].volume = 200;
    input[2].volume = 70;
    const result = buildMarketResearch(input, options);
    expect(result.volume.obvChange20).toBe(130);
    expect(result.volume.average20).toBeNull(); // its comparison window does need starting volume
  });

  it('requires a complete prior 20-volume window without substituting older valid values', () => {
    const input = history(Array(40).fill(100));
    input[30].volume = null;
    const result = buildMarketResearch(input, options);
    expect(result.volume).toMatchObject({ latest: 100, average20: null, relative20: null, percentile20: null, sampleSize: 19, obvChange20: null });
    expect(result.quality.missingVolumeBars).toBe(1);
    expect(result.quality.status).toBe('partial');
  });

  it('rejects missing, negative and non-finite volume instead of coercing it to zero', () => {
    const invalid = [null, undefined, '', ' ', false, [], {}, -1, Infinity, NaN, 'n/a'];
    for (const value of invalid) {
      const input = history();
      input[20].volume = value;
      const result = buildMarketResearch(input, options);
      expect(result.volume.latest).toBeNull();
      expect(result.volume.average20).toBe(100);
      expect(result.volume.relative20).toBeNull();
      expect(result.volume.percentile20).toBeNull();
      expect(result.volume.dollarVolume).toBeNull();
      expect(result.quality.missingVolumeBars).toBe(1);
    }
    expect(buildMarketResearch(history().map((bar) => ({ ...bar, volume: '123' })), options).volume.latest).toBe(123);
  });

  it('computes percentage-point returns and annualized sample volatility from daily log returns', () => {
    const closes = [100];
    for (let index = 0; index < 20; index += 1) closes.push(closes.at(-1) * Math.exp(index % 2 === 0 ? 0.01 : -0.01));
    const result = buildMarketResearch(history(closes), options);
    const expectedVolatility = Math.sqrt(20 * 0.01 ** 2 / 19) * Math.sqrt(252) * 100;
    expect(result.risk.realizedVolatility20).toBeCloseTo(expectedVolatility, 10);
    expect(result.risk.return1).toBeCloseTo((Math.exp(-0.01) - 1) * 100, 10);
    expect(result.risk.return5).toBeCloseTo((Math.exp(-0.01) - 1) * 100, 10);
    expect(result.risk.return20).toBeCloseTo(0, 10);
    expect(result.metadata.volatilityAnnualizationPeriods).toBe(252);
  });

  it('reports the largest close-to-peak drawdown over the supplied sample', () => {
    const result = buildMarketResearch(history([100, 120, 90, 100]), options);
    expect(result.risk.maxDrawdown).toBe(-25);
    expect(result.risk.return1).toBeCloseTo(100 / 90 * 100 - 100);
    expect(result.risk.return5).toBeNull();
    expect(result.risk.return20).toBeNull();
    expect(result.risk.realizedVolatility20).toBeNull();
    expect(result.volume.average20).toBeNull();
    expect(result.volume.sampleSize).toBe(3);
  });

  it('includes overnight price gaps in simple ATR and requires 14 complete true ranges', () => {
    const input = history([100, ...Array(14).fill(130)]).map((bar) => ({ ...bar, high: bar.close + 2, low: bar.close - 2 }));
    const result = buildMarketResearch(input, options);
    expect(result.risk.atr14).toBeCloseTo(6); // (32 + 13 * 4) / 14
    expect(result.risk.atrPercent14).toBeCloseTo(6 / 130 * 100);
    expect(buildMarketResearch(input.slice(1), options).risk.atr14).toBeNull();
    input[5].high = null;
    expect(buildMarketResearch(input, options).risk.atr14).toBeNull();
  });

  it('does not bridge missing closes or use malformed OHLC ranges for ATR', () => {
    const missing = history();
    missing[19].close = null;
    const result = buildMarketResearch(missing, options);
    expect(result.quality.invalidPriceBars).toBe(1);
    expect(result.series[19].close).toBeNull();
    expect(result.risk).toMatchObject({ return1: null, return5: null, return20: null, maxDrawdown: null, realizedVolatility20: null, atr14: null });
    expect(result.volume.obvChange20).toBeNull();

    const malformed = history();
    malformed[20].high = 90; // high must contain close and open
    const malformedResult = buildMarketResearch(malformed, options);
    expect(malformedResult.quality.invalidPriceBars).toBe(1);
    expect(malformedResult.risk.atr14).toBeNull();
    expect(malformedResult.risk.return1).toBe(0); // the close itself is still valid
  });

  it('sorts and deduplicates deterministically while reporting raw feed defects', () => {
    const ordered = history([100, 110]);
    const result = buildMarketResearch([ordered[1], ordered[0], { ...ordered[1], close: 111, high: 112 }], options);
    expect(result.series.map((bar) => bar.close)).toEqual([100, 111]);
    expect(result.risk.return1).toBeCloseTo(11);
    expect(result.quality).toMatchObject({ duplicateBars: 1, outOfOrderBars: 1, barCount: 2, asOf: ordered[1].date, status: 'partial' });
  });

  it('excludes invalid, timezone-ambiguous and future timestamps and reports elapsed clock age', () => {
    const [bar] = history();
    const result = buildMarketResearch([
      bar,
      { ...bar, date: '2025-02-30' },
      { ...bar, date: '2025-05-31T12:00:00' },
      { ...bar, date: '2025-05-31T12:00:00Z' },
      { ...bar, date: '2025-06-02T00:00:00Z' },
      { ...bar, date: null },
    ], options);
    expect(result.quality).toMatchObject({ barCount: 2, invalidTimestampBars: 3, futureBars: 1, ageHours: 12 });
    expect(result.quality.warnings.join(' ')).toContain('not a market-hours freshness assessment');
  });

  it('keeps non-daily volume comparisons bar-based and does not invent annualization', () => {
    for (const interval of ['5m', '1h', '1wk', '1mo']) {
      const result = buildMarketResearch(history(), { ...options, interval });
      expect(result.volume.relative20).toBe(1);
      expect(result.risk.realizedVolatility20).toBeNull();
      expect(result.metadata.volatilityAnnualizationPeriods).toBeNull();
      expect(result.metadata.windowUnit).toBe('bars');
      expect(result.quality.warnings.join(' ')).toContain('not normalized to the same time of day');
    }
  });

  it('discloses capped history and retains its provenance flags in normalized series', () => {
    const input = history().map((bar) => ({ ...bar, historyMayBeTruncated: true, datePrecision: 'timestamp' }));
    const result = buildMarketResearch(input, options);
    expect(result.quality).toMatchObject({ historyMayBeTruncated: true, status: 'partial', asOfPrecision: 'timestamp' });
    expect(result.quality.warnings.join(' ')).toContain('may not cover the full requested range');
    expect(result.series[20]).toMatchObject({ historyMayBeTruncated: true, datePrecision: 'timestamp' });
  });

  it('treats session dates as labels without deriving false clock age from midnight UTC', () => {
    for (const datePrecision of ['date', 'session-date']) {
      const result = buildMarketResearch(history().map((bar) => ({ ...bar, datePrecision })), options);
      expect(result.quality.ageHours).toBeNull();
      expect(result.quality.asOfPrecision).toBe(datePrecision);
      expect(result.series[20].datePrecision).toBe(datePrecision);
      expect(result.quality.warnings.join(' ')).toContain('exchange-session labels');
    }
    const [bar] = history();
    const inferred = buildMarketResearch([{ ...bar, date: '2025-01-01' }], options);
    expect(inferred.quality.asOfPrecision).toBe('date');
    expect(inferred.quality.ageHours).toBeNull();
    // A session in a timezone ahead of UTC can have tomorrow's date label today.
    const nextSession = buildMarketResearch([{ ...bar, date: '2025-06-02T00:00:00Z', datePrecision: 'date' }], { now: new Date('2025-06-01T23:00:00Z') });
    expect(nextSession.quality).toMatchObject({ barCount: 1, futureBars: 0, ageHours: null });
  });

  it('retains Tokyo current-session labels ahead of UTC and rejects sessions after the actual local date', () => {
    const [bar] = history();
    const tokyoBar = { ...bar, date: '2025-06-02T00:00:00Z', datePrecision: 'date', exchangeTimezone: 'Asia/Tokyo', currency: 'JPY' };
    const result = buildMarketResearch([
      tokyoBar,
      { ...tokyoBar, date: '2025-06-03T00:00:00Z' },
    ], { now: new Date('2025-06-01T23:00:00Z') });
    expect(result.quality).toMatchObject({
      barCount: 1, futureBars: 1, futureSessionBars: 1, ageHours: null,
      exchangeTimezone: 'Asia/Tokyo', sessionDateCheck: 'exchange-local-date',
      unverifiedSessionDateBars: 0, invalidExchangeTimezoneBars: 0,
    });
    expect(result.series[0]).toMatchObject({ date: '2025-06-02T00:00:00.000Z', exchangeTimezone: 'Asia/Tokyo', currency: 'JPY' });
    const beforeLocalDate = buildMarketResearch([tokyoBar], { now: new Date('2025-06-01T14:59:59Z') });
    expect(beforeLocalDate.quality).toMatchObject({ barCount: 0, futureBars: 1, futureSessionBars: 1 });
    const atLocalMidnight = buildMarketResearch([tokyoBar], { now: new Date('2025-06-01T15:00:00Z') });
    expect(atLocalMidnight.quality).toMatchObject({ barCount: 1, futureBars: 0 });
  });

  it('does not admit tomorrow in an exchange behind UTC merely because UTC has crossed midnight', () => {
    const [bar] = history();
    const result = buildMarketResearch([
      { ...bar, date: '2025-06-01T00:00:00Z', datePrecision: 'date', exchangeTimezone: 'America/New_York' },
      { ...bar, date: '2025-06-02T00:00:00Z', datePrecision: 'date', exchangeTimezone: 'America/New_York' },
    ], { now: new Date('2025-06-02T00:30:00Z') });
    expect(result.quality).toMatchObject({ barCount: 1, futureBars: 1, futureSessionBars: 1, asOf: '2025-06-01T00:00:00.000Z' });
  });

  it('discloses unknown or invalid exchange zones and excludes definitely future session dates', () => {
    const [bar] = history();
    for (const exchangeTimezone of [null, 'Invalid/Timezone']) {
      const result = buildMarketResearch([
        { ...bar, date: '2025-06-02T00:00:00Z', datePrecision: 'date', exchangeTimezone },
        { ...bar, date: '2025-06-03T00:00:00Z', datePrecision: 'date', exchangeTimezone },
      ], { now: new Date('2025-06-01T23:00:00Z') });
      expect(result.quality).toMatchObject({
        barCount: 1, futureBars: 1, futureSessionBars: 1, ageHours: null, status: 'partial',
        unverifiedSessionDateBars: 2, invalidExchangeTimezoneBars: exchangeTimezone ? 2 : 0,
        sessionDateCheck: 'latest-possible-date-only',
      });
      expect(result.series[0].exchangeTimezone).toBe(exchangeTimezone);
      expect(result.quality.warnings.join(' ')).toContain('Local-date validation is unverified');
      if (exchangeTimezone) expect(result.quality.warnings.join(' ')).toContain('invalid provider exchange timezone');
    }
  });

  it('continues rejecting future true timestamps even when their exchange-local session date is current', () => {
    const [bar] = history();
    const result = buildMarketResearch([
      { ...bar, date: '2025-06-02T00:00:00Z', datePrecision: 'timestamp', exchangeTimezone: 'Asia/Tokyo' },
    ], { now: new Date('2025-06-01T23:00:00Z') });
    expect(result.quality).toMatchObject({ barCount: 0, futureBars: 1, futureSessionBars: 0, unverifiedSessionDateBars: 0 });
  });

  it('exposes provenance, unknown currency, partial bars and synthetic input without claiming feed freshness', () => {
    const input = history();
    delete input[20].complete;
    input[0].source = 'synthetic';
    input[1].source = null;
    const result = buildMarketResearch(input, options);
    expect(result.quality.source).toBe('mixed');
    expect(result.quality.sources).toEqual(['synthetic', 'test-feed']);
    expect(result.quality.status).toBe('partial');
    expect(result.metadata.currency).toBeNull();
    const warnings = result.quality.warnings.join(' ');
    for (const fragment of ['Feed delay is unknown', 'Corporate-action adjustment is unverified', 'may be partial', 'Quote currency is unknown', 'Synthetic or demonstration', 'Source attribution is missing']) {
      expect(warnings).toContain(fragment);
    }
    expect(buildMarketResearch(history(), { ...options, currency: 'GBP' }).metadata.currency).toBe('GBP');
    expect(buildMarketResearch(history().map((bar) => ({ ...bar, currency: 'JPY' })), options).metadata.currency).toBe('JPY');
  });

  it('never emits non-finite metrics even for extreme finite inputs or an invalid current time', () => {
    const input = history().map((bar, index) => ({
      ...bar, open: index % 2 ? 1e300 : 1e-300, high: 1e300, low: 1e-300,
      close: index % 2 ? 1e300 : 1e-300, volume: 1e300,
    }));
    input[20] = { ...input[20], close: 1e300, open: 1e300 };
    const result = buildMarketResearch(input, { now: new Date('invalid') });
    expect(result.quality.ageHours).toBeNull();
    expect(result.volume.dollarVolume).toBeNull();
    expectOnlyFiniteNumbers(result);
    expect(JSON.stringify(result)).not.toContain('Infinity');
  });
});
