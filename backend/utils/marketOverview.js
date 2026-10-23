import { getResearchSnapshot } from './researchService.js';

const TTL_MS = 60_000;
const PROXIES = Object.freeze([
  { symbol: 'SPY', name: 'US large companies', description: 'S&P 500 equity fund proxy.' },
  { symbol: 'QQQ', name: 'Nasdaq-100', description: 'Nasdaq-100 equity fund proxy.' },
  { symbol: 'IWM', name: 'US small companies', description: 'Russell 2000 equity fund proxy.' },
  { symbol: 'TLT', name: 'Long US Treasuries', description: '20+ year US Treasury bond fund proxy; its price is not a bond yield.' },
  { symbol: 'GLD', name: 'Gold fund', description: 'Gold-backed exchange-traded fund proxy; the share price is not a spot gold quote.' },
  { symbol: 'USO', name: 'Oil futures fund', description: 'Oil futures fund proxy; its share-price changes are not spot oil returns.' },
]);
let cache = null;
let pending = null;

const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value, limit = 240) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function sessionDate(asOf, precision, exchangeTimezone) {
  if (!asOf) return null;
  if (precision === 'date' || precision === 'session-date') return asOf.slice(0, 10);
  if (!exchangeTimezone) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone: exchangeTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(asOf)).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return null;
  }
}

function unavailable(proxy) {
  return {
    ...proxy, latestClose: null, currency: null, return1: null, return5: null, return20: null,
    relativeVolume20: null, asOf: null, asOfPrecision: null, sessionDate: null, exchangeTimezone: null,
    fetchedAt: null, source: null, status: 'unavailable',
    warnings: ['Historical observations for this proxy are unavailable.'], sparkline: [],
  };
}

function summarize(proxy, snapshot) {
  const research = snapshot?.research ?? {};
  const quality = research.quality ?? {};
  const rows = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const latest = rows.at(-1);
  const close = finite(latest?.close);
  const latestClose = close != null && close > 0 ? close : null;
  const asOf = iso(quality.asOf);
  const asOfPrecision = ['date', 'session-date', 'timestamp'].includes(quality.asOfPrecision) ? quality.asOfPrecision : null;
  const exchangeTimezone = text(quality.exchangeTimezone ?? latest?.exchangeTimezone, 80);
  const date = sessionDate(asOf, asOfPrecision, exchangeTimezone);
  const warnings = (Array.isArray(quality.warnings) ? quality.warnings : []).map((warning) => text(warning)).filter(Boolean).slice(0, 12);
  if (!date) warnings.push('The exchange-session date cannot be verified from the supplied timestamp and timezone.');
  if (latestClose == null) warnings.push('The latest bar has no usable close; an older close has not been substituted.');
  return {
    ...proxy,
    latestClose,
    currency: text(research.metadata?.currency, 20),
    return1: latestClose == null ? null : finite(research.risk?.return1),
    return5: latestClose == null ? null : finite(research.risk?.return5),
    return20: latestClose == null ? null : finite(research.risk?.return20),
    relativeVolume20: finite(research.volume?.relative20),
    asOf, asOfPrecision, sessionDate: date, exchangeTimezone,
    fetchedAt: iso(snapshot?.fetchedAt), source: text(quality.source, 80),
    status: latestClose == null || quality.status === 'unavailable' ? 'unavailable' : quality.status === 'ok' && date ? 'ok' : 'partial',
    warnings,
    // Preserve null closes as gaps rather than joining disconnected observations.
    sparkline: rows.slice(-20).map((row) => ({ date: iso(row.date), close: finite(row.close) })).filter((row) => row.date),
  };
}

async function buildOverview() {
  const rows = new Array(PROXIES.length);
  let next = 0;
  const worker = async () => {
    while (next < PROXIES.length) {
      const index = next++;
      const proxy = PROXIES[index];
      try {
        rows[index] = summarize(proxy, await getResearchSnapshot({ symbol: proxy.symbol, range: '3mo', interval: '1d' }));
      } catch {
        rows[index] = unavailable(proxy);
      }
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  const available = rows.filter((row) => row.status !== 'unavailable');
  const byDate = new Map();
  for (const row of available) {
    if (!row.sessionDate) continue;
    if (!byDate.has(row.sessionDate)) byDate.set(row.sessionDate, []);
    byDate.get(row.sessionDate).push(row.symbol);
  }
  const sessionDates = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, symbols]) => ({ date, symbols }));
  const unverifiedSessionSymbols = available.filter((row) => !row.sessionDate).map((row) => row.symbol);
  const sameSession = sessionDates.length > 1 ? false
    : available.length === PROXIES.length && unverifiedSessionSymbols.length === 0 ? true : null;
  const warnings = [
    'Daily observations from six fund proxies; this is a limited cross-section, not a measure of market breadth.',
    'Feed delay is unknown and the latest daily bars may be incomplete. Price changes exclude cash distributions; corporate-action adjustments are unverified.',
    'Fund prices can differ from their underlying indexes, spot commodities or bond yields. USO is an oil futures fund proxy.',
  ];
  if (available.length < PROXIES.length) warnings.push(`${available.length} of ${PROXIES.length} proxies have a usable latest close; unavailable rows are kept visible.`);
  if (sameSession === false) warnings.push('Latest observations cover different exchange-session dates; cross-proxy changes are not synchronized.');
  if (unverifiedSessionSymbols.length) warnings.push('Some exchange-session dates are unverified; same-session coverage cannot be confirmed for all proxies.');
  return {
    interval: '1d', range: '3mo', generatedAt: new Date().toISOString(),
    status: available.length === 0 ? 'unavailable' : available.length === PROXIES.length && sameSession && rows.every((row) => row.status === 'ok') ? 'ok' : 'partial',
    rows,
    coverage: {
      requested: PROXIES.length, available: available.length, sameSession, sessionDates,
      latestSessionDate: sessionDates.at(-1)?.date ?? null,
      latestSessionCount: sessionDates.at(-1)?.symbols.length ?? 0,
      unverifiedSessionSymbols,
      missingSymbols: rows.filter((row) => row.status === 'unavailable').map((row) => row.symbol),
    },
    warnings,
  };
}

/** One bounded summary cache; callers cannot expand symbols, range or concurrency. */
export async function getMarketOverview() {
  const provider = process.env.MARKET_DATA_PROVIDER ?? 'yahoo';
  if (cache?.provider === provider && Date.now() - cache.createdAt < TTL_MS) {
    return { ...structuredClone(cache.snapshot), cache: { hit: true, ttlSeconds: TTL_MS / 1000 } };
  }
  if (pending) {
    const active = pending;
    const snapshot = await active.promise;
    // A configuration change cannot start another concurrent six-symbol batch.
    if (active.provider !== provider) return getMarketOverview();
    return { ...structuredClone(snapshot), cache: { hit: false, ttlSeconds: TTL_MS / 1000 } };
  }
  const task = { provider, promise: null };
  task.promise = buildOverview().then((snapshot) => {
    cache = { provider, snapshot, createdAt: Date.now() };
    return snapshot;
  }).finally(() => { if (pending === task) pending = null; });
  pending = task;
  const snapshot = await task.promise;
  return { ...structuredClone(snapshot), cache: { hit: false, ttlSeconds: TTL_MS / 1000 } };
}
