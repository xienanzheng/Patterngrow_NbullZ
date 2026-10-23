const WINDOW = 20;
const DAY_MS = 86_400_000;

// Missing values must not become zero. Numeric strings are accepted from APIs.
const numberOrNull = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const positivePrice = (value) => {
  const number = numberOrNull(value);
  return number != null && number > 0 ? number : null;
};
const nonnegativeVolume = (value) => {
  const number = numberOrNull(value);
  return number != null && number >= 0 ? number : null;
};
const finiteResult = (value) => Number.isFinite(value) ? value : null;
const mean = (values) => finiteResult(values.reduce((sum, value) => sum + value / values.length, 0));
const label = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function exchangeDate(timeZone, nowMs) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    if (nowMs == null) return { valid: true, date: null };
    const parts = Object.fromEntries(formatter.formatToParts(nowMs).map(({ type, value }) => [type, value]));
    return { valid: true, date: `${parts.year}-${parts.month}-${parts.day}` };
  } catch {
    return { valid: false, date: null };
  }
}

function timestamp(value) {
  if (value instanceof Date) return finiteResult(value.getTime());
  if (typeof value === 'number') {
    // Numeric timestamps, if supplied, are milliseconds, never inferred seconds.
    return finiteResult(new Date(value).getTime());
  }
  if (typeof value !== 'string') return null;
  // Date-only values are UTC; timestamps need a zone so host timezone cannot alter results.
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  return finiteResult(Date.parse(value));
}

function completeWindow(bars, count, property) {
  if (bars.length < count) return null;
  const values = bars.slice(-count).map((bar) => bar[property]);
  return values.every((value) => value != null) ? values : null;
}

function historicalReturn(bars, periods) {
  const closes = completeWindow(bars, periods + 1, 'close');
  return closes ? finiteResult((closes.at(-1) / closes[0] - 1) * 100) : null;
}

/**
 * Describe supplied OHLCV observations; this does not assess investment suitability.
 * Input dates must be ISO dates, zoned ISO timestamps, Date objects or epoch milliseconds.
 * Timestamps are sorted; the final input row for a duplicate timestamp wins. Invalid and
 * future timestamps are excluded. Invalid prices/volumes stay null; missing closes are not bridged.
 * A malformed OHLC range cannot contribute to ATR; a valid close can still describe returns.
 *
 * Units: returns, drawdown, ATR-percent, percentile and volatility are percentage points
 * (5 means 5%). Drawdown is zero or negative. Relative volume is a ratio (2 means 2x).
 * ATR is in quote-price units; volume and OBV are in the provider's reported volume units.
 * `dollarVolume` is the legacy name for close × volume, a notional proxy in quote currency,
 * NOT an assertion that the currency is USD or that actual traded turnover is known.
 *
 * Average/relative/percentile volume use the preceding 20 observations, excluding latest.
 * Percentile uses mid-rank ties: 100 × (below + equal / 2) / 20. Complete windows are required.
 * Realized volatility is sample standard deviation of 20 log returns × sqrt(252) × 100,
 * only for interval '1d'; 252 is an explicit trading-day convention, not an inferred calendar.
 * ATR14 is the simple mean of 14 true ranges, not Wilder's recursive smoothing.
 */
