// Shared, bounded handlers for the local read-only MCP surface.
export const HISTORY_RANGES = ['1mo', '3mo', '6mo', '1y', '2y'];
export const MAX_HISTORY_ROWS = 520;
export const MAX_RESPONSE_BYTES = 256_000;
const PROVIDER_IDS = new Set(['yahoo', 'google', 'twelvedata', 'massive', 'polygon']);

function normalizeInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input.');
  if (Object.keys(input).some((key) => !['symbol', 'range', 'limit'].includes(key))) {
    throw new Error('Unknown input field.');
  }
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9^][A-Z0-9.^-]{0,14}$/.test(symbol)) throw new Error('Invalid symbol.');
  const range = input.range ?? '1y';
  if (!HISTORY_RANGES.includes(range)) throw new Error('Invalid history range.');
  const limit = input.limit ?? MAX_HISTORY_ROWS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_ROWS) throw new Error('Invalid row limit.');
  return { symbol, range, limit };
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicRows(history) {
  if (!Array.isArray(history) || history.length === 0) throw new Error('History unavailable.');
  if (history.some((row) => row?.source === 'synthetic')) throw new Error('Synthetic history is unavailable in MCP.');
  // Select known scalar fields; raw provider objects, request URLs and headers never leave the process.
  return history.slice(-MAX_HISTORY_ROWS).map((row) => {
    const timestamp = typeof row?.date === 'string' ? Date.parse(row.date) : NaN;
    const volume = finiteOrNull(row?.volume);
    return {
      date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      open: finiteOrNull(row?.open),
      high: finiteOrNull(row?.high),
      low: finiteOrNull(row?.low),
      close: finiteOrNull(row?.close),
      volume: volume != null && volume >= 0 ? volume : null,
      source: PROVIDER_IDS.has(row?.source) ? row.source : 'unknown',
      currency: typeof row?.currency === 'string' && /^[A-Za-z]{3}$/.test(row.currency) ? row.currency : null,
      datePrecision: ['date', 'timestamp'].includes(row?.datePrecision) ? row.datePrecision : null,
      exchangeTimezone: typeof row?.exchangeTimezone === 'string' && row.exchangeTimezone.length <= 64
        && /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+){0,3}$/.test(row.exchangeTimezone)
        ? row.exchangeTimezone : null,
      complete: typeof row?.complete === 'boolean' ? row.complete : null,
      historyMayBeTruncated: typeof row?.historyMayBeTruncated === 'boolean' ? row.historyMayBeTruncated : null,
    };
  });
}

export function toToolResult(value) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Response exceeds size limit.');
  return { content: [{ type: 'text', text }], structuredContent: value };
}

export function toToolError() {
  // Provider errors can include request URLs, API keys or raw upstream bodies.
  return {
    isError: true,
    content: [{ type: 'text', text: 'Market data could not be returned. Check the symbol, provider configuration and availability, then retry.' }],
  };
}

export function createResearchTools({ fetchHistory, buildResearch, providerStatus, timeoutMs = 26_000, now = () => new Date() }) {
  let activeFetches = 0;

  async function load(input) {
    const query = normalizeInput(input);
    if (activeFetches >= 2) throw new Error('Market data requests are busy.');
    activeFetches += 1;
    let timer;
    // Keep the slot occupied until the provider actually settles, including after a caller deadline.
    const work = Promise.resolve()
      .then(() => fetchHistory(query.symbol, query.range, '1d'))
      .then((rows) => ({ history: publicRows(rows), totalRows: rows.length }))
      .finally(() => { activeFetches -= 1; });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Market data deadline exceeded.')), timeoutMs);
    });
    try {
      const result = await Promise.race([work, deadline]);
      return { query, ...result };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getMarketHistory(input) {
      const { query, history, totalRows } = await load(input);
      return {
        symbol: query.symbol,
        range: query.range,
        interval: '1d',
        generatedAt: now().toISOString(),
        sources: [...new Set(history.map((row) => row.source))],
        returnedRows: Math.min(query.limit, history.length),
        truncated: totalRows > query.limit,
        history: history.slice(-query.limit),
        notes: [
          'Historical daily observations; the latest daily bar may be incomplete.',
          'Currency, exchange coverage and corporate-action adjustment are not verified by this tool.',
        ],
      };
    },
    async getMarketResearch(input) {
      const { query, history, totalRows } = await load(input);
      return {
        symbol: query.symbol,
        range: query.range,
        interval: '1d',
        generatedAt: now().toISOString(),
        truncated: totalRows > history.length,
        research: buildResearch(history, { interval: '1d', now: now(), currency: null }),
      };
    },
    getProviderStatus(input = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
        throw new Error('Provider status takes no arguments.');
      }
      return providerStatus();
    },
  };
}
