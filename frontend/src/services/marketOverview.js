const rawBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
const apiBase = rawBase === '' || rawBase === '/' ? '' : rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
const path = '/api/analytics/overview';
const endpoint = !apiBase || (apiBase.startsWith('/') && path.startsWith(apiBase)) ? path : `${apiBase}${path}`;

export async function getMarketOverview({ signal } = {}) {
  const response = await fetch(endpoint, { signal, credentials: 'include', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Market overview could not be loaded. Please retry.');
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.rows) || !payload.coverage) throw new Error('Market overview data is unavailable. Please retry.');
  return payload;
}
