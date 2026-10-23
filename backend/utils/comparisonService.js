import { getResearchSnapshot } from './researchService.js';
import { buildMarketComparison } from './marketComparison.js';

const RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y']);
const FIELDS = new Set(['symbol', 'benchmark', 'range', 'interval']);
const validSymbol = (value) => typeof value === 'string' && /^[A-Z0-9.^=-]{1,20}$/i.test(value.trim());

function invalidQuery() {
  const error = new Error('Provide one valid symbol and benchmark, a supported range, and daily interval only.');
  error.status = 400;
  error.code = 'INVALID_COMPARISON_QUERY';
  return error;
}

export function validateComparisonQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some((key) => !FIELDS.has(key))) throw invalidQuery();
  const { symbol, benchmark = 'SPY', range = '1y', interval = '1d' } = query;
  if (!validSymbol(symbol) || !validSymbol(benchmark) || !RANGES.has(range) || interval !== '1d') throw invalidQuery();
  return { symbol: symbol.trim().toUpperCase(), benchmark: benchmark.trim().toUpperCase(), range, interval };
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export async function getComparisonSnapshot(query) {
  const { symbol, benchmark, range, interval } = validateComparisonQuery(query);
  try {
    const symbolRequest = getResearchSnapshot({ symbol, range, interval });
    const benchmarkRequest = symbol === benchmark ? symbolRequest : getResearchSnapshot({ symbol: benchmark, range, interval });
    const [symbolSnapshot, benchmarkSnapshot] = await Promise.all([symbolRequest, benchmarkRequest]);
    if (![symbolSnapshot, benchmarkSnapshot].every((snapshot) => Array.isArray(snapshot?.history) && snapshot.history.length)) {
      throw new Error('Missing comparison history.');
    }
    return {
      symbol, benchmark, range, interval,
      fetchedAt: { symbol: safeTimestamp(symbolSnapshot.fetchedAt), benchmark: safeTimestamp(benchmarkSnapshot.fetchedAt) },
      comparison: buildMarketComparison(symbolSnapshot.history, benchmarkSnapshot.history, {
        symbolCurrency: symbolSnapshot.research?.metadata?.currency,
        benchmarkCurrency: benchmarkSnapshot.research?.metadata?.currency,
        symbolTimezone: symbolSnapshot.research?.quality?.exchangeTimezone,
        benchmarkTimezone: benchmarkSnapshot.research?.quality?.exchangeTimezone,
        symbolQuality: symbolSnapshot.research?.quality,
        benchmarkQuality: benchmarkSnapshot.research?.quality,
      }),
    };
  } catch {
    const error = new Error('Historical comparison data is unavailable. Please try again shortly.');
    error.status = 503;
    error.code = 'COMPARISON_DATA_UNAVAILABLE';
    throw error;
  }
}
