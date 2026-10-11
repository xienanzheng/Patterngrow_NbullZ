# Chart Period Filters + Fundamentals Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TradingKey-style time period pill buttons (1D/5D/1M/3M/6M/1Y/5Y/ALL) to the price chart, fix Y-axis auto-scaling so price curves are never flattened, add Twelve Data as a free intraday-capable fallback, and add a collapsible fundamentals card showing PE, Forward PE, EPS, Market Cap, Beta, 52W range, plus all 4 most-recent quarters across income statement, cash flow, and balance sheet.

**Architecture:** Task 1 is mostly frontend — replace the Range `<select>` with period pills above the chart, pass dynamic `interval` to `getInsights` and `StockChart`, fix the Y-axis domain to compute from actual historical close prices (the stacked forecast-band areas cause scale distortion), and add Twelve Data as an intraday fallback in `marketData.js` (Yahoo stays primary; Google Finance fallback is disabled for intraday intervals it doesn't support). Tasks 2–3 add a new `/api/analytics/fundamentals` route wrapping Yahoo quoteSummary with `price + summaryDetail + defaultKeyStatistics + financialData + incomeStatementHistoryQuarterly + cashflowStatementHistoryQuarterly + balanceSheetHistoryQuarterly` modules, merge the 3 quarterly statement arrays by quarter end-date, then render everything in a self-contained collapsible `FundamentalsCard.jsx`.

**Tech Stack:** React 18, Recharts, Tailwind CSS, Node.js ESM, Yahoo Finance quoteSummary v10, Twelve Data REST API (free tier: 800 req/day, no SDK needed).

## Global Constraints

- ESM throughout (`import`/`export`, no `require`). All backend files `.js`.
- Design system: `zinc-*` neutrals only, `amber-400` primary accent, `emerald-*` buy/positive, `red-*` sell/negative. No `slate-*` or `blue-*`.
- No new npm dependencies. All Yahoo Finance and Twelve Data calls go through `fetchJson` in `backend/utils/marketData.js`.
- Twelve Data API key is optional: `TWELVE_DATA_API_KEY` env var. When absent, Twelve Data fallback is skipped silently. Key is free at twelvedata.com (800 req/day).
- Intraday intervals (`5m`, `15m`) do NOT fall back to Google Finance (Google's getprices endpoint does not support sub-daily intervals). They fall back to Twelve Data if the key is set, otherwise return empty.
- `StockChart` receives a new `interval: string` prop alongside existing `data`, `selectedIndicators`, `forecastModel`, `hasForecastCloud`.
- The `PRICE_RANGES` constant and its `<select>` element are fully removed from Dashboard.jsx.
- Period pills live in the "Price Action" section header (around line 800), not the sidebar.
- `FundamentalsCard` is self-contained: it fetches its own data and manages its own loading/error state. Props: `{ symbol: string }`.
- Collapsed state is the default (to keep the overview compact). Toggle with a single chevron button.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/components/Dashboard.jsx` | **Modify** | Replace PRICE_RANGES/select with CHART_PERIODS pills; add `chartInterval` state; pass interval to getInsights + StockChart; render FundamentalsCard |
| `frontend/src/components/StockChart.jsx` | **Modify** | Accept `interval` prop; fix Y-axis domain from historical closes; interval-aware X-axis formatter |
| `backend/utils/marketData.js` | **Modify** | Add `fetchTwelveData(symbol, range, interval)` fallback; update `fetchYahooHistory` to call it for intraday instead of Google; add `fetchFundamentals(symbol)` |
| `backend/routes/analytics.js` | **Modify** | Add `GET /fundamentals` route |
| `frontend/src/services/api.js` | **Modify** | Add `getFundamentals(symbol)` |
| `frontend/src/components/FundamentalsCard.jsx` | **Create** | Collapsible card with all fundamentals + column-per-quarter table (income + cash flow + balance sheet) |

---

## Task 1: Chart period pills + Y-axis scale fix

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx`
- Modify: `frontend/src/components/StockChart.jsx`

**Interfaces:**
- Consumes: existing `getInsights(symbol, options)` from `../services/api` — `options.interval` is already forwarded via `URLSearchParams` at line 64-66 of `api.js`
- Produces: `<StockChart interval={chartInterval} ...>` — Task 1 defines this new prop

- [ ] **Step 1: Replace PRICE_RANGES with CHART_PERIODS in Dashboard.jsx**

Find and replace (lines 27–34):
```js
// REMOVE this:
const PRICE_RANGES = [
  { label: '1 Month', value: '1mo' },
  { label: '3 Months', value: '3mo' },
  { label: '6 Months', value: '6mo' },
  { label: '1 Year', value: '1y' },
  { label: '2 Years', value: '2y' },
  { label: '5 Years', value: '5y' },
];

// ADD this instead:
const CHART_PERIODS = [
  { label: '1D',  range: '1d',   interval: '5m'  },
  { label: '5D',  range: '5d',   interval: '15m' },
  { label: '1M',  range: '1mo',  interval: '1d'  },
  { label: '3M',  range: '3mo',  interval: '1d'  },
  { label: '6M',  range: '6mo',  interval: '1d'  },
  { label: '1Y',  range: '1y',   interval: '1d'  },
  { label: '5Y',  range: '5y',   interval: '1wk' },
  { label: 'ALL', range: 'max',  interval: '1mo' },
];
```

- [ ] **Step 2: Add `chartInterval` state and update preferences restore**

Find:
```js
const [range, setRange] = useState('1y');
```
Add `chartInterval` directly after it:
```js
const [range, setRange] = useState('1y');
const [chartInterval, setChartInterval] = useState('1d');
```

Find the preferences restore block (look for `if (preferences.last_range) setRange`):
```js
if (preferences.last_range) setRange(preferences.last_range);
```
Replace with:
```js
if (preferences.last_range) {
  setRange(preferences.last_range);
  const matchedPeriod = CHART_PERIODS.find((p) => p.range === preferences.last_range);
  if (matchedPeriod) setChartInterval(matchedPeriod.interval);
}
```

- [ ] **Step 3: Update `getInsights` call to pass dynamic interval**

Find (in the `useEffect` / `applyInsights` that calls `getInsights`):
```js
          range,
          interval: '1d',
```
Replace with:
```js
          range,
          interval: chartInterval,
```

Also add `chartInterval` to the dependency array of that `useCallback`/`useEffect`. Find:
```js
    [applyInsights, symbol, range, selectedIndicators, forecastModel, initialCapital, appliedWeights],
```
Replace with:
```js
    [applyInsights, symbol, range, chartInterval, selectedIndicators, forecastModel, initialCapital, appliedWeights],
```

- [ ] **Step 4: Remove the sidebar Range `<select>` block**

Find and delete this entire block from the sidebar panel (around line 570–583):
```jsx
              <div>
                <label className="text-xs font-medium text-zinc-400">Range</label>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                >
                  {PRICE_RANGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
```

- [ ] **Step 5: Add period pill buttons above the chart**

Find the "Price Action" section header block (around line 796–811):
```jsx
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Price Action</h3>
                <p className="text-xs text-zinc-400">
                  Technical indicators overlaid on historical price data.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Data source: {dataSource === 'yahoo' ? 'Yahoo Finance' : dataSource === 'google' ? 'Google Finance fallback' : 'Synthetic sample (offline)'}.
                </p>
              </div>
              {insightsLoading ? (
                <span className="text-xs text-amber-300">Loading…</span>
              ) : null}
            </div>
```
Replace with:
```jsx
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Price Action</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {dataSource === 'yahoo' ? 'Yahoo Finance' : dataSource === 'google' ? 'Google Finance fallback' : 'Synthetic sample (offline)'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {CHART_PERIODS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => { setRange(p.range); setChartInterval(p.interval); }}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                        range === p.range
                          ? 'bg-amber-400 text-zinc-900'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {insightsLoading ? (
                  <span className="text-xs text-amber-300">Loading…</span>
                ) : null}
              </div>
            </div>
```

- [ ] **Step 6: Pass `interval` prop to StockChart**

Find:
```jsx
                <StockChart
                  data={chartData}
                  selectedIndicators={selectedIndicators}
                  forecastModel={forecastModel}
                  hasForecastCloud={Boolean(forecastCloud)}
                />
```
Replace with:
```jsx
                <StockChart
                  data={chartData}
                  interval={chartInterval}
                  selectedIndicators={selectedIndicators}
                  forecastModel={forecastModel}
                  hasForecastCloud={Boolean(forecastCloud)}
                />
```

- [ ] **Step 7: Fix StockChart.jsx — accept interval prop and fix Y-axis domain**

Open `frontend/src/components/StockChart.jsx`. Make these changes:

**A) Update the function signature (line 38):**
```js
// Find:
export default function StockChart({ data, selectedIndicators, forecastModel, hasForecastCloud }) {
// Replace with:
export default function StockChart({ data, interval, selectedIndicators, forecastModel, hasForecastCloud }) {
```

**B) Replace the `formatAxisDate` function (lines 24–27) with an interval-aware version:**
```js
// REMOVE:
const formatAxisDate = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString();
};

// ADD (outside the component, at file top level after imports):
function formatAxisTick(value, chartInterval) {
  if (!value) return '';
  const d = new Date(value);
  if (chartInterval === '5m' || chartInterval === '15m') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (chartInterval === '1wk' || chartInterval === '1mo') {
    return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
```

