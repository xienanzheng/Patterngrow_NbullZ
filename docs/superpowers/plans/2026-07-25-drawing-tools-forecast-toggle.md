# Chart Drawing Tools, Forecast Toggle & Polygon Reference Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users draw freehand trend lines directly on the price chart, toggle the AI prediction overlay on/off with a button, and enrich the Fundamentals card with Polygon.io company reference data (description, exchange, employees, homepage).

**Architecture:** Three independent tasks. Task 1 adds a soft-fail Polygon.io backend endpoint and threads the company description into `FundamentalsCard`'s expanded section. Task 2 adds a `showForecast` boolean to Dashboard + StockChart that hides/shows all forecast cone elements with a single toggle button. Task 3 is the drawing layer: Dashboard holds `drawingMode`, `drawnLines`, `pendingPoint`, and `hoverPoint` state; captures data-space coordinates via Recharts `onMouseMove`/`onClick` events; passes them to StockChart which renders them via a Recharts `Customized` SVG overlay. Lines are stored as `{id, x1, y1, x2, y2}` where x is a date string (snapped to data) and y is a price float (computed from `chartY` pixel via `priceDomain`). Deleting a line requires clicking its wide transparent hit-target. An "Overlay Prediction" button in the drawing toolbar re-enables the forecast when it was hidden.

**Tech Stack:** React 18 + Recharts 3.3.0, Node.js ESM, Polygon.io REST API (`api.polygon.io/v3/reference/tickers/{ticker}`), Tailwind CSS.

## Global Constraints

- ESM throughout (`import`/`export`, no `require`). All backend files `.js`.
- Design system: `zinc-*` neutrals only, `amber-400` primary accent (active state / drawing mode), `emerald-*` positive, `red-*` negative. No `slate-*` or `blue-*`.
- No new npm dependencies — all HTTP calls use the existing `fetchJson` helper in `backend/utils/marketData.js`.
- Polygon.io API key is optional: `POLYGON_API_KEY` env var. When absent, `fetchPolygonDetails` returns `null` and the company section is simply omitted. Key is free at polygon.io.
- `showForecast` defaults to `true` (forecast visible on load).
- Drawing mode is off by default. Lines reset when `symbol` changes.
- Lines are stored in **data-space** (date string + price float) so they stay anchored to the correct position if the chart resizes.
- The `Customized` Recharts component used for line rendering in Task 3 uses `xAxisMap?.[0]?.scale` and `yAxisMap?.['price']?.scale` (Recharts 3.x forwards these as props). If they are unavailable, the overlay renders nothing — it does NOT crash.
- The price-chart container has `h-[360px]`. The coordinate formula for `chartY → price` uses: `PLOT_TOP = 5`, `PLOT_HEIGHT = 320` (360 - 5 top - 5 bottom - 30 xAxis). These constants may need tuning ±5px if the overlay appears slightly offset.
- `StockChart` props added in Task 2: `showForecast?: boolean = true`.
- `StockChart` props added in Task 3: `drawingMode`, `drawnLines`, `pendingPoint`, `hoverPoint`, `onChartClick`, `onChartMouseMove`, `onLineDelete`.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `backend/utils/marketData.js` | Modify | Add `fetchPolygonDetails(symbol)` |
| `backend/routes/analytics.js` | Modify | Add `GET /company` route |
| `frontend/src/services/api.js` | Modify | Add `getCompanyDetails(symbol)` |
| `frontend/src/components/FundamentalsCard.jsx` | Modify | Add company description block in expanded section |
| `frontend/src/components/StockChart.jsx` | Modify | Add `showForecast` prop (Task 2) + drawing props + `Customized` line overlay (Task 3) |
| `frontend/src/components/Dashboard.jsx` | Modify | Add `showForecast` toggle button (Task 2) + drawing state, handlers, toolbar (Task 3) |

---

## Task 1: Polygon.io company reference data

