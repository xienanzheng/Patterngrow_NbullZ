export const MAX_COMPARISON_BARS = 520;
const MIN_RETURNS = 20;
const MAX_GAP_DAYS = 7;
const DAY_MS = 86_400_000;
const VARIANCE_EPSILON = 1e-24;

const finite = (value) => Number.isFinite(value) ? value : null;
const price = (value) => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const currency = (value) => typeof value === 'string' && /^[A-Za-z]{3}$/.test(value) ? value : null;
const source = (value) => ['yahoo', 'twelvedata', 'synthetic'].includes(value) ? value : 'unknown';
const average = (values) => values.reduce((sum, value) => sum + value / values.length, 0);

function upstreamDiagnostics(value) {
  const input = value && typeof value === 'object' ? value : {};
  const counts = {};
  for (const key of ['invalidTimestampBars', 'futureBars', 'duplicateBars', 'invalidPriceBars', 'missingVolumeBars', 'outOfOrderBars', 'unverifiedSessionDateBars', 'invalidExchangeTimezoneBars']) {
    counts[key] = Number.isSafeInteger(input[key]) && input[key] >= 0 ? input[key] : 0;
  }
  return { ...counts, historyMayBeTruncated: input.historyMayBeTruncated === true };
}

function validDateLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parsedDate(value) {
  if (typeof value !== 'string' || !validDateLabel(value.slice(0, 10))) return null;
  const dateOnly = value.length === 10;
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? { time, dateOnly, iso: new Date(time).toISOString() } : null;
}

function timezoneFormatter(value) {
  if (typeof value !== 'string' || !value || value.length > 80) return null;
  try {
    return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone: value, year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    return null;
  }
}