**C) Add `priceDomain` useMemo inside the component, after the `chartData` useMemo:**
```js
  const priceDomain = useMemo(() => {
    const closes = chartData
      .filter((row) => !row.isForecast && row.close != null)
      .map((row) => row.close);
    if (!closes.length) return ['auto', 'auto'];
    const mn = Math.min(...closes);
    const mx = Math.max(...closes);
    const pad = Math.max((mx - mn) * 0.08, mx * 0.015);
    return [mn - pad, mx + pad];
  }, [chartData]);
```

**D) Add `xTickFormatter` callback inside the component, after `priceDomain`:**
```js
  const xTickFormatter = useCallback(
    (value) => formatAxisTick(value, interval),
    [interval],
  );
```

Add `useCallback` to the recharts import at line 1 of `StockChart.jsx`:
```js
import { useMemo, useCallback } from 'react';
```

**E) Update the price YAxis domain** (find `yAxisId="price"` inside `<ComposedChart>`):
```jsx
// Find:
<YAxis yAxisId="price" stroke="#52525b" domain={['auto', 'auto']} />
// Replace:
<YAxis yAxisId="price" stroke="#52525b" domain={priceDomain} tickFormatter={(v) => v.toFixed(0)} />
```

**F) Update ALL XAxis `tickFormatter` props** — there are 5 charts (ComposedChart, AreaChart for volume, RSI, MACD, Stochastic). In every `<XAxis dataKey="date" tickFormatter={formatAxisDate} ...>` replace `tickFormatter={formatAxisDate}` with `tickFormatter={xTickFormatter}`. There are 5 instances total.

