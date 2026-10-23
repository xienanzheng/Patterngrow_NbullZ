import { fetchYahooHistory } from './marketData.js';
import { buildMarketResearch } from './marketResearch.js';

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;
const MAX_HISTORY_BARS = 5_000;
const MAX_CACHED_BARS = 100_000;
const cache = new Map();
const pending = new Map();
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']);
const INTERVALS = new Set(['5m', '15m', '1h', '1d', '1wk', '1mo']);

export function validateResearchQuery({ symbol, range = '1y', interval = '1d' } = {}) {
  if (typeof symbol !== 'string' || !/^[A-Z0-9.^=-]{1,20}$/i.test(symbol.trim())
    || !RANGES.has(range) || !INTERVALS.has(interval)) {
    const error = new Error('Provide a valid symbol, range and interval.');
    error.status = 400;
    throw error;
  }
  const allowedIntradayRange = interval === '1h'
    ? ['1d', '5d', '1mo', '3mo', '6mo', '1y'] : ['1d', '5d', '1mo'];
  if (['5m', '15m', '1h'].includes(interval) && !allowedIntradayRange.includes(range)) {
    const error = new Error('This intraday range exceeds the supported history window.');
    error.status = 400;
    throw error;
  }
  return { symbol: symbol.trim().toUpperCase(), range, interval };
}

export async function getResearchSnapshot(query) {
  const { symbol, range, interval } = validateResearchQuery(query);
  const key = `${symbol}:${range}:${interval}:${process.env.MARKET_DATA_PROVIDER ?? 'yahoo'}`;
  const cached = cache.get(key);
  let result;
  let cacheHit = false;
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    result = cached;
    cacheHit = true;
  } else {
    if (!pending.has(key)) {
      if (pending.size >= 20) {
        const error = new Error('Research service is busy. Please try again shortly.');
        error.status = 503;
        throw error;
      }
      const task = (async () => {
        let history = await fetchYahooHistory(symbol, range, interval);
        if (!history.length || history.some((bar) => bar.source === 'synthetic')) {
          throw new Error('Historical market data is unavailable.');
        }
        if (history.length > MAX_HISTORY_BARS) {
          history = history.slice(-MAX_HISTORY_BARS).map((bar) => ({ ...bar, historyMayBeTruncated: true }));
        }
        const entry = { history, fetchedAt: Date.now() };
        cache.delete(key);
        let cachedBars = [...cache.values()].reduce((sum, item) => sum + item.history.length, 0);
        while (cache.size && (cache.size >= MAX_CACHE_ENTRIES || cachedBars + history.length > MAX_CACHED_BARS)) {
          const oldest = cache.keys().next().value;
          cachedBars -= cache.get(oldest).history.length;
          cache.delete(oldest);
        }
        cache.set(key, entry);
        return entry;
      })().finally(() => pending.delete(key));
      pending.set(key, task);
    }
    result = await pending.get(key);
  }
  const currency = result.history.at(-1)?.currency ?? null;
  const research = buildMarketResearch(result.history, { interval, currency });
  if (research.quality.status === 'unavailable') {
    const error = new Error('Historical market data is unavailable.');
    error.status = 503;
    cache.delete(key);
    throw error;
  }
  return {
    symbol, range, interval,
    fetchedAt: new Date(result.fetchedAt).toISOString(),
    cache: { hit: cacheHit, ttlSeconds: CACHE_TTL_MS / 1000 },
    history: research.series,
    research,
  };
}