function sessionDate(formatter, time) {
  const parts = Object.fromEntries(formatter.formatToParts(time).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalize(history, fallbackCurrency, fallbackTimezone, nowMs) {
  const input = Array.isArray(history) ? history : [];
  const rows = input.slice(-MAX_COMPARISON_BARS);
  const diagnostics = {
    inputBars: input.length, retainedBars: 0, invalidDates: 0, invalidCloseBars: 0,
    unknownTimezoneBars: 0, invalidTimezoneBars: 0, duplicateSessions: 0,
    futureBars: 0, unverifiedSessionDates: 0, unmatchedSessions: 0,
  };
  const tokens = [];
  const timezones = new Set();
  const sources = new Set();
  const currencies = new Set();
  const fallback = currency(fallbackCurrency);
  if (fallback) currencies.add(fallback);
  let truncated = input.length > MAX_COMPARISON_BARS;
  let synthetic = false;
  const formatters = new Map();

  for (const candidate of rows) {
    const row = candidate && typeof candidate === 'object' ? candidate : {};
    if (row.historyMayBeTruncated === true) truncated = true;
    const parsed = parsedDate(row.date);
    const close = price(row.close);
    if (close == null) diagnostics.invalidCloseBars += 1;
    if (!parsed) {
      diagnostics.invalidDates += 1;
      continue;
    }
    const barSource = source(row.source);
    sources.add(barSource);
    if (barSource === 'synthetic') synthetic = true;
    const barCurrency = currency(row.currency);
    if (barCurrency) currencies.add(barCurrency);
    const dateOnly = parsed.dateOnly || ['date', 'session-date'].includes(row.datePrecision);
    const zone = row.exchangeTimezone ?? fallbackTimezone;
    if (!formatters.has(zone)) formatters.set(zone, timezoneFormatter(zone));
    const formatter = formatters.get(zone);
    if (formatter) timezones.add(formatter.resolvedOptions().timeZone);
    else if (zone != null && zone !== '') diagnostics.invalidTimezoneBars += 1;

    let session = null;
    if (dateOnly) {
      // This is a label supplied by the exchange, not UTC midnight as an event.
      session = row.date.slice(0, 10);
      if (!formatter) diagnostics.unverifiedSessionDates += 1;
    } else if (formatter) {
      session = sessionDate(formatter, parsed.time);
    } else {
      // UTC date is not a safe substitute for an unknown exchange session.
      diagnostics.unknownTimezoneBars += 1;
    }
    if (nowMs != null) {
      const latestSession = formatter
        ? sessionDate(formatter, nowMs)
        : new Date(nowMs + 14 * 3_600_000).toISOString().slice(0, 10);
      const future = dateOnly ? session > latestSession : parsed.time > nowMs;
      if (future) {
        diagnostics.futureBars += 1;
        session = null;
      }
    }
    // Keep unalignable observations as barriers between paired return intervals.
    tokens.push({ time: parsed.time, asOf: parsed.iso, session, close, datePrecision: dateOnly ? 'date' : 'timestamp' });
  }

  tokens.sort((a, b) => a.time - b.time);
  const bySession = new Map();
  tokens.forEach((bar, position) => {
    if (bar.session == null) return;
    if (bySession.has(bar.session)) diagnostics.duplicateSessions += 1;
    bySession.set(bar.session, { ...bar, position });
  });
  diagnostics.retainedBars = bySession.size;
  const knownCurrencies = [...currencies].sort();
  const latest = [...bySession.values()].sort((a, b) => a.session.localeCompare(b.session)).at(-1);
  return {
    bySession, diagnostics, truncated, synthetic,
    currency: knownCurrencies.length === 1 ? knownCurrencies[0] : null,
    mixedCurrency: knownCurrencies.length > 1,
    sources: [...sources].sort(), timezones: [...timezones].sort(),
    asOf: latest?.asOf ?? null, datePrecision: latest?.datePrecision ?? null,
  };
}

function statistics(pairs) {
  if (pairs.length < MIN_RETURNS) return { correlation: null, beta: null, trackingErrorPct: null };
  const symbolMean = average(pairs.map((pair) => pair.symbol));
  const benchmarkMean = average(pairs.map((pair) => pair.benchmark));
  const activeMean = average(pairs.map((pair) => pair.symbol - pair.benchmark));
  let symbolVariance = 0;
  let benchmarkVariance = 0;
  let covariance = 0;
  let activeVariance = 0;
  for (const pair of pairs) {
    const a = pair.symbol - symbolMean;
    const b = pair.benchmark - benchmarkMean;
    symbolVariance += a * a / (pairs.length - 1);
    benchmarkVariance += b * b / (pairs.length - 1);
    covariance += a * b / (pairs.length - 1);
    activeVariance += (pair.symbol - pair.benchmark - activeMean) ** 2 / (pairs.length - 1);
  }
  const usableSymbolVariance = symbolVariance > VARIANCE_EPSILON;
  const usableBenchmarkVariance = benchmarkVariance > VARIANCE_EPSILON;
  const correlation = usableSymbolVariance && usableBenchmarkVariance
    ? finite(covariance / Math.sqrt(symbolVariance) / Math.sqrt(benchmarkVariance)) : null;
  return {
    correlation: correlation == null ? null : Math.max(-1, Math.min(1, correlation)),
    beta: usableBenchmarkVariance ? finite(covariance / benchmarkVariance) : null,
    trackingErrorPct: finite(Math.sqrt(activeVariance <= VARIANCE_EPSILON ? 0 : activeVariance) * Math.sqrt(252) * 100),
  };
}

/**
 * Descriptive daily comparison in each instrument's native quote currency.
 * Dates are exchange-local sessions, or explicit provider session labels.
 * Cumulative price changes use common valid endpoints; daily statistics require
 * at least 20 paired returns, each across adjacent observations in BOTH inputs.
 * Rolling correlation additionally requires an uninterrupted 20-return run.
 * Missing/nonmatching observations and gaps longer than seven calendar days
 * break return intervals. No exchange calendar, FX conversion or dividend
 * reinvestment is inferred. Returned series and each input are bounded to 520.
 */
export function buildMarketComparison(symbolHistory, benchmarkHistory, {
  symbolCurrency = null, benchmarkCurrency = null,
  symbolTimezone = null, benchmarkTimezone = null,
  symbolQuality = null, benchmarkQuality = null, now = new Date(),
} = {}) {
  const parsedNow = now instanceof Date ? now.getTime() : Date.parse(now);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : null;
  const symbol = normalize(symbolHistory, symbolCurrency, symbolTimezone, nowMs);
  const benchmark = normalize(benchmarkHistory, benchmarkCurrency, benchmarkTimezone, nowMs);
  const upstream = { symbol: upstreamDiagnostics(symbolQuality), benchmark: upstreamDiagnostics(benchmarkQuality) };
  const allDates = [...new Set([...symbol.bySession.keys(), ...benchmark.bySession.keys()])].sort();
  const dates = allDates.slice(-MAX_COMPARISON_BARS);
  const truncated = symbol.truncated || benchmark.truncated || allDates.length > MAX_COMPARISON_BARS
    || upstream.symbol.historyMayBeTruncated || upstream.benchmark.historyMayBeTruncated;
  const mixedCurrency = symbol.mixedCurrency || benchmark.mixedCurrency;
  const synthetic = symbol.synthetic || benchmark.synthetic;
  const comparable = !mixedCurrency && !synthetic;
  const rows = dates.map((date) => ({ date, symbol: symbol.bySession.get(date), benchmark: benchmark.bySession.get(date) }));
  symbol.diagnostics.unmatchedSessions = rows.filter((row) => row.symbol && !row.benchmark).length;
  benchmark.diagnostics.unmatchedSessions = rows.filter((row) => row.benchmark && !row.symbol).length;
  const common = rows.filter((row) => row.symbol?.close != null && row.benchmark?.close != null);
  const base = comparable ? common[0] : null;
  const last = comparable ? common.at(-1) : null;
  const pairedReturns = [];
  let run = [];
  let longestPairedRun = 0;
  let skippedIntervals = 0;
  const discardedUpstreamBarriers = Object.values(upstream).some((input) => input.invalidTimestampBars > 0 || input.duplicateBars > 0);
  const invalidDateBarrier = symbol.diagnostics.invalidDates > 0 || benchmark.diagnostics.invalidDates > 0 || discardedUpstreamBarriers;

  const series = rows.map((row, index) => {
    const previous = rows[index - 1];
    const hasBoth = row.symbol?.close != null && row.benchmark?.close != null;
    const priorHasBoth = previous?.symbol?.close != null && previous?.benchmark?.close != null;
    const gapDays = previous ? (Date.parse(row.date) - Date.parse(previous.date)) / DAY_MS : null;
    let pair = null;
    if (comparable && !invalidDateBarrier && hasBoth && priorHasBoth
      && row.symbol.position === previous.symbol.position + 1
      && row.benchmark.position === previous.benchmark.position + 1
      && gapDays > 0 && gapDays <= MAX_GAP_DAYS) {
      const a = finite(row.symbol.close / previous.symbol.close - 1);
      const b = finite(row.benchmark.close / previous.benchmark.close - 1);
      if (a != null && b != null) pair = { symbol: a, benchmark: b };
    }
    if (pair) {
      pairedReturns.push(pair);
      run.push(pair);
      longestPairedRun = Math.max(longestPairedRun, run.length);
    } else {
      if (previous) skippedIntervals += 1;
      run = [];
    }
    const afterBase = base && row.date >= base.date;
    const symbolIndex = afterBase && row.symbol?.close != null ? finite(row.symbol.close / base.symbol.close * 100) : null;
    const benchmarkIndex = afterBase && row.benchmark?.close != null ? finite(row.benchmark.close / base.benchmark.close * 100) : null;
    return {
      date: row.date,
      symbolClose: row.symbol?.close ?? null,
      benchmarkClose: row.benchmark?.close ?? null,
      symbolIndex, benchmarkIndex,
      relativePerformancePp: symbolIndex != null && benchmarkIndex != null ? finite(symbolIndex - benchmarkIndex) : null,
      rollingCorrelation20: run.length >= MIN_RETURNS ? statistics(run.slice(-MIN_RETURNS)).correlation : null,
    };
  });

  const hasDuration = base && last && last.date > base.date;
  const symbolReturnPct = hasDuration ? finite((last.symbol.close / base.symbol.close - 1) * 100) : null;
  const benchmarkReturnPct = hasDuration ? finite((last.benchmark.close / base.benchmark.close - 1) * 100) : null;
  const stats = statistics(pairedReturns);
  const currencyMatch = symbol.currency && benchmark.currency ? symbol.currency === benchmark.currency : null;
  const warnings = [
    'Price returns exclude cash dividends; corporate-action adjustment is unverified.',
    'Exchange calendars and coverage are unverified. Missing sessions in both inputs cannot always be detected.',
    'Sessions are matched by local calendar date; exchanges may close at different times. Feed delay and latest-bar completion are unverified.',
    'Statistics describe observed price changes, not a forecast or a recommendation.',
  ];
  if (!base) warnings.push('No common valid session is available for a comparable base-100 price series.');
  else if (!hasDuration) warnings.push('At least two common valid sessions are required for a period price return.');
  if (pairedReturns.length < MIN_RETURNS) warnings.push('At least 20 paired consecutive-observation returns are required for correlation, beta and tracking error.');
  if (currencyMatch === false) warnings.push('Quote currencies differ. Returns remain in each native currency; no FX conversion has been applied.');
  if (currencyMatch == null) warnings.push('One or both quote currencies are unverified; no FX conversion has been applied.');
  if (mixedCurrency) warnings.push('Quote currency changes within an input. Indexed returns and cross-series statistics are unavailable.');
  if (synthetic) warnings.push('Synthetic observations were supplied. Indexed returns and cross-series statistics are unavailable.');
  if (symbol.diagnostics.unknownTimezoneBars || benchmark.diagnostics.unknownTimezoneBars) warnings.push('Timestamped observations with unknown exchange timezones were excluded from session alignment; UTC dates were not substituted.');
  if (symbol.diagnostics.invalidTimezoneBars || benchmark.diagnostics.invalidTimezoneBars) warnings.push('Invalid exchange timezone values were supplied and were not used for session alignment.');
  if (symbol.diagnostics.unverifiedSessionDates || benchmark.diagnostics.unverifiedSessionDates) warnings.push('Explicit session-date labels were preserved, but their exchange timezone is unverified.');
  if (invalidDateBarrier) warnings.push('Invalid dates prevent proving observation adjacency; daily comparison statistics are unavailable.');
  if (discardedUpstreamBarriers) warnings.push('Upstream normalization removed invalid or duplicate timestamps. Their positions cannot be reconstructed; daily pairing and rolling correlation are unavailable.');
  if (Object.values(upstream).some((input) => Object.values(input).some((value) => value > 0))) warnings.push('Source data-quality diagnostics are retained from the underlying research snapshots; normalization does not erase their limitations.');
  if (symbol.diagnostics.invalidCloseBars || benchmark.diagnostics.invalidCloseBars) warnings.push('Missing or invalid closes remain unavailable and break paired-return windows.');
  if (symbol.diagnostics.duplicateSessions || benchmark.diagnostics.duplicateSessions) warnings.push('Duplicate sessions use the last supplied observation and interrupt affected paired-return windows.');
  if (symbol.diagnostics.futureBars || benchmark.diagnostics.futureBars) warnings.push('Future-dated observations were excluded from alignment.');
  if (skippedIntervals) warnings.push('Unmatched observations, missing values or gaps over seven calendar days interrupt paired-return windows.');
  if (truncated) warnings.push('History was bounded to 520 observations per input and 520 displayed sessions; the selected range may be incomplete.');
  if (pairedReturns.length >= MIN_RETURNS && (stats.correlation == null || stats.beta == null)) warnings.push('Zero or numerically negligible return variance makes correlation or beta undefined.');
  if (nowMs == null) warnings.push('Current time is invalid; future-date checks were unavailable.');
  if (symbol.sources.includes('unknown') || benchmark.sources.includes('unknown')) warnings.push('Source attribution is unverified for one or more observations.');

  const incomplete = !base || pairedReturns.length < MIN_RETURNS || truncated || currencyMatch !== true || mixedCurrency || synthetic
    || skippedIntervals > 0 || nowMs == null
    || Object.values(upstream).some((input) => Object.values(input).some((value) => value > 0))
    || [symbol, benchmark].some((input) => input.sources.includes('unknown') || Object.entries(input.diagnostics).some(([key, value]) => !['inputBars', 'retainedBars'].includes(key) && value > 0));
  return {
    series,
    metrics: {
      symbolReturnPct, benchmarkReturnPct,
      relativePerformancePp: symbolReturnPct != null && benchmarkReturnPct != null ? finite(symbolReturnPct - benchmarkReturnPct) : null,
      ...stats,
    },
    sample: {
      symbolBars: symbol.diagnostics.retainedBars, benchmarkBars: benchmark.diagnostics.retainedBars,
      commonSessions: common.length, pairedReturns: pairedReturns.length, longestPairedRun,
      startDate: base?.date ?? null, endDate: last?.date ?? null,
    },
    metadata: {
      calculationVersion: 'market-comparison.v1',
      symbolCurrency: symbol.currency, benchmarkCurrency: benchmark.currency, currencyMatch, fxAdjusted: false,
      symbolSources: symbol.sources, benchmarkSources: benchmark.sources,
      symbolAsOf: symbol.asOf, benchmarkAsOf: benchmark.asOf,
      symbolDatePrecision: symbol.datePrecision, benchmarkDatePrecision: benchmark.datePrecision,
      symbolTimezones: symbol.timezones, benchmarkTimezones: benchmark.timezones,
      alignment: 'Exchange-local session dates; explicit session-date labels preserved',
      priceAdjustment: 'Unverified', returnMethod: 'Simple native-currency close-to-close price returns; dividends excluded',
      correlationMethod: 'Pearson correlation of paired simple daily returns',
      betaMethod: 'Sample covariance of symbol and benchmark returns / sample variance of benchmark returns',
      trackingErrorMethod: 'Sample standard deviation of daily return differences × sqrt(252) × 100',
      percentUnit: 'Percentage points; 5 means 5%', annualizationPeriods: 252,
      minimumPairedReturns: MIN_RETURNS, rollingCorrelationWindow: MIN_RETURNS,
      maxCalendarGapDays: MAX_GAP_DAYS, barLimit: MAX_COMPARISON_BARS,
    },
    quality: {
      status: !base ? 'unavailable' : incomplete ? 'partial' : 'ok',
      truncated, skippedIntervals, symbol: symbol.diagnostics, benchmark: benchmark.diagnostics, upstream, warnings,
    },
  };
}
