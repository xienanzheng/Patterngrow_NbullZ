const rawBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
const apiBase =
  rawBase === '' || rawBase === '/'
    ? ''
    : rawBase.endsWith('/') && rawBase.length > 1
      ? rawBase.slice(0, -1)
      : rawBase;

function buildUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!apiBase) {
    return normalizedPath;
  }
  if (apiBase.startsWith('/') && normalizedPath.startsWith(apiBase)) {
    return normalizedPath;
  }
  return `${apiBase}${normalizedPath}`;
}

async function parseJson(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function request(path, { method = 'GET', body, token, headers, signal } = {}) {
  const response = await fetch(buildUrl(path), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    signal,
    credentials: 'include',
  });

  if (!response.ok) {
    const errorBody = await parseJson(response);
    const message = errorBody?.error ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return parseJson(response);
}

export function getQuote(symbol) {
  return request(`/api/analytics/quote?symbol=${encodeURIComponent(symbol)}`);
}

export function getHistory(symbol, { range = '1y', interval = '1d' } = {}) {
  const params = new URLSearchParams({ symbol, range, interval });
  return request(`/api/analytics/history?${params.toString()}`);
}

export function getNews(symbol) {
  return request(`/api/analytics/news?symbol=${encodeURIComponent(symbol)}`);
}

export function getInsights(symbol, options = {}) {
  const params = new URLSearchParams({ symbol });
  Object.entries(options).forEach(([key, value]) => {
    if (value == null) return;
    params.set(key, value);
  });
  return request(`/api/analytics/insights?${params.toString()}`);
}

export function getMetadata(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value == null || value === '') return;
    params.set(key, value);
  });
  const query = params.toString();
  const path = query ? `/api/analytics/metadata?${query}` : '/api/analytics/metadata';
  return request(path);
}

export function getWatchlist(token) {
  return request('/api/watchlist', { token });
}

export function addWatchlistSymbol(symbol, token) {
  return request('/api/watchlist', {
    method: 'POST',
    body: { symbol },
    token,
  });
}

export function removeWatchlistSymbol(id, token) {
  return request(`/api/watchlist/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  });
}

export function postChatMessage({ prompt, provider, model, apiKey, temperature }) {
  return request('/api/analytics/chat', {
    method: 'POST',
    body: {
      prompt,
      provider,
      model,
      apiKey,
      temperature,
    },
  });
}
