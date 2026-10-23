// Shared, bounded handlers for the local read-only MCP surface.
export const HISTORY_RANGES = ['1mo', '3mo', '6mo', '1y', '2y'];
export const MAX_HISTORY_ROWS = 520;
export const MAX_OVERVIEW_ROWS = 6;
export const MAX_RESPONSE_BYTES = 256_000;
const PROVIDER_IDS = new Set(['yahoo', 'google', 'twelvedata', 'massive', 'polygon']);
const OVERVIEW_SYMBOLS = new Set(['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'USO']);

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
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function noArguments(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) {
    throw new Error('This tool takes no arguments.');
  }
}

function pickFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]));
}

function snapshotCache(snapshot) {
  return {
    fetchedAt: typeof snapshot?.fetchedAt === 'string' && Number.isFinite(Date.parse(snapshot.fetchedAt))
      ? new Date(snapshot.fetchedAt).toISOString() : null,
    cache: {
      hit: snapshot?.cache?.hit === true,
      ttlSeconds: finiteOrNull(snapshot?.cache?.ttlSeconds),
    },
  };
}

function publicResearch(research) {
  const output = pickFields(research, ['volume', 'risk', 'quality', 'metadata', 'definitions', 'dataVersion', 'version']);
  if (Array.isArray(research?.series)) output.series = publicRows(research.series);
  return output;
}

function comparisonInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['symbol', 'benchmark', 'range'].includes(key))) {
    throw new Error('Invalid comparison input.');
  }
  const { symbol, range } = normalizeInput(pickFields(input, ['symbol', 'range']));
  const { symbol: benchmark } = normalizeInput({ symbol: input.benchmark ?? 'SPY' });
  return { symbol, benchmark, range, interval: '1d' };
}

function publicComparison(snapshot) {
  const comparison = snapshot?.comparison;
  if (!comparison || !Array.isArray(comparison.series) || comparison.series.length > MAX_HISTORY_ROWS) {
    throw new Error('Invalid comparison response.');
  }
  return {
    ...pickFields(comparison, ['metrics', 'sample', 'metadata', 'quality', 'definitions', 'dataVersion', 'version']),
    series: comparison.series.map((row) => ({
      date: typeof row?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null,
      ...Object.fromEntries(['symbolClose', 'benchmarkClose', 'symbolIndex', 'benchmarkIndex', 'relativePerformancePp', 'rollingCorrelation20']
        .map((field) => [field, finiteOrNull(row?.[field])])),
    })),
  };
}

function publicOverview(snapshot) {
  if (!Array.isArray(snapshot?.rows) || snapshot.rows.length !== MAX_OVERVIEW_ROWS
    || new Set(snapshot.rows.map((row) => row?.symbol)).size !== MAX_OVERVIEW_ROWS
    || snapshot.rows.some((row) => !OVERVIEW_SYMBOLS.has(row?.symbol))) {
    throw new Error('Invalid overview response.');
  }
  return {
    ...pickFields(snapshot, ['interval', 'range', 'generatedAt', 'status', 'coverage', 'warnings', 'cache', 'metadata', 'definitions', 'dataVersion', 'version']),
    rows: snapshot.rows.map((row) => ({
      ...pickFields(row, [
        'symbol', 'name', 'description', 'currency', 'asOf', 'asOfPrecision', 'sessionDate', 'exchangeTimezone',
        'fetchedAt', 'source', 'status', 'warnings',
      ]),
      ...Object.fromEntries(['latestClose', 'return1', 'return5', 'return20', 'relativeVolume20']
        .map((field) => [field, finiteOrNull(row?.[field])])),
      sparkline: Array.isArray(row?.sparkline) ? row.sparkline.slice(-20).map((point) => ({
        date: typeof point?.date === 'string' && Number.isFinite(Date.parse(point.date)) ? new Date(point.date).toISOString() : null,
        close: finiteOrNull(point?.close),
      })) : [],
    })),
  };
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

export function createResearchTools({
  fetchHistory, buildResearch, providerStatus, getResearchSnapshot, getComparisonSnapshot, getMarketOverview,
  timeoutMs = 26_000, now = () => new Date(),
}) {
  let activeOperations = 0;

  async function bounded(operation) {
    if (activeOperations >= 2) throw new Error('Market data requests are busy.');
    activeOperations += 1;
    let timer;
    // Keep the slot occupied until the provider actually settles, including after a caller deadline.
    const work = Promise.resolve()
      .then(operation)
      .finally(() => { activeOperations -= 1; });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Market data deadline exceeded.')), timeoutMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(input) {
    const query = normalizeInput(input);
    return bounded(async () => {
      const snapshot = getResearchSnapshot
        ? await getResearchSnapshot({ symbol: query.symbol, range: query.range, interval: '1d' }) : null;
      const rows = snapshot ? snapshot.history : await fetchHistory(query.symbol, query.range, '1d');
      const history = publicRows(rows);
      // Reuse the service's quality findings, including discarded-input counts.
      // Recalculate only when its sample exceeds this surface's tighter 520-bar cap.
      const research = rows.length <= MAX_HISTORY_ROWS && Array.isArray(snapshot?.research?.series)
        && snapshot.research.series.length <= MAX_HISTORY_ROWS ? snapshot.research : null;
      return { query, history, totalRows: rows.length, snapshot, research };
    });
  }

  return {
    async getMarketHistory(input) {
      const { query, history, totalRows, snapshot } = await load(input);
      return {
        symbol: query.symbol,
        range: query.range,
        interval: '1d',
        generatedAt: now().toISOString(),
        ...snapshotCache(snapshot),
        sources: [...new Set(history.map((row) => row.source))],
        returnedRows: Math.min(query.limit, history.length),
        truncated: totalRows > query.limit || history.some((row) => row.historyMayBeTruncated),
        history: history.slice(-query.limit),
        notes: [
          'Historical daily observations; the latest daily bar may be incomplete.',
          'Currency, exchange coverage and corporate-action adjustment are not verified by this tool.',
        ],
      };
    },
    async getMarketResearch(input) {
      const { query, history, totalRows, snapshot, research } = await load(input);
      return {
        symbol: query.symbol,
        range: query.range,
        interval: '1d',
        generatedAt: now().toISOString(),
        ...snapshotCache(snapshot),
        truncated: totalRows > history.length || history.some((row) => row.historyMayBeTruncated),
        research: publicResearch(research ?? buildResearch(history, { interval: '1d', now: now(), currency: null })),
      };
    },
    async getMarketComparison(input) {
      const query = comparisonInput(input);
      return bounded(async () => {
        const snapshot = await getComparisonSnapshot(query);
        return {
          ...query,
          generatedAt: now().toISOString(),
          fetchedAt: pickFields(snapshot?.fetchedAt, ['symbol', 'benchmark']),
          comparison: publicComparison(snapshot),
        };
      });
    },
    async getMarketOverview(input = {}) {
      noArguments(input);
      return bounded(async () => publicOverview(await getMarketOverview()));
    },
    getProviderStatus(input = {}) {
      noArguments(input);
      return providerStatus();
    },
  };
}