**Files:**
- Modify: `backend/utils/marketData.js`
- Modify: `backend/routes/analytics.js`
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/components/FundamentalsCard.jsx`

**Interfaces:**
- Produces: `GET /api/analytics/company?symbol=MSFT` → `{ symbol: 'MSFT', details: { name, description, exchange, type, sic, employees, homepage, listDate } | null }`
- `FundamentalsCard` calls `getCompanyDetails(symbol)` independently (self-contained, like the existing `getFundamentals` call)

- [ ] **Step 1: Add `fetchPolygonDetails` to `backend/utils/marketData.js`**

Append after the `fetchNews` function (before `fetchGoogleHistory`):

```js
export async function fetchPolygonDetails(symbol) {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  try {
    const data = await fetchJson(
      `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol.toUpperCase())}`,
      { apiKey: key },
    );
    const r = data?.results;
    if (!r) return null;
    return {
      name:        r.name             ?? null,
      description: r.description      ?? null,
      exchange:    r.primary_exchange  ?? null,
      type:        r.type              ?? null,
      sic:         r.sic_description   ?? null,
      employees:   r.total_employees   ?? null,
      homepage:    r.homepage_url      ?? null,
      listDate:    r.list_date         ?? null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add `GET /company` route to `backend/routes/analytics.js`**

Add `fetchPolygonDetails` to the import at the top:

```js
// Find:
import { fetchFundamentals, fetchNews, fetchQuote, fetchYahooHistory } from '../utils/marketData.js';
// Replace with:
import { fetchFundamentals, fetchNews, fetchPolygonDetails, fetchQuote, fetchYahooHistory } from '../utils/marketData.js';
```

Then add the route after the existing `/fundamentals` route:

```js
router.get('/company', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol is required.' });
    const details = await fetchPolygonDetails(symbol.trim().toUpperCase());
    res.json({ symbol: symbol.trim().toUpperCase(), details });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 3: Add `getCompanyDetails` to `frontend/src/services/api.js`**

Append after `getFundamentals`:

```js
export function getCompanyDetails(symbol) {
  return request(`/api/analytics/company?symbol=${encodeURIComponent(symbol)}`);
}
```

- [ ] **Step 4: Add company section to `FundamentalsCard.jsx`**

Open `frontend/src/components/FundamentalsCard.jsx`. Make these changes:

**A) Update the import** to include `getCompanyDetails`:
```js
// Find:
import { getFundamentals } from '../services/api';
// Replace:
import { getCompanyDetails, getFundamentals } from '../services/api';
```

**B) Add company state** inside the `FundamentalsCard` component, right after the existing `useState` hooks:
```js
const [company, setCompany] = useState(null);

useEffect(() => {
  if (!symbol) return;
  let cancelled = false;
  getCompanyDetails(symbol)
    .then((res) => { if (!cancelled) setCompany(res.details); })
    .catch(() => { if (!cancelled) setCompany(null); });
  return () => { cancelled = true; };
}, [symbol]);
```

**C) Add the company block inside the `{expanded ? (...) : null}` block**, immediately BEFORE the quarterly table `div`. Find:

```jsx
          {data.quarterlyResults?.length > 0 ? (
            <div className="mt-4 border-t border-zinc-800 pt-4">
```

Insert before it:
```jsx
          {company?.description ? (
            <div className="mt-4 border-t border-zinc-800 pt-4">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">About</p>
              <p className="text-xs leading-relaxed text-zinc-300 line-clamp-4">{company.description}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                {company.exchange ? <span>Exchange: <span className="text-zinc-300">{company.exchange}</span></span> : null}
                {company.sic ? <span>Sector: <span className="text-zinc-300">{company.sic}</span></span> : null}
                {company.employees ? <span>Employees: <span className="text-zinc-300">{Number(company.employees).toLocaleString()}</span></span> : null}
                {company.listDate ? <span>Listed: <span className="text-zinc-300">{company.listDate}</span></span> : null}
                {company.homepage ? (
                  <a href={company.homepage} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
                    {new URL(company.homepage).hostname}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
```

- [ ] **Step 5: Smoke test (requires POLYGON_API_KEY set)**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/backend && node index.js &
sleep 2

# Test with key set:
POLYGON_API_KEY=YOUR_KEY curl -s "http://localhost:4000/api/analytics/company?symbol=AAPL" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('name:', d.details?.name, 'desc length:', d.details?.description?.length, 'exchange:', d.details?.exchange);
"
# Expected: name: Apple Inc. desc length: <number> exchange: XNAS

# Test without key (should return {symbol, details: null}):
curl -s "http://localhost:4000/api/analytics/company?symbol=AAPL"
# Expected: {"symbol":"AAPL","details":null}

kill %1
```

- [ ] **Step 6: Verify frontend build**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend && npm run build 2>&1 | grep -iE "error" | grep -v node_modules | head -5
# Expected: no output
```

- [ ] **Step 7: Commit**

```bash
git add backend/utils/marketData.js backend/routes/analytics.js \
        frontend/src/services/api.js frontend/src/components/FundamentalsCard.jsx
git commit -m "feat: add Polygon.io company reference data — description, exchange, employees in FundamentalsCard"
```

---

## Task 2: Prediction overlay toggle button

**Files:**
- Modify: `frontend/src/components/StockChart.jsx`
- Modify: `frontend/src/components/Dashboard.jsx`

**Interfaces:**
- Consumes: `showForecast: boolean` prop on StockChart (default `true`)
- Produces: `showForecast` state in Dashboard, toggle button next to period pills

- [ ] **Step 1: Add `showForecast` prop to StockChart**

In `frontend/src/components/StockChart.jsx`:

**A) Update the function signature** (line 45):
```js
// Find:
export default function StockChart({ data, interval, selectedIndicators, forecastModel, hasForecastCloud }) {
// Replace:
export default function StockChart({ data, interval, selectedIndicators, forecastModel, hasForecastCloud, showForecast = true }) {
```

**B) Gate ALL forecast rendering on `showForecast`.**

Find the block:
```jsx
            {forecastStartIndex > -1 ? (
              <>
                {/* 95% confidence band (outer) — stacked area trick */}
```

Replace `{forecastStartIndex > -1 ? (` with:
```jsx
            {showForecast && forecastStartIndex > -1 ? (
```

Find:
```jsx
                {hasForecastCloud ? (
```
Replace with:
```jsx
                {showForecast && hasForecastCloud ? (
```

- [ ] **Step 2: Add `showForecast` state + toggle button to Dashboard.jsx**

In `frontend/src/components/Dashboard.jsx`:

**A) Add state** — find the line with `const [forecastModel, setForecastModel] = useState('drift');` and add after it:
```js
const [showForecast, setShowForecast] = useState(true);
```

**B) Pass `showForecast` to StockChart** — find:
```jsx
                <StockChart
                  data={chartData}
                  interval={chartInterval}
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
                  showForecast={showForecast}
                />
```

**C) Add the toggle button** next to the period pills. Find the period pills row:
```jsx
                <div className="flex flex-wrap gap-1">
                  {CHART_PERIODS.map((p) => (
```
Add a "Forecast" button AFTER the closing `</div>` of the CHART_PERIODS pill group (and before the `{insightsLoading ? ...}` span). Find:
```jsx
                </div>
                {insightsLoading ? (
                  <span className="text-xs text-amber-300">Loading…</span>
                ) : null}
```
Replace with:
```jsx
                </div>
                <button
                  type="button"
                  onClick={() => setShowForecast((v) => !v)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    showForecast
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  Forecast
                </button>
                {insightsLoading ? (
                  <span className="text-xs text-amber-300">Loading…</span>
                ) : null}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend && npm run build 2>&1 | grep -iE "error" | grep -v node_modules | head -5
# Expected: no output
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/StockChart.jsx frontend/src/components/Dashboard.jsx
git commit -m "feat: add forecast overlay toggle button — show/hide prediction cone from chart header"
```

---

## Task 3: User-drawn trend lines

**Files:**
- Modify: `frontend/src/components/StockChart.jsx`
- Modify: `frontend/src/components/Dashboard.jsx`

**Interfaces:**
- New StockChart props: `drawingMode: boolean`, `drawnLines: Array<{id, x1, y1, x2, y2}>`, `pendingPoint: {x, y}|null`, `hoverPoint: {x, y}|null`, `onChartClick: (rechartsData) => void`, `onChartMouseMove: (rechartsData) => void`, `onLineDelete: (id: string) => void`
- Dashboard exports: drawing toolbar rendered inside the "Price Action" card header area (second row below the period pills)
- Lines stored as: `{ id: string, x1: string (date), y1: number (price), x2: string (date), y2: number (price) }`

### Coordinate system

The main ComposedChart in StockChart:
- Outer container height: `360px` (class `h-[360px]`)
- Recharts default `margin` (when none specified): `{ top: 5, right: 5, bottom: 5, left: 5 }`
- XAxis at bottom adds approximately `30px`
- **Plot area height ≈ 360 − 5 − 5 − 30 = 320px** → constant `PLOT_HEIGHT = 320`
- **Plot area top ≈ 5px** → constant `PLOT_TOP = 5`

For `chartY → price`:
```js
price = priceDomain[1] - ((chartY - PLOT_TOP) / PLOT_HEIGHT) * (priceDomain[1] - priceDomain[0])
```

`priceDomain` is computed in Dashboard (same formula as StockChart, from `chartData` non-forecast closes).

For `price → chartY` (rendering via Recharts `Customized`): use the y-axis scale from Recharts internals (`yAxisMap['price'].scale`). This avoids the reverse formula and stays pixel-perfect even if the constants above are slightly off.

### Customized line overlay

Recharts `Customized` component (add `Customized` to the Recharts import) is placed as the LAST child of the main `ComposedChart`. It receives all Recharts internal props including `xAxisMap`, `yAxisMap`, and `offset`, plus any custom props passed to `<Customized />`. The `TrendLineOverlay` function uses these to render SVG `<line>` elements.

- [ ] **Step 1: Add drawing state + priceDomain to Dashboard.jsx**

In `frontend/src/components/Dashboard.jsx`:

**A) Add `useRef` to the React import**. Find:
```js
import { useCallback, useEffect, useMemo, useState } from 'react';
```
Replace with:
```js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

**B) Add drawing state** after `const [showForecast, setShowForecast] = useState(true);`:
```js
const [drawingMode, setDrawingMode] = useState(false);
const [drawnLines, setDrawnLines] = useState([]);
const [pendingPoint, setPendingPoint] = useState(null);
const [hoverPoint, setHoverPoint] = useState(null);
```

**C) Add `chartPriceDomain` useMemo** after the existing `chartData` useMemo (around line 402):
```js
const PLOT_TOP = 5;
const PLOT_HEIGHT = 320;

const chartPriceDomain = useMemo(() => {
  const closes = chartData
    .filter((row) => !row.isForecast && row.close != null)
    .map((row) => row.close);
  if (!closes.length) return null;
  const mn = Math.min(...closes);
  const mx = Math.max(...closes);
  const pad = Math.max((mx - mn) * 0.08, mx * 0.015);
  return [mn - pad, mx + pad];
}, [chartData]);
```

**D) Add `pixelToPrice` callback** after `chartPriceDomain`:
```js
const pixelToPrice = useCallback(
  (chartY) => {
    if (!chartPriceDomain) return null;
    const [yMin, yMax] = chartPriceDomain;
    const price = yMax - ((chartY - PLOT_TOP) / PLOT_HEIGHT) * (yMax - yMin);
    return Number.isFinite(price) ? price : null;
  },
  [chartPriceDomain],
);
```

**E) Reset drawing state when symbol changes.** Find the `useEffect` that calls `setStockData([])` or resets symbol-related state (search for `}, [symbol]);`). Add resets there, OR add a new effect:
```js
useEffect(() => {
  setDrawnLines([]);
  setPendingPoint(null);
  setHoverPoint(null);
  setDrawingMode(false);
}, [symbol]);
```

**F) Add chart event handlers** after the reset effect:
```js
const handleChartClick = useCallback(
  (data) => {
    if (!drawingMode || !data?.activeLabel) return;
    const price = pixelToPrice(data.chartY);
    if (price == null) return;
    const point = { x: data.activeLabel, y: price };
    if (!pendingPoint) {
      setPendingPoint(point);
    } else {
      setDrawnLines((prev) => [
        ...prev,
        { id: Date.now().toString(), x1: pendingPoint.x, y1: pendingPoint.y, x2: point.x, y2: point.y },
      ]);
      setPendingPoint(null);
      setHoverPoint(null);
    }
  },
  [drawingMode, pendingPoint, pixelToPrice],
);

const handleChartMouseMove = useCallback(
  (data) => {
    if (!drawingMode || !pendingPoint || !data?.activeLabel) {
      if (hoverPoint) setHoverPoint(null);
      return;
    }
    const price = pixelToPrice(data.chartY);
    if (price == null) return;
    setHoverPoint({ x: data.activeLabel, y: price });
  },
  [drawingMode, pendingPoint, hoverPoint, pixelToPrice],
);

const handleLineDelete = useCallback((id) => {
  setDrawnLines((prev) => prev.filter((l) => l.id !== id));
}, []);
```

- [ ] **Step 2: Add drawing toolbar to Dashboard.jsx Price Action header**

In Dashboard.jsx, find the drawing toolbar placement in the Price Action card. The current second row (inside `<div className="flex flex-wrap items-center gap-2">`):
```jsx
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {CHART_PERIODS.map(...)}
                </div>
                <button ...>Forecast</button>
                {insightsLoading ? ... : null}
              </div>
```

After that closing `</div>` of `flex flex-wrap items-center gap-2`, add a second row for drawing tools (still inside `mb-4 flex flex-wrap items-start justify-between gap-3`). Find the outer `<div className="mb-4 flex flex-wrap items-start justify-between gap-3">` and its closing `</div>`. Then add a NEW `<div>` as a sibling to the title div and the controls div — OR append the drawing toolbar inline below the controls. 

The simplest placement: add the drawing toolbar as a full-width row at the bottom of the `mb-4` div. Replace:
```jsx
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
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
                <button
                  type="button"
                  onClick={() => setShowForecast((v) => !v)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    showForecast
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  Forecast
                </button>
                {insightsLoading ? (
                  <span className="text-xs text-amber-300">Loading…</span>
                ) : null}
              </div>
            </div>
```

Replace with:
```jsx
            <div className="mb-4 space-y-2">
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
                  <button
                    type="button"
                    onClick={() => setShowForecast((v) => !v)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      showForecast
                        ? 'bg-amber-400 text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    Forecast
                  </button>
                  {insightsLoading ? (
                    <span className="text-xs text-amber-300">Loading…</span>
                  ) : null}
                </div>
              </div>

              {/* Drawing toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDrawingMode((v) => !v);
                    setPendingPoint(null);
                    setHoverPoint(null);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    drawingMode
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  ✏ Draw Line
                </button>
                {drawnLines.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => { setDrawnLines([]); setPendingPoint(null); setHoverPoint(null); }}
                    className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
                  >
                    Clear ({drawnLines.length})
                  </button>
                ) : null}
                {(drawingMode || drawnLines.length > 0) && !showForecast ? (
                  <button
                    type="button"
                    onClick={() => setShowForecast(true)}
                    className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:bg-amber-400 hover:text-zinc-900 transition"
                  >
                    Overlay Prediction
                  </button>
                ) : null}
                {pendingPoint ? (
                  <span className="text-xs text-zinc-500">Click on the chart to set the endpoint</span>
                ) : drawingMode ? (
                  <span className="text-xs text-zinc-500">Click on the chart to start a trend line</span>
                ) : null}
              </div>
            </div>
```

- [ ] **Step 3: Pass drawing props to StockChart in Dashboard.jsx**

Find:
```jsx
                <StockChart
                  data={chartData}
                  interval={chartInterval}
                  selectedIndicators={selectedIndicators}
                  forecastModel={forecastModel}
                  hasForecastCloud={Boolean(forecastCloud)}
                  showForecast={showForecast}
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
                  showForecast={showForecast}
                  drawingMode={drawingMode}
                  drawnLines={drawnLines}
                  pendingPoint={pendingPoint}
                  hoverPoint={hoverPoint}
                  onChartClick={handleChartClick}
                  onChartMouseMove={handleChartMouseMove}
                  onLineDelete={handleLineDelete}
                />
```

- [ ] **Step 4: Add drawing support to StockChart.jsx**

Open `frontend/src/components/StockChart.jsx`. Make all of these changes:

**A) Add `Customized` to the Recharts import** (line 2–14):
```js
// Find:
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
  Area,
} from 'recharts';
// Replace:
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Customized,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
```

**B) Add `TrendLineOverlay` function** before `tooltipFormatter` (above the component, at file top level):

```js
function TrendLineOverlay({ xAxisMap, yAxisMap, offset, drawnLines, pendingPoint, hoverPoint, onLineDelete }) {
  const xScale = xAxisMap?.[0]?.scale;
  const yScale = yAxisMap?.['price']?.scale;
  if (!xScale || !yScale || !offset) return null;

  const toX = (date) => {
    const v = xScale(date);
    return v != null ? v + (offset.left ?? 0) : null;
  };
  const toY = (price) => {
    const v = yScale(price);
    return v != null ? v + (offset.top ?? 0) : null;
  };

  return (
    <g>
      {drawnLines.map((line) => {
        const x1 = toX(line.x1);
        const y1 = toY(line.y1);
        const x2 = toX(line.x2);
        const y2 = toY(line.y2);
        if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
        return (
          <g key={line.id}>
            {/* Visible line */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" />
            {/* Wide invisible hit target — click to delete */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onLineDelete?.(line.id); }} />
          </g>
        );
      })}
      {pendingPoint && hoverPoint ? (() => {
        const px = toX(pendingPoint.x);
        const py = toY(pendingPoint.y);
        const hx = toX(hoverPoint.x);
        const hy = toY(hoverPoint.y);
        if (px == null || py == null || hx == null || hy == null) return null;
        return (
          <line x1={px} y1={py} x2={hx} y2={hy}
            stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="6 3" strokeLinecap="round" />
        );
      })() : null}
    </g>
  );
}
```

**C) Update the StockChart function signature** (line 45):
```js
// Find:
export default function StockChart({ data, interval, selectedIndicators, forecastModel, hasForecastCloud, showForecast = true }) {
// Replace:
export default function StockChart({
  data, interval, selectedIndicators, forecastModel, hasForecastCloud,
  showForecast = true,
  drawingMode = false,
  drawnLines = [],
  pendingPoint = null,
  hoverPoint = null,
  onChartClick,
  onChartMouseMove,
  onLineDelete,
}) {
```

**D) Add `crosshair` cursor and event handlers to the main ComposedChart**. Find:
```jsx
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
```
Replace with:
```jsx
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            onClick={onChartClick}
            onMouseMove={onChartMouseMove}
            style={drawingMode ? { cursor: 'crosshair' } : undefined}
          >
```

**E) Add the `Customized` line overlay** as the LAST child inside the main `ComposedChart` (just before the closing `</ComposedChart>` tag of the FIRST chart — the one with `yAxisId="price"`). Find:
```jsx
          </ComposedChart>
        </ResponsiveContainer>
        </div>
```
The first occurrence of `</ComposedChart>` (around line 304). Add before it:
```jsx
            <Customized
              component={TrendLineOverlay}
              drawnLines={drawnLines}
              pendingPoint={pendingPoint}
              hoverPoint={hoverPoint}
              onLineDelete={onLineDelete}
            />
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend && npm run build 2>&1 | grep -iE "error" | grep -v node_modules | head -10
# Expected: no output
```

- [ ] **Step 6: Quick smoke test (manual)**

Start the dev server:
```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend && npm run dev
```
Open the browser:
1. Load any stock (e.g. AAPL)
2. Click "✏ Draw Line" — the cursor should become a crosshair on the price chart
3. Click on the chart — "Click on the chart to set the endpoint" should appear
4. Click a second point — a yellow line should appear connecting both points
5. A second click on a different pair of points should draw a second line
6. Hover a drawn line and click it — it should be deleted
7. Click "Clear (n)" — all lines cleared
8. Click "Forecast" — the amber cone disappears
9. With Forecast hidden and lines drawn, "Overlay Prediction" button should appear
10. Click "Overlay Prediction" — forecast re-appears

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/StockChart.jsx frontend/src/components/Dashboard.jsx
git commit -m "feat: user-drawn trend lines with data-space coordinate storage, Overlay Prediction button"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ "reference some polygon functions" → `fetchPolygonDetails` using `GET /v3/reference/tickers/{ticker}`
- ✅ "let people edit and draw trend lines themselves" → click-to-start + click-to-end drawing flow
- ✅ "option beside the graph to overlay or dun show predicted trends" → "Forecast" toggle button next to period pills
- ✅ "once the person finish drawing or drawing halfway, he can click overlay prediction" → "Overlay Prediction" button appears when drawing mode active (or lines exist) AND forecast is hidden; clicking enables forecast

**2. Placeholder scan:** All steps contain complete code. No TBD or "handle errors" without showing how.

**3. Type consistency:**
- `drawnLines[n].{id, x1, y1, x2, y2}` defined in Task 3 Step 1 (`handleChartClick`), consumed in Task 3 Step 4 (`TrendLineOverlay`) — match ✅
- `pendingPoint / hoverPoint: { x: string, y: number }` defined Step 1, consumed Steps 2 and 4 — match ✅
- `getCompanyDetails` defined Task 1 Step 3, imported Task 1 Step 4 — match ✅
- `showForecast` prop: default `true` in StockChart, `useState(true)` in Dashboard — match ✅
- `Customized` import added in Step 4A, used in Step 4E — match ✅

**4. Risk notes:**
- Recharts `Customized` props (`xAxisMap`, `yAxisMap`, `offset`): documented in Recharts 3.x. If `xScale` or `yScale` are null, `TrendLineOverlay` returns `null` gracefully — no crash.
- `pixelToPrice` constants (`PLOT_TOP=5`, `PLOT_HEIGHT=320`): may need ±5px tuning after visual testing. If lines appear offset, adjust `PLOT_HEIGHT` by inspecting the actual chart SVG dimensions via DevTools.
- `xScale(date)` for dates NOT in the current data range will return `undefined` → guarded by `if (v != null)` in `toX`/`toY`.