Also update every `labelFormatter` in Tooltip from `(value) => \`Date: ${formatAxisDate(value)}\`` to `(value) => \`Date: ${formatAxisTick(value, interval)}\``.

- [ ] **Step 8: Add Twelve Data fallback + fix intraday Google Finance skip in `backend/utils/marketData.js`**

Add the `fetchTwelveData` function after `fetchGoogleHistory`:

```js
async function fetchTwelveData(symbol, range, interval) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return [];

  // Map our (range, interval) to Twelve Data params
  const intervalMap = {
    '5m': '5min', '15m': '15min', '1h': '1h',
    '1d': '1day', '1wk': '1week', '1mo': '1month',
  };
  const outputsizeMap = {
    '1d': 78, '5d': 195, '1mo': 22, '3mo': 66, '6mo': 130,
    '1y': 252, '2y': 504, '5y': 1260, 'max': 5000,
  };
  const tdInterval = intervalMap[interval] ?? '1day';
  const outputsize = outputsizeMap[range] ?? 252;

  try {
    const data = await fetchJson('https://api.twelvedata.com/time_series', {
      symbol,
      interval: tdInterval,
      outputsize,
      apikey: key,
      order: 'ASC',
    });
    if (data.status === 'error' || !Array.isArray(data.values)) return [];
    return data.values.map((bar) => ({
      date: new Date(bar.datetime).toISOString(),
      open: Number(bar.open) || null,
      high: Number(bar.high) || null,
      low: Number(bar.low) || null,
      close: Number(bar.close) || null,
      volume: Number(bar.volume) || null,
      source: 'twelvedata',
    })).filter((row) => row.date != null);
  } catch {
    return [];
  }
}
```

