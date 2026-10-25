import { supabaseAdmin } from './supabaseClient.js';

export const RECORDED_HISTORY_LIMIT = 60;
const READ_TIMEOUT_MS = 5000;
const VOTE_KEYS = ['sma', 'rsi', 'macd', 'bollinger', 'stochastic', 'adx'];
const LABELS = new Set(['Strong Buy', 'Medium Buy', 'Buy', 'Neutral', 'Sell', 'Medium Sell', 'Strong Sell']);
const MODELS = new Set(['simple', 'drift', 'ar', 'arima', 'holt', 'prophet', 'montecarlo']);

export function validateRecordedHistoryQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some((key) => key !== 'symbol')
    || typeof query.symbol !== 'string' || query.symbol.length > 64
    || !/^[A-Z0-9.^=-]{1,20}$/i.test(query.symbol.trim())) {
    const error = new Error('Provide one valid symbol only.');
    error.code = 'INVALID_RECORDED_HISTORY_QUERY';
    throw error;
  }
  return query.symbol.trim().toUpperCase();
}

function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && (!value.trim() || value.length > 64)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !validDate(value.slice(0, 10))) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function safeVotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(VOTE_KEYS.map((key) => [key, [-1, 0, 1].includes(value[key]) ? value[key] : null]));
}

function decisionRow(row) {
  const decisionDate = validDate(row?.decision_date);
  if (!decisionDate) return null;
  return {
    decisionDate,
    createdAt: validTimestamp(row.created_at),
    label: LABELS.has(row.conviction_label) ? row.conviction_label : null,
    score: finiteNumber(row.conviction_score),
    votes: safeVotes(row.votes),
  };
}

function forecastRow(row) {
  const snapshotDate = validDate(row?.snapshot_date);
  if (!snapshotDate) return null;
  const horizon = finiteNumber(row.horizon);
  return {
    snapshotDate,
    createdAt: validTimestamp(row.created_at),
    model: MODELS.has(row.forecast_model) ? row.forecast_model : null,
    horizon: Number.isInteger(horizon) && horizon > 0 && horizon <= 365 ? horizon : null,
    label: LABELS.has(row.conviction_label) ? row.conviction_label : null,
    score: finiteNumber(row.conviction_score),
    lastClose: finiteNumber(row.last_close),
  };
}

// The client and deadline are injected only by server-side callers/tests. Query
// parameters cannot select tables, fields, row limits, timeouts, or URLs.
export function createRecordedHistoryReader({ client = supabaseAdmin, timeoutMs = READ_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > READ_TIMEOUT_MS) {
    throw new TypeError('Archive read timeout must be between 1 and 5000 milliseconds.');
  }

  async function readTable(symbol, table, fields, dateField, sanitize) {
    if (!client) return { status: 'not_configured', rows: [] };
    const controller = new AbortController();
    let timer;
    try {
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ error: true });
        }, timeoutMs);
      });
      const operation = Promise.resolve().then(() => client.from(table)
        .select(fields)
        .eq('symbol', symbol)
        .order(dateField, { ascending: false })
        .limit(RECORDED_HISTORY_LIMIT)
        .abortSignal(controller.signal));
      const result = await Promise.race([operation, deadline]);
      if (result?.error || !Array.isArray(result?.data)) return { status: 'unavailable', rows: [] };
      return {
        status: 'available',
        rows: result.data.slice(0, RECORDED_HISTORY_LIMIT).map(sanitize).filter(Boolean),
      };
    } catch {
      return { status: 'unavailable', rows: [] };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  return async function getRecordedHistory(query) {
    const symbol = validateRecordedHistoryQuery(query);
    const [decisionLog, forecastLog] = await Promise.all([
      readTable(symbol, 'decision_log', 'decision_date,created_at,conviction_label,conviction_score,votes', 'decision_date', decisionRow),
      readTable(symbol, 'forecast_log', 'snapshot_date,created_at,forecast_model,horizon,conviction_label,conviction_score,last_close', 'snapshot_date', forecastRow),
    ]);
    const notes = [
      'These are shared symbol records, not account-specific history. Each source returns at most 60 rows.',
      'Daily ratings cover only symbols included in the daily summary. Missing dates do not imply a neutral rating.',
      'Daily-rating scores were stored to three decimal places; their displayed precision can obscure the threshold distinction behind a recorded label.',
      'Forecast records can be replaced by later requests for the same symbol, UTC date and model, including requests with different settings. Their creation time is not proof of the latest replacement time.',
      'Recorded dates use the legacy UTC recording day; they do not verify the market session or a completed daily bar. Original inputs, settings and calculation versions were not retained.',
    ];
    if ([decisionLog, forecastLog].some((source) => source.status === 'not_configured')) {
      notes.push('Persistent storage is not configured on this server. No stored history was read.');
    }
    if ([decisionLog, forecastLog].some((source) => source.status === 'unavailable')) {
      notes.push('A history source could not be read. This does not establish that its history is empty.');
    }
    return {
      symbol,
      decisionLog: { ...decisionLog, coverage: 'daily_summary_only', sameDayPolicy: 'first_observation' },
      forecastLog: { ...forecastLog, sameDayPolicy: 'replaces_same_day_model' },
      notes,
    };
  };
}

export const getRecordedHistory = createRecordedHistoryReader();
