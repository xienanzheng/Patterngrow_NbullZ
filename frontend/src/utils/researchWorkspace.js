export const RESEARCH_RANGES = ['1mo', '3mo', '6mo', '1y', '2y'];
export const RESEARCH_VIEWS = ['price', 'compare', 'fundamentals', 'sources'];
export const WORKSPACE_STORAGE_KEY = 'patterngrow.research.views.v1';
export const MAX_SAVED_VIEWS = 12;

export function normalizeResearchSymbol(value, fallback = 'AAPL') {
  const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9.^=-]{1,20}$/.test(symbol) ? symbol : fallback;
}

export function normalizeWorkspace(value = {}) {
  return {
    symbol: normalizeResearchSymbol(value.symbol),
    benchmark: normalizeResearchSymbol(value.benchmark, 'SPY'),
    range: RESEARCH_RANGES.includes(value.range) ? value.range : '1y',
    view: RESEARCH_VIEWS.includes(value.view) ? value.view : 'price',
  };
}

export function workspaceQuery(value) {
  return new URLSearchParams(normalizeWorkspace(value)).toString();
}

export function researchSessionDate(row) {
  if (typeof row?.date !== 'string' || !Number.isFinite(Date.parse(row.date))) return null;
  if (['date', 'session-date'].includes(row.datePrecision) || /^\d{4}-\d{2}-\d{2}$/.test(row.date)) return row.date.slice(0, 10);
  if (!row.exchangeTimezone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: row.exchangeTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(row.date));
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return null; }
}

export function readSavedViews(storage) {
  try {
    const raw = storage?.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw || raw.length > 20_000) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item)
      && normalizeResearchSymbol(item.symbol, null) && normalizeResearchSymbol(item.benchmark, null)
      && RESEARCH_RANGES.includes(item.range) && RESEARCH_VIEWS.includes(item.view))
      .map(normalizeWorkspace).filter((item) => {
        const id = workspaceQuery(item);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, MAX_SAVED_VIEWS);
  } catch {
    return [];
  }
}

export function saveWorkspaceView(views, value) {
  const normalized = normalizeWorkspace(value);
  const key = workspaceQuery(normalized);
  return [normalized, ...views.filter((item) => workspaceQuery(item) !== key)].slice(0, MAX_SAVED_VIEWS);
}

export function historyCsv(payload) {
  const fields = ['date', 'open', 'high', 'low', 'close', 'volume', 'source', 'currency', 'datePrecision', 'exchangeTimezone'];
  const escape = (value) => {
    const text = String(value ?? '');
    const safe = /^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [fields.join(','), ...(payload.history ?? []).map((row) => fields.map((field) => escape(row[field])).join(','))].join('\r\n');
}

export function researchSnapshot(payload, workspace, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: 'patterngrow.research-snapshot.v1',
    exportedAt,
    workspace: normalizeWorkspace(workspace),
    dataset: payload,
    notes: [
      'Snapshot of the returned daily dataset and calculation definitions, not a subscription to updates.',
      'Price returns exclude cash distributions. Feed delay, corporate-action adjustments and session completeness may be unverified.',
    ],
  };
}

export function downloadResearchFile(text, filename, type) {
  const href = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