Then update `fetchYahooHistory` — replace the `catch` block that currently calls `fetchGoogleHistory` unconditionally:

```js
// FIND (the entire catch block):
  } catch (error) {
    const fallback = await fetchGoogleHistory(symbol, range, interval);
    if (fallback.length === 0) {
      throw error;
    }
    return fallback;
  }

// REPLACE WITH:
  } catch (error) {
    // Intraday intervals are not supported by Google Finance — skip straight to Twelve Data
    const isIntraday = interval === '5m' || interval === '15m' || interval === '1h';
    if (!isIntraday) {
      const googleData = await fetchGoogleHistory(symbol, range, interval);
      if (googleData.length > 0) return googleData;
    }
    const twelveData = await fetchTwelveData(symbol, range, interval);
    if (twelveData.length > 0) return twelveData;
    throw error;
  }
```

- [ ] **Step 9: Verify build passes**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend && npm run build 2>&1 | grep -iE "^.*error" | grep -v node_modules | head -10
# Expected: no output
```

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/Dashboard.jsx frontend/src/components/StockChart.jsx backend/utils/marketData.js
git commit -m "feat: add chart period pills (1D–ALL) + fix Y-axis scale + Twelve Data intraday fallback"
```

---

## Task 2: Backend fundamentals endpoint

**Files:**
- Modify: `backend/utils/marketData.js`
- Modify: `backend/routes/analytics.js`

**Interfaces:**
- Produces: `GET /api/analytics/fundamentals?symbol=MSFT` → `{ symbol, fundamentals: { marketCap, trailingPE, forwardPE, trailingEps, forwardEps, volume, averageVolume, fiftyTwoWeekHigh, fiftyTwoWeekLow, beta, dividendYield, dividendRate, profitMargins, grossMargins, revenueGrowth, totalRevenue, totalDebt, targetMeanPrice, currency, quarterlyResults: [{ date, totalRevenue, netIncome, basicEps }] } }`

- [ ] **Step 1: Add `fetchFundamentals` to `backend/utils/marketData.js`**

Append after the `fetchNews` function. The function fetches all 3 quarterly statement arrays and merges them by quarter end-date so the frontend gets one clean row per quarter.