export function buildMarketResearch(history, { interval = '1d', now = new Date(), currency = null } = {}) {
  const input = Array.isArray(history) ? history : [];
  const nowMs = timestamp(now);
  let missingVolumeBars = 0;
  let invalidPriceBars = 0;
  let invalidTimestampBars = 0;
  let futureBars = 0;
  let duplicateBars = 0;
  let outOfOrderBars = 0;
  let historyMayBeTruncated = false;
  let unverifiedSessionDateBars = 0;
  let invalidExchangeTimezoneBars = 0;
  let futureSessionBars = 0;
  let previousTimestamp = null;
  const byTimestamp = new Map();
  const exchangeDates = new Map();
  // Without an exchange zone, only dates beyond every possible current local date
  // are definitely future. UTC+14 is the maximum civil timezone offset.
  const latestPossibleDateMs = nowMs == null ? null : finiteResult(new Date(nowMs + 14 * 3_600_000).getTime());
  const latestPossibleDate = latestPossibleDateMs == null ? null : new Date(latestPossibleDateMs).toISOString().slice(0, 10);

  for (const candidate of input) {
    const row = candidate && typeof candidate === 'object' ? candidate : {};
    const time = timestamp(row.date);
    const datePrecision = ['date', 'session-date', 'timestamp'].includes(row.datePrecision)
      ? row.datePrecision
      : typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? 'date' : null;
    const sessionDate = datePrecision === 'date' || datePrecision === 'session-date';
    const exchangeTimezone = label(row.exchangeTimezone);
    if (row.historyMayBeTruncated === true) historyMayBeTruncated = true;
    const open = positivePrice(row.open);
    const high = positivePrice(row.high);
    const low = positivePrice(row.low);
    const close = positivePrice(row.close);
    const volume = nonnegativeVolume(row.volume);
    const validRange = open != null && high != null && low != null && close != null
      && high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low;
    if (volume == null) missingVolumeBars += 1;
    if (!validRange) invalidPriceBars += 1;
    if (time == null) {
      invalidTimestampBars += 1;
      continue;
    }
    if (previousTimestamp != null && time < previousTimestamp) outOfOrderBars += 1;
    previousTimestamp = time;
    let futureSession = false;
    let sessionDateCheck = null;
    if (sessionDate) {
      if (exchangeTimezone && !exchangeDates.has(exchangeTimezone)) {
        exchangeDates.set(exchangeTimezone, exchangeDate(exchangeTimezone, nowMs));
      }
      const localDate = exchangeTimezone ? exchangeDates.get(exchangeTimezone) : null;
      if (exchangeTimezone && !localDate.valid) invalidExchangeTimezoneBars += 1;
      if (localDate?.valid && localDate.date) {
        sessionDateCheck = 'exchange-local-date';
        futureSession = new Date(time).toISOString().slice(0, 10) > localDate.date;
      } else {
        unverifiedSessionDateBars += 1;
        sessionDateCheck = latestPossibleDate ? 'latest-possible-date-only' : 'unavailable';
        futureSession = latestPossibleDate != null && new Date(time).toISOString().slice(0, 10) > latestPossibleDate;
      }
    }
    // Session labels are compared with exchange-local dates, never their encoded midnight.
    if (futureSession || (!sessionDate && nowMs != null && time > nowMs)) {
      futureBars += 1;
      if (futureSession) futureSessionBars += 1;
      continue;
    }
    if (byTimestamp.has(time)) duplicateBars += 1;
    byTimestamp.set(time, {
      time, date: new Date(time).toISOString(), open,
      high: validRange ? high : null,
      low: validRange ? low : null,
      close, volume, source: label(row.source), currency: label(row.currency),
      complete: typeof row.complete === 'boolean' ? row.complete : null,
      datePrecision,
      exchangeTimezone, sessionDateCheck,
      historyMayBeTruncated: typeof row.historyMayBeTruncated === 'boolean' ? row.historyMayBeTruncated : null,
    });
  }

  const bars = [...byTimestamp.values()].sort((a, b) => a.time - b.time);
  const latest = bars.at(-1);
  const latestIsSessionDate = latest?.datePrecision === 'date' || latest?.datePrecision === 'session-date';
  const sources = [...new Set(bars.map((bar) => bar.source).filter(Boolean))].sort();
  const source = sources.length === 1 ? sources[0] : sources.length > 1 ? 'mixed' : null;
  const knownCurrencies = [...new Set(bars.map((bar) => bar.currency).filter(Boolean))];
  const quoteCurrency = label(currency) ?? (knownCurrencies.length === 1 ? knownCurrencies[0] : null);
  const priorBars = bars.slice(0, -1).slice(-WINDOW);
  const priorVolumes = priorBars.map((bar) => bar.volume).filter((value) => value != null);
  const average20 = priorBars.length === WINDOW && priorVolumes.length === WINDOW ? mean(priorVolumes) : null;
  const latestVolume = latest?.volume ?? null;
  const latestClose = latest?.close ?? null;
  const relative20 = latestVolume != null && average20 != null && average20 > 0
    ? finiteResult(latestVolume / average20) : null;
  const percentile20 = latestVolume != null && priorVolumes.length === WINDOW
    ? 100 * priorVolumes.reduce((sum, value) => sum + (value < latestVolume ? 1 : value === latestVolume ? 0.5 : 0), 0) / WINDOW
    : null;

  let obvChange20 = null;
  const closes21 = completeWindow(bars, WINDOW + 1, 'close');
  const volumes20 = completeWindow(bars, WINDOW, 'volume');
  if (closes21 && volumes20) {
    obvChange20 = finiteResult(volumes20.reduce((sum, volume, index) => (
      sum + Math.sign(closes21[index + 1] - closes21[index]) * volume
    ), 0));
  }

  let realizedVolatility20 = null;
  if (interval === '1d' && closes21) {
    // Subtract logs instead of logging a ratio to avoid overflow for extreme finite inputs.
    const returns = closes21.slice(1).map((close, index) => Math.log(close) - Math.log(closes21[index]));
    const averageReturn = mean(returns);
    const variance = returns.reduce((sum, value) => sum + (value - averageReturn) ** 2 / (WINDOW - 1), 0);
    realizedVolatility20 = finiteResult(Math.sqrt(variance * 252) * 100);
  }

  let maxDrawdown = null;
  if (bars.length && bars.every((bar) => bar.close != null)) {
    let peak = bars[0].close;
    maxDrawdown = 0;
    for (const bar of bars) {
      peak = Math.max(peak, bar.close);
      maxDrawdown = Math.min(maxDrawdown, (bar.close / peak - 1) * 100);
    }
  }

  let atr14 = null;
  if (bars.length >= 15) {
    const window = bars.slice(-15);
    const ranges = window.slice(1).map((bar, index) => {
      const previousClose = window[index].close;
      return bar.high != null && bar.low != null && previousClose != null
        ? finiteResult(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)))
        : null;
    });
    if (ranges.every((value) => value != null)) atr14 = mean(ranges);
  }

  const warnings = [
    'Feed delay is unknown. Timestamp age is elapsed clock time, not a market-hours freshness assessment.',
    'Corporate-action adjustment is unverified; splits and distributions may distort historical metrics.',
    'Exchange calendars and session coverage are unverified; a complete observation window does not prove that no market bars are missing.',
  ];
  if (latest?.complete !== true) {
    warnings.push(latest?.complete === false
      ? 'The latest bar is marked incomplete; its volume and derived metrics may change.'
      : 'Latest-bar completion is unknown; the latest bar may be partial and its metrics may change.');
  }
  if (!quoteCurrency) warnings.push('Quote currency is unknown. Close × volume is a notional proxy, not a confirmed USD amount.');
  if (knownCurrencies.length > 1) warnings.push('Multiple quote currencies occur in the input; cross-bar comparisons may not be meaningful.');
  if (historyMayBeTruncated) warnings.push('The provider reached its history limit; the supplied sample may not cover the full requested range.');
  if (bars.some((bar) => bar.datePrecision === 'date' || bar.datePrecision === 'session-date')) {
    warnings.push('Session dates are exchange-session labels, not precise observation times. Clock age is unavailable; future session dates are checked against the exchange-local calendar date when its timezone is valid.');
  }
  if (unverifiedSessionDateBars) warnings.push(`${unverifiedSessionDateBars} session-date bar(s) lack a usable exchange timezone or current time. Local-date validation is unverified; only dates later than every possible current local date can be excluded when current time is available.`);
  if (invalidExchangeTimezoneBars) warnings.push(`${invalidExchangeTimezoneBars} session-date bar(s) have an invalid provider exchange timezone; no server-local timezone was assumed.`);
  if (sources.length > 1) warnings.push('Multiple sources occur in the input; coverage and adjustment conventions may differ.');
  if (bars.some((bar) => !bar.source)) warnings.push('Source attribution is missing for one or more retained bars.');
  const synthetic = sources.some((value) => /synthetic|mock|demo/i.test(value));
  if (synthetic) warnings.push('Synthetic or demonstration observations are present; these do not represent observed market activity.');
  if (missingVolumeBars) warnings.push(`${missingVolumeBars} input bar(s) have missing or invalid volume; missing volume is never treated as zero.`);
  if (invalidPriceBars) warnings.push(`${invalidPriceBars} input bar(s) have missing, invalid or inconsistent OHLC prices; affected metrics are unavailable.`);
  if (invalidTimestampBars) warnings.push(`${invalidTimestampBars} input bar(s) with invalid or ambiguous timestamps were excluded.`);
  if (futureBars) warnings.push(`${futureBars} input bar(s) with future timestamps or future session dates were excluded.`);
  if (duplicateBars) warnings.push(`${duplicateBars} duplicate timestamp(s) were removed; the last supplied row wins.`);
  if (outOfOrderBars) warnings.push('Input bars were out of chronological order and have been sorted.');
  if (nowMs == null) warnings.push('Current time is invalid; timestamp age and future-bar checks are unavailable.');
  if (bars.length < WINDOW + 1) warnings.push('At least 21 bars are needed for complete 20-bar comparison windows.');
  else if (priorVolumes.length < WINDOW) warnings.push('The preceding 20 bars do not have complete volume coverage; 20-bar volume comparisons are unavailable.');
  if (interval !== '1d') warnings.push('Comparisons use bars, not trading days. Volume is not normalized to the same time of day; volatility annualization is available only for daily bars.');

  const hasPrice = bars.some((bar) => bar.close != null);
  const partial = bars.length < WINDOW + 1 || missingVolumeBars > 0 || invalidPriceBars > 0
    || invalidTimestampBars > 0 || futureBars > 0 || duplicateBars > 0 || outOfOrderBars > 0
    || sources.length !== 1 || bars.some((bar) => !bar.source) || knownCurrencies.length > 1
    || synthetic || latest?.complete === false || nowMs == null || historyMayBeTruncated || unverifiedSessionDateBars > 0;

  return {
    volume: {
      latest: latestVolume,
      average20,
      relative20,
      percentile20,
      dollarVolume: latestClose != null && latestVolume != null ? finiteResult(latestClose * latestVolume) : null,
      obvChange20,
      sampleSize: priorVolumes.length,
    },
    risk: {
      realizedVolatility20,
      maxDrawdown,
      return1: historicalReturn(bars, 1),
      return5: historicalReturn(bars, 5),
      return20: historicalReturn(bars, 20),
      atr14,
      atrPercent14: atr14 != null && latestClose != null ? finiteResult(atr14 / latestClose * 100) : null,
    },
    quality: {
      source, sources,
      asOf: latest?.date ?? null,
      asOfPrecision: latest?.datePrecision ?? null,
      exchangeTimezone: latest?.exchangeTimezone ?? null,
      sessionDateCheck: latest?.sessionDateCheck ?? null,
      ageHours: latest && !latestIsSessionDate && nowMs != null ? (nowMs - latest.time) / 3_600_000 : null,
      barCount: bars.length,
      missingVolumeBars, invalidPriceBars, duplicateBars, outOfOrderBars,
      invalidTimestampBars, futureBars, futureSessionBars, historyMayBeTruncated,
      unverifiedSessionDateBars, invalidExchangeTimezoneBars,
      status: !hasPrice ? 'unavailable' : partial ? 'partial' : 'ok',
      warnings,
    },
    metadata: {
      calculationVersion: 'market-research.v1',
      interval,
      currency: quoteCurrency,
      volumeUnit: 'provider-reported volume units',
      percentUnit: 'percentage points; 5 means 5%',
      relativeVolumeUnit: 'ratio; 2 means 2x',
      volumeComparison: 'latest bar / mean of preceding 20 bars; no same-time-of-day normalization',
      percentileMethod: 'mid-rank against preceding 20 bars, excluding latest',
      turnoverMethod: 'close × reported volume; not actual traded turnover',
      volatilityMethod: interval === '1d' ? '20 log returns; sample standard deviation × sqrt(252) × 100' : null,
      volatilityAnnualizationPeriods: interval === '1d' ? 252 : null,
      atrMethod: 'simple mean of the latest 14 true ranges in quote-price units',
      drawdownMethod: 'most negative close-to-running-peak return over the supplied sample; missing closes make it unavailable',
      qualityStatusMeaning: 'structural coverage only; does not certify feed delay, bar completion or market freshness',
      windowUnit: interval === '1d' ? 'daily bars' : 'bars',
      elapsedDays: bars.length > 1 ? (latest.time - bars[0].time) / DAY_MS : null,
    },
    series: bars.map(({ date, open, high, low, close, volume, currency: barCurrency, source: barSource, datePrecision, exchangeTimezone, historyMayBeTruncated: truncated }) => ({
      date, open, high, low, close, volume, currency: barCurrency, source: barSource, datePrecision, exchangeTimezone, historyMayBeTruncated: truncated,
    })),
  };
}