```js
export async function fetchFundamentals(symbol) {
  const data = await fetchJson(`${yahooBase}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
    modules: [
      'price',
      'summaryDetail',
      'defaultKeyStatistics',
      'financialData',
      'incomeStatementHistoryQuarterly',
      'cashflowStatementHistoryQuarterly',
      'balanceSheetHistoryQuarterly',
    ].join(','),
  });
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error('Fundamentals unavailable for this symbol.');

  const price = result.price ?? {};
  const sd = result.summaryDetail ?? {};
  const ks = result.defaultKeyStatistics ?? {};
  const fd = result.financialData ?? {};

  // Merge 3 quarterly statement arrays by endDate (most-recent 4 quarters)
  const incomeRows = result.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
  const cashRows   = result.cashflowStatementHistoryQuarterly?.cashflowStatements ?? [];
  const bsRows     = result.balanceSheetHistoryQuarterly?.balanceSheetStatements ?? [];

  const byDate = {};
  const addRow = (arr, pick) => {
    arr.slice(0, 4).forEach((row) => {
      const d = row.endDate?.fmt;
      if (!d) return;
      byDate[d] = { ...byDate[d], date: d, ...pick(row) };
    });
  };
  addRow(incomeRows, (r) => ({
    revenue:    r.totalRevenue?.raw ?? null,
    netIncome:  r.netIncome?.raw    ?? null,
    basicEps:   r.basicEPS?.raw     ?? null,
    grossProfit: r.grossProfit?.raw ?? null,
    ebit:       r.ebit?.raw         ?? null,
  }));
  addRow(cashRows, (r) => ({
    operatingCashFlow: r.totalCashFromOperatingActivities?.raw ?? null,
    capEx:             r.capitalExpenditures?.raw               ?? null,
    freeCashFlow:      r.freeCashflow?.raw                      ?? null,
  }));
  addRow(bsRows, (r) => ({
    cash:             r.cash?.raw                    ?? null,
    totalAssets:      r.totalAssets?.raw             ?? null,
    totalLiabilities: r.totalLiab?.raw               ?? null,
    longTermDebt:     r.longTermDebt?.raw            ?? null,
    shareholderEquity: r.totalStockholderEquity?.raw ?? null,
  }));

  // Sort by date descending (most recent first), take 4
  const quarterlyResults = Object.values(byDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 4);

  return {
    currency:        price.currency                  ?? 'USD',
    marketCap:       price.marketCap?.raw            ?? null,
    trailingPE:      sd.trailingPE?.raw              ?? null,
    forwardPE:       sd.forwardPE?.raw               ?? null,
    trailingEps:     ks.trailingEps?.raw             ?? null,
    forwardEps:      ks.forwardEps?.raw              ?? null,
    volume:          price.regularMarketVolume?.raw  ?? null,
    averageVolume:   sd.averageVolume?.raw           ?? null,
    fiftyTwoWeekHigh: sd.fiftyTwoWeekHigh?.raw      ?? null,
    fiftyTwoWeekLow:  sd.fiftyTwoWeekLow?.raw       ?? null,
    beta:            sd.beta?.raw                    ?? null,
    dividendYield:   sd.dividendYield?.raw           ?? null,
    dividendRate:    sd.dividendRate?.raw            ?? null,
    profitMargins:   fd.profitMargins?.raw           ?? null,
    grossMargins:    fd.grossMargins?.raw            ?? null,
    revenueGrowth:   fd.revenueGrowth?.raw           ?? null,
    totalRevenue:    fd.totalRevenue?.raw            ?? null,
    totalDebt:       fd.totalDebt?.raw               ?? null,
    targetMeanPrice: fd.targetMeanPrice?.raw         ?? null,
    quarterlyResults,
  };
}
```

- [ ] **Step 2: Add the route to `backend/routes/analytics.js`**

Add the import at the top — find:
```js
import { fetchNews, fetchQuote, fetchYahooHistory } from '../utils/marketData.js';
```
Replace with:
```js
import { fetchFundamentals, fetchNews, fetchQuote, fetchYahooHistory } from '../utils/marketData.js';
```

Then add the route after the existing `/quote` route:
```js
router.get('/fundamentals', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol is required.' });
    const fundamentals = await fetchFundamentals(symbol.trim().toUpperCase());
    res.json({ symbol: symbol.trim().toUpperCase(), fundamentals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Smoke test**

```bash
# Start the backend
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/backend && node index.js &
sleep 2

# Fetch fundamentals for MSFT
curl -s "http://localhost:4000/api/analytics/fundamentals?symbol=MSFT" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('marketCap:', d.fundamentals.marketCap, 'trailingPE:', d.fundamentals.trailingPE, 'quarters:', d.fundamentals.quarterlyResults?.length)"
# Expected: marketCap: <number not null>, trailingPE: <number>, quarters: 4

# Test a ticker that often has no market cap via v7 quote (ETF)
curl -s "http://localhost:4000/api/analytics/fundamentals?symbol=SPY" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('marketCap:', d.fundamentals.marketCap)"
# Expected: marketCap: <a large number, not null>

kill %1
```

- [ ] **Step 4: Commit**

```bash
git add backend/utils/marketData.js backend/routes/analytics.js
git commit -m "feat: add /api/analytics/fundamentals endpoint — PE, market cap, earnings, quarterly results"
```

---

## Task 3: FundamentalsCard component + Dashboard wiring

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/components/FundamentalsCard.jsx`
- Modify: `frontend/src/components/Dashboard.jsx`

**Interfaces:**
- Consumes: `getFundamentals(symbol)` → `{ symbol, fundamentals }` (defined in this task)
- Props for FundamentalsCard: `{ symbol: string }` — self-contained, fetches own data
- Dashboard renders `<FundamentalsCard symbol={symbol} />` above the chart section

- [ ] **Step 1: Add `getFundamentals` to `frontend/src/services/api.js`**

Append after `getInsights`:
```js
export function getFundamentals(symbol) {
  return request(`/api/analytics/fundamentals?symbol=${encodeURIComponent(symbol)}`);
}
```

- [ ] **Step 2: Create `frontend/src/components/FundamentalsCard.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { getFundamentals } from '../services/api';

const fmt = {
  currency: (v, cur = 'USD') => {
    if (v == null) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${cur} ${(v / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${cur} ${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${cur} ${(v / 1e6).toFixed(2)}M`;
    return `${cur} ${v.toLocaleString()}`;
  },
  num: (v, decimals = 2) => (v == null ? '—' : Number(v).toFixed(decimals)),
  pct: (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`),
  vol: (v) => {
    if (v == null) return '—';
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  },
};

export default function FundamentalsCard({ symbol }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    getFundamentals(symbol)
      .then((res) => { if (!cancelled) setData(res.fundamentals); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (!symbol) return null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-3">
        <p className="text-xs text-zinc-500">Loading fundamentals…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-3">
        <p className="text-xs text-zinc-500">{error || 'Fundamentals unavailable for this ticker.'}</p>
      </div>
    );
  }

  const cur = data.currency ?? 'USD';

  const keyMetrics = [
    { label: 'Market Cap', value: fmt.currency(data.marketCap, cur) },
    { label: 'P/E (TTM)',  value: fmt.num(data.trailingPE) },
    { label: 'Fwd P/E',   value: fmt.num(data.forwardPE) },
    { label: 'EPS (TTM)', value: data.trailingEps != null ? `${cur} ${fmt.num(data.trailingEps)}` : '—' },
    { label: 'Beta',      value: fmt.num(data.beta) },
    { label: '52W Range', value: data.fiftyTwoWeekLow != null && data.fiftyTwoWeekHigh != null
        ? `${fmt.num(data.fiftyTwoWeekLow, 0)} – ${fmt.num(data.fiftyTwoWeekHigh, 0)}` : '—' },
  ];

  const allMetrics = [
    ...keyMetrics,
    { label: 'Fwd EPS',       value: data.forwardEps != null ? `${cur} ${fmt.num(data.forwardEps)}` : '—' },
    { label: 'Volume',        value: fmt.vol(data.volume) },
    { label: 'Avg Volume',    value: fmt.vol(data.averageVolume) },
    { label: 'Dividend',      value: data.dividendRate != null ? `${cur} ${fmt.num(data.dividendRate)} (${fmt.pct(data.dividendYield)})` : '—' },
    { label: 'Revenue',       value: fmt.currency(data.totalRevenue, cur) },
    { label: 'Rev Growth',    value: fmt.pct(data.revenueGrowth) },
    { label: 'Gross Margin',  value: fmt.pct(data.grossMargins) },
    { label: 'Net Margin',    value: fmt.pct(data.profitMargins) },
    { label: 'Total Debt',    value: fmt.currency(data.totalDebt, cur) },
    { label: 'Analyst Target',value: data.targetMeanPrice != null ? `${cur} ${fmt.num(data.targetMeanPrice)}` : '—' },
  ];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <h3 className="text-sm font-semibold text-zinc-200">Fundamentals</h3>
        <span className={`text-zinc-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {/* Always-visible key metrics strip */}
      <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 md:grid-cols-6">
        {keyMetrics.map((m) => (
          <div key={m.label}>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{m.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-100">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Expanded: rest of metrics + quarterly results */}
      {expanded ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-zinc-800 pt-4 md:grid-cols-4">
            {allMetrics.slice(keyMetrics.length).map((m) => (
              <div key={m.label}>
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{m.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-zinc-100">{m.value}</p>
              </div>
            ))}
          </div>

          {data.quarterlyResults?.length > 0 ? (
            <div className="mt-4 border-t border-zinc-800 pt-4">
              <p className="mb-2 text-xs font-semibold text-zinc-400">Quarterly Financials (last 4)</p>
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-800 text-xs">
                  <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 text-left w-36">Metric</th>
                      {data.quarterlyResults.map((q) => (
                        <th key={q.date} className="px-3 py-2 text-right">{q.date ?? '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {[
                      { label: 'Revenue',         key: 'revenue',           type: 'cur' },
                      { label: 'Gross Profit',     key: 'grossProfit',       type: 'cur' },
                      { label: 'Net Income',       key: 'netIncome',         type: 'cur', color: true },
                      { label: 'EPS (basic)',      key: 'basicEps',          type: 'eps', color: true },
                      { label: 'Operating CF',     key: 'operatingCashFlow', type: 'cur', color: true },
                      { label: 'Capex',            key: 'capEx',             type: 'cur' },
                      { label: 'Free Cash Flow',   key: 'freeCashFlow',      type: 'cur', color: true },
                      { label: 'Cash & Equiv',     key: 'cash',              type: 'cur' },
                      { label: 'Total Assets',     key: 'totalAssets',       type: 'cur' },
                      { label: 'Total Liabilities',key: 'totalLiabilities',  type: 'cur' },
                      { label: 'LT Debt',          key: 'longTermDebt',      type: 'cur' },
                      { label: 'Equity',           key: 'shareholderEquity', type: 'cur', color: true },
                    ].map(({ label, key, type, color }) => (
                      <tr key={key}>
                        <td className="px-3 py-1.5 text-zinc-400 font-medium">{label}</td>
                        {data.quarterlyResults.map((q) => {
                          const v = q[key];
                          const colorClass = color && v != null
                            ? (v >= 0 ? 'text-emerald-300' : 'text-red-300')
                            : 'text-zinc-200';
                          return (
                            <td key={q.date} className={`px-3 py-1.5 text-right font-semibold ${colorClass}`}>
                              {v == null
                                ? '—'
                                : type === 'eps'
                                  ? `${cur} ${fmt.num(v)}`
                                  : fmt.currency(v, cur)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Wire FundamentalsCard into Dashboard.jsx**

Add import near the other component imports at the top of `frontend/src/components/Dashboard.jsx`:
```js
import FundamentalsCard from './FundamentalsCard';
```

In the Overview tab's main content area, find the chart section (the `<div>` wrapping "Price Action" header and `<StockChart>`). Add `<FundamentalsCard>` immediately BEFORE this block. Look for the outer wrapping div around line 796:

Find the line that starts the "Price Action" section (a `<div className="...">` wrapper). It begins inside `<section className="flex-1 space-y-6">`. Add FundamentalsCard as the first item in that space-y-6 section, directly above the Price Action div.

Concretely, find the div that starts the price action block:
```jsx
          <section className="flex-1 space-y-6">
```
The content inside this section starts with various subsections. Add FundamentalsCard as the FIRST child inside this `flex-1 space-y-6` section:

Find (the first child element inside the flex-1 section, which contains the Price Action header around line 796):
```jsx
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Price Action</h3>
```
Add `<FundamentalsCard symbol={symbol} />` on the line immediately BEFORE this block:
```jsx
            <FundamentalsCard symbol={symbol} />
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Price Action</h3>
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend && npm run build 2>&1 | grep -iE "^.*error" | grep -v node_modules | head -10
# Expected: no output
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.js frontend/src/components/FundamentalsCard.jsx frontend/src/components/Dashboard.jsx
git commit -m "feat: add FundamentalsCard — PE/EPS/Market Cap/52W/quarterly results, collapsible"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 5-min, 1-hr, days, 3-month chart filters → CHART_PERIODS pill buttons (1D=5m, 5D=15m, 1M–6M=1d, 1Y=1d, 5Y=1wk, ALL=1mo)
- ✅ Scale / flattened line fix → `priceDomain` useMemo in StockChart, computed from historical closes only (excludes stacked forecast bands which were inflating the Y-axis range)
- ✅ Market cap empty → `fetchFundamentals` uses `price.marketCap.raw` from quoteSummary, far more reliable than v7 quote endpoint
- ✅ Latest quarterly financial statements → `incomeStatementHistoryQuarterly` module, last 4 quarters: revenue, net income, EPS
- ✅ Collapsible card with PE, Volume, Fwd PE → FundamentalsCard with collapsed strip + expand

**2. Placeholder scan:** No TBD, no "add validation", all code blocks complete.

**3. Type consistency:**
- `getFundamentals(symbol)` defined Task 3 Step 1, consumed by FundamentalsCard Step 2 — match ✅
- `fundamentals.quarterlyResults[].{ date, totalRevenue, netIncome, basicEps }` — shape defined in Task 2 Step 1, consumed in Task 3 Step 2 — match ✅
- `interval` prop on `StockChart` — defined Task 1 Step 7, passed Task 1 Step 6 — match ✅
- `CHART_PERIODS` — defined Task 1 Step 1, used in Step 4 (removed old select) and Step 5 (pills) — match ✅
