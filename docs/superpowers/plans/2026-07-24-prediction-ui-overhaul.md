# Patterngrow Dashboard — Prediction & UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat linear forecasts and generic dark-blue UI with a volatility-aware prediction cone, Monte Carlo path cloud, regime detection panel, and amber-accented visual identity that makes the analytical depth visible.

**Architecture:** The backend `predictions.js` gains real statistical uncertainty (historical vol + GBM); `computeSignals.js` threads new fields (`forecastCloud`, `forecastVol`) through the existing API response shape without breaking callers. The frontend consumes the richer payload to render layered Recharts Areas for the cone/cloud, a new `RegimePanel` component, and a signal conviction bar chart — all within the existing Tailwind stack with amber as the new accent.

**Tech Stack:** Node.js/Express backend (predictions.js), React + Recharts frontend, Tailwind CSS (amber palette via extend), `date-fns` (already installed).

## Global Constraints

- No new npm packages — use only libraries already installed in frontend (`recharts`, `date-fns`) and backend (`date-fns`)
- All changes must stay API-backward-compatible: existing `forecast` field shape must still work for callers that ignore the new fields
- Tailwind classes only for styling — no inline `style={{}}` except for dynamic Recharts `stroke`/`fill` props
- The three existing forecast model labels (`simple`, `arima`, `prophet`) keep their keys; `montecarlo` is added as a fourth
- Do not rewrite Dashboard.jsx from scratch — surgical edits only
- Keep `computeSignals.js` return shape stable: add fields, never remove

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/utils/predictions.js` | Modify | Add historical vol, confidence bands on all models, new `montecarlo` GBM model |
| `backend/utils/computeSignals.js` | Modify | Unpack new `{forecast, forecastCloud, forecastVol}` shape; pass through in return payload |
| `frontend/src/components/Dashboard.jsx` | Modify | New states (`forecastCloud`, `signalSeries`); merge bands into `chartData`; wire new model option; new RegimePanel; new conviction chart; amber accent + remove eyebrow pattern |
| `frontend/src/components/StockChart.jsx` | Modify | Add stacked Area components for cone and MC cloud; amber forecast line |
| `frontend/src/components/RegimePanel.jsx` | Create | Visual regime indicator using ADX + realized vol; no external deps |
| `frontend/tailwind.config.js` | Modify | Extend theme with `brand` amber alias |
| `frontend/src/index.css` | Modify | Add CSS custom props for design tokens; amber body accent |
| `frontend/src/App.jsx` | Modify | Swap blue loading pulse to amber |

---

## Task 1: Volatility-Aware Confidence Bands on All Forecast Models

**Files:**
- Modify: `backend/utils/predictions.js`
- Modify: `backend/utils/computeSignals.js`

**Interfaces:**
- Produces: `predictFuturePrices(points, indicator, model, days)` now returns `{ forecast: ForecastPoint[], forecastCloud: ForecastCloud | null, forecastVol: number | null }` where:
  - `ForecastPoint = { date: string, value: number, lower68: number, upper68: number, lower95: number, upper95: number }`
  - `ForecastCloud = { dates: string[], p5: number[], p25: number[], p50: number[], p75: number[], p95: number[] }`

- [ ] **Step 1: Replace `predictions.js` with the new implementation**

Replace the entire contents of `backend/utils/predictions.js`:

```js
import { addDays, formatISO } from 'date-fns';

const getClose = (row) => Number(row.close);

function computeHistoricalVol(closes) {
  if (closes.length < 2) return { dailyVol: 0, meanReturn: 0 };
  const logReturns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
  return { dailyVol: Math.sqrt(variance), meanReturn: mean };
}

function addBands(value, dailyVol, t) {
  const spread = dailyVol * Math.sqrt(t) * value;
  return {
    lower68: Math.max(0, value - spread),
    upper68: value + spread,
    lower95: Math.max(0, value - 2 * spread),
    upper95: value + 2 * spread,
  };
}

function boxMullerNormal() {
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const linearRegression = (points) => {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += points[i]; sumXY += i * points[i]; sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
};

const smoothSeries = (values, window = 5) =>
  values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

function buildDates(lastDate, days) {
  return Array.from({ length: days }, (_, i) =>
    formatISO(addDays(lastDate, i + 1), { representation: 'date' })
  );
}

function percentileAt(sorted, p) {
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function predictFuturePrices(points, indicator = 'sma', model = 'simple', days = 60) {
  const closes = points.map(getClose).filter(Number.isFinite);
  if (closes.length === 0) return { forecast: [], forecastCloud: null, forecastVol: null };

  const lastDate = points.length > 0 ? new Date(points[points.length - 1].date) : new Date();
  const dates = buildDates(lastDate, days);
  const { dailyVol, meanReturn } = computeHistoricalVol(closes);

  if (model === 'simple') {
    const trend = (closes[closes.length - 1] - closes[0]) / closes.length;
    const lastPrice = closes[closes.length - 1];
    const forecast = dates.map((date, i) => {
      const value = lastPrice + trend * (i + 1);
      return { date, value, ...addBands(value, dailyVol, i + 1) };
    });
    return { forecast, forecastCloud: null, forecastVol: dailyVol };
  }

  if (model === 'arima') {
    const { slope, intercept } = linearRegression(closes);
    const forecast = dates.map((date, i) => {
      const value = slope * (closes.length + i + 1) + intercept;
      return { date, value, ...addBands(value, dailyVol, i + 1) };
    });
    return { forecast, forecastCloud: null, forecastVol: dailyVol };
  }

  if (model === 'prophet') {
    const smoothed = smoothSeries(closes, 7);
    const { slope, intercept } = linearRegression(smoothed);
    const forecast = dates.map((date, i) => {
      const value = slope * (smoothed.length + i + 1) + intercept;
      return { date, value, ...addBands(value, dailyVol, i + 1) };
    });
    return { forecast, forecastCloud: null, forecastVol: dailyVol };
  }

  if (model === 'montecarlo') {
    const N_PATHS = 300;
    const lastPrice = closes[closes.length - 1];
    const drift = meanReturn - 0.5 * dailyVol ** 2;

    // Simulate N_PATHS paths of length `days`
    const allPaths = Array.from({ length: N_PATHS }, () => {
      const path = [];
      let price = lastPrice;
      for (let d = 0; d < days; d++) {
        price *= Math.exp(drift + dailyVol * boxMullerNormal());
        path.push(price);
      }
      return path;
    });

    // Extract percentiles at each day
    const p5 = [], p25 = [], p50 = [], p75 = [], p95 = [];
    for (let d = 0; d < days; d++) {
      const dayVals = allPaths.map((p) => p[d]).sort((a, b) => a - b);
      p5.push(percentileAt(dayVals, 0.05));
      p25.push(percentileAt(dayVals, 0.25));
      p50.push(percentileAt(dayVals, 0.50));
      p75.push(percentileAt(dayVals, 0.75));
      p95.push(percentileAt(dayVals, 0.95));
    }

    const forecastCloud = { dates, p5, p25, p50, p75, p95 };

    // Median path as primary forecast (with vol bands)
    const forecast = dates.map((date, i) => ({
      date,
      value: p50[i],
      lower68: p25[i],
      upper68: p75[i],
      lower95: p5[i],
      upper95: p95[i],
    }));

    return { forecast, forecastCloud, forecastVol: dailyVol };
  }

  return { forecast: [], forecastCloud: null, forecastVol: null };
}
```

- [ ] **Step 2: Update `computeSignals.js` to unpack the new return shape**

In `backend/utils/computeSignals.js`, find line 202:
```js
const prediction = predictFuturePrices(history, indicator, forecastModel, forecastHorizon);
```

Replace with:
```js
const { forecast: prediction, forecastCloud, forecastVol } = predictFuturePrices(
  history, indicator, forecastModel, forecastHorizon
);
```

Then in the `return` object at the bottom (around line 235), add `forecastCloud` and `forecastVol` after the `forecast` line:
```js
forecast: prediction,
forecastCloud: forecastCloud ?? null,
forecastVol: forecastVol ?? null,
```

- [ ] **Step 3: Verify the backend still works**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/backend
node -e "
import('./utils/predictions.js').then(({ predictFuturePrices }) => {
  const fakeHistory = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.now() - (60 - i) * 86400000).toISOString().split('T')[0],
    close: 150 + i * 0.3 + Math.random() * 2,
  }));
  const result = predictFuturePrices(fakeHistory, 'sma', 'montecarlo', 10);
  console.log('forecast length:', result.forecast.length);
  console.log('sample point:', JSON.stringify(result.forecast[0]));
  console.log('cloud p50 length:', result.forecastCloud?.p50?.length);
  console.log('dailyVol:', result.forecastVol?.toFixed(4));
});
"
```
Expected output: `forecast length: 10`, a sample point with `lower68`/`upper68`/`lower95`/`upper95` fields, `cloud p50 length: 10`, a small positive float for dailyVol.

- [ ] **Step 4: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add backend/utils/predictions.js backend/utils/computeSignals.js
git commit -m "feat: volatility-aware forecast bands + Monte Carlo GBM model

All forecast models now return lower68/upper68/lower95/upper95 confidence
bands derived from historical daily vol. New 'montecarlo' model runs 300
GBM paths and returns percentile cloud alongside median forecast."
```

---

## Task 2: Frontend — Forecast Cone and Monte Carlo Cloud in StockChart

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx`
- Modify: `frontend/src/components/StockChart.jsx`

**Interfaces:**
- Consumes: `payload.forecast[i]` now has `lower68`, `upper68`, `lower95`, `upper95`
- Consumes: `payload.forecastCloud` = `{ dates, p5, p25, p50, p75, p95 }` or null
- Produces: `StockChart` receives additional prop `forecastModel: string` (to decide cloud vs cone rendering)

- [ ] **Step 1: Add `forecastCloud` state and Monte Carlo model option in Dashboard.jsx**

At the top of Dashboard.jsx, find `FORECAST_MODELS`:
```js
const FORECAST_MODELS = [
  { label: 'Simple Trend', value: 'simple' },
  { label: 'ARIMA Inspired', value: 'arima' },
  { label: 'Prophet Inspired', value: 'prophet' },
];
```

Replace with:
```js
const FORECAST_MODELS = [
  { label: 'Simple Trend', value: 'simple' },
  { label: 'ARIMA Inspired', value: 'arima' },
  { label: 'Prophet Inspired', value: 'prophet' },
  { label: 'Monte Carlo (GBM)', value: 'montecarlo' },
];
```

- [ ] **Step 2: Add `forecastCloud` and `signalSeries` state variables in Dashboard.jsx**

After the existing `const [predictionSeries, setPredictionSeries] = useState([]);` line, add:
```js
const [forecastCloud, setForecastCloud] = useState(null);
const [signalSeries, setSignalSeries] = useState([]);
```

- [ ] **Step 3: Update `applyInsights` in Dashboard.jsx to set the new states**

In `applyInsights`, after `setPredictionSeries(payload.forecast ?? []);`, add:
```js
setForecastCloud(payload.forecastCloud ?? null);
```

Also update the enrichedSignals block to store all signals (not just last 5). Find this section:
```js
const enrichedSignals = (payload.signals ?? [])
  .map((entry, index) => ({
    ...entry,
    date: payload.history?.[index]?.date ?? null,
  }))
  .filter((entry) => entry.signal !== 'hold');
```

Add immediately after:
```js
setSignalSeries(enrichedSignals);
```

Also in the `applyInsights(null)` path, after the existing `setMomentum(null)` etc., add:
```js
setForecastCloud(null);
setSignalSeries([]);
```

- [ ] **Step 4: Merge forecast bands and cloud into `chartData` in Dashboard.jsx**

Find the `chartData` useMemo (around line 259). Replace the entire block:
```js
const chartData = useMemo(() => {
  const base = stockData.map((row) => ({
    ...row,
    isForecast: false,
    forecast: null,
  }));

  if (predictionSeries.length > 0) {
    const lastClose = stockData.at(-1)?.close ?? null;
    predictionSeries.forEach((point, index) => {
      const cloud = forecastCloud;
      base.push({
        date: point.date,
        close: index === 0 && lastClose != null ? lastClose : null,
        high: null, low: null, open: null, volume: null,
        forecast: point.value,
        forecastLower68: point.lower68 ?? null,
        forecastUpper68: point.upper68 ?? null,
        forecastLower95: point.lower95 ?? null,
        forecastUpper95: point.upper95 ?? null,
        // Recharts stacked-area trick: bandHeight = upper - lower
        forecastBand68Height: point.upper68 != null && point.lower68 != null
          ? point.upper68 - point.lower68 : null,
        forecastBand95Height: point.upper95 != null && point.lower95 != null
          ? point.upper95 - point.lower95 : null,
        // MC cloud fields (null when not using montecarlo model)
        mcP5: cloud?.p5[index] ?? null,
        mcP25: cloud?.p25[index] ?? null,
        mcP75: cloud?.p75[index] ?? null,
        mcP95: cloud?.p95[index] ?? null,
        mcBandOuterHeight: cloud ? (cloud.p95[index] ?? 0) - (cloud.p5[index] ?? 0) : null,
        mcBandInnerHeight: cloud ? (cloud.p75[index] ?? 0) - (cloud.p25[index] ?? 0) : null,
        isForecast: true,
      });
    });
  }

  return base;
}, [stockData, predictionSeries, forecastCloud]);
```

- [ ] **Step 5: Pass `forecastModel` and `forecastCloud` to StockChart**

Find the `<StockChart data={chartData} selectedIndicators={selectedIndicators} />` JSX line and update it:
```jsx
<StockChart
  data={chartData}
  selectedIndicators={selectedIndicators}
  forecastModel={forecastModel}
  hasForecastCloud={Boolean(forecastCloud)}
/>
```

- [ ] **Step 6: Update StockChart.jsx to render the forecast cone and MC cloud**

In `StockChart.jsx`, update the import to add `Area` to the existing `recharts` import (it's already imported via `AreaChart`, but `Area` needs to be available in `ComposedChart` too):
```js
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Area,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
} from 'recharts';
```

Update the function signature:
```js
export default function StockChart({ data, selectedIndicators, forecastModel, hasForecastCloud }) {
```

In the main ComposedChart JSX, after the existing Bollinger/VWAP lines and before the closing `</ComposedChart>`, replace the existing forecast Line with the cone + line:

Find:
```jsx
{forecastStartIndex > -1 ? (
  <Line
    type="monotone"
    dataKey="forecast"
    yAxisId="price"
    stroke="#f472b6"
    strokeWidth={1.6}
    strokeDasharray="6 3"
    dot={false}
    name="Forecast"
  />
) : null}
```

Replace with:
```jsx
{forecastStartIndex > -1 ? (
  <>
    {/* 95% confidence band (outer) — stacked area trick */}
    <Area
      type="monotone"
      dataKey="forecastLower95"
      yAxisId="price"
      fill="transparent"
      stroke="none"
      dot={false}
      legendType="none"
      activeDot={false}
      stackId="cone95"
      name=""
    />
    <Area
      type="monotone"
      dataKey="forecastBand95Height"
      yAxisId="price"
      fill="#fbbf24"
      fillOpacity={0.08}
      stroke="none"
      dot={false}
      legendType="none"
      activeDot={false}
      stackId="cone95"
      name=""
    />
    {/* 68% confidence band (inner) */}
    <Area
      type="monotone"
      dataKey="forecastLower68"
      yAxisId="price"
      fill="transparent"
      stroke="none"
      dot={false}
      legendType="none"
      activeDot={false}
      stackId="cone68"
      name=""
    />
    <Area
      type="monotone"
      dataKey="forecastBand68Height"
      yAxisId="price"
      fill="#fbbf24"
      fillOpacity={0.16}
      stroke="none"
      dot={false}
      legendType="none"
      activeDot={false}
      stackId="cone68"
      name=""
    />
    {/* MC cloud outer band (p5-p95) — only when montecarlo model active */}
    {hasForecastCloud ? (
      <>
        <Area
          type="monotone"
          dataKey="mcP5"
          yAxisId="price"
          fill="transparent"
          stroke="none"
          dot={false}
          legendType="none"
          activeDot={false}
          stackId="cloud95"
          name=""
        />
        <Area
          type="monotone"
          dataKey="mcBandOuterHeight"
          yAxisId="price"
          fill="#fbbf24"
          fillOpacity={0.06}
          stroke="none"
          dot={false}
          legendType="none"
          activeDot={false}
          stackId="cloud95"
          name=""
        />
        {/* MC inner band (p25-p75) */}
        <Area
          type="monotone"
          dataKey="mcP25"
          yAxisId="price"
          fill="transparent"
          stroke="none"
          dot={false}
          legendType="none"
          activeDot={false}
          stackId="cloud68"
          name=""
        />
        <Area
          type="monotone"
          dataKey="mcBandInnerHeight"
          yAxisId="price"
          fill="#fbbf24"
          fillOpacity={0.14}
          stroke="none"
          dot={false}
          legendType="none"
          activeDot={false}
          stackId="cloud68"
          name=""
        />
      </>
    ) : null}
    {/* Median / base forecast line */}
    <Line
      type="monotone"
      dataKey="forecast"
      yAxisId="price"
      stroke="#fbbf24"
      strokeWidth={2}
      strokeDasharray="6 3"
      dot={false}
      name="Forecast"
    />
  </>
) : null}
```

- [ ] **Step 7: Verify the chart renders without errors**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend
npm run dev -- --open
```

Open the dashboard, select `Monte Carlo (GBM)` as forecast model, click "Generate 60-day Forecast". The chart should show an amber cone widening from the last price, with a denser inner band. For non-MC models (simple/arima/prophet), a narrower vol-based cone should appear. No console errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add frontend/src/components/Dashboard.jsx frontend/src/components/StockChart.jsx
git commit -m "feat: forecast cone + Monte Carlo cloud visualization

Dashboard merges lower68/upper68/lower95/upper95 and MC percentile
bands into chartData. StockChart renders stacked Area components to
create amber uncertainty cones; MC model gets full p5-p95 cloud."
```

---

## Task 3: Regime Detection Panel

**Files:**
- Create: `frontend/src/components/RegimePanel.jsx`
- Modify: `frontend/src/components/Dashboard.jsx`

**Interfaces:**
- Consumes: `indicatorSnapshots` (from existing Dashboard state — already has `.adx.adx`, `.adx.plusDI`, `.adx.minusDI`)
- Consumes: `stockData` (from existing Dashboard state — array of `{ date, close }` rows)
- Produces: Displays regime chip + vol meter; no state emitted upward

- [ ] **Step 1: Create `frontend/src/components/RegimePanel.jsx`**

```jsx
import { useMemo } from 'react';

function annualizedVol(closes, window = 20) {
  const recent = closes.slice(-window);
  if (recent.length < 2) return null;
  const logReturns = recent.slice(1).map((c, i) => Math.log(c / recent[i]));
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function trendRegime(adx, plusDI, minusDI) {
  if (adx == null) return { label: 'Unknown', color: 'text-zinc-400', bg: 'bg-zinc-800/60', direction: null };
  if (adx >= 25) {
    const dir = plusDI != null && minusDI != null && plusDI > minusDI ? 'Uptrend' : 'Downtrend';
    return adx >= 25 && plusDI > minusDI
      ? { label: 'Trending', color: 'text-emerald-300', bg: 'bg-emerald-500/10', direction: dir }
      : { label: 'Trending', color: 'text-red-300', bg: 'bg-red-500/10', direction: dir };
  }
  if (adx >= 20) return { label: 'Transition', color: 'text-amber-300', bg: 'bg-amber-400/10', direction: null };
  return { label: 'Ranging', color: 'text-zinc-300', bg: 'bg-zinc-700/40', direction: null };
}

function volBucket(vol) {
  if (vol == null) return { label: 'N/A', width: '0%', color: 'bg-zinc-600' };
  if (vol < 15) return { label: `${vol.toFixed(1)}% — Low`, width: '20%', color: 'bg-emerald-500' };
  if (vol < 30) return { label: `${vol.toFixed(1)}% — Moderate`, width: '45%', color: 'bg-amber-400' };
  if (vol < 50) return { label: `${vol.toFixed(1)}% — Elevated`, width: '70%', color: 'bg-orange-500' };
  return { label: `${vol.toFixed(1)}% — High`, width: '95%', color: 'bg-red-500' };
}

export default function RegimePanel({ indicatorSnapshots, stockData }) {
  const { adx, plusDI, minusDI } = indicatorSnapshots?.adx ?? {};
  const regime = trendRegime(adx, plusDI, minusDI);

  const realized = useMemo(() => {
    const closes = (stockData ?? []).map((r) => Number(r.close)).filter(Number.isFinite);
    return annualizedVol(closes, 20);
  }, [stockData]);

  const vol = volBucket(realized);

  const adxBarWidth = adx != null ? `${Math.min(100, (adx / 50) * 100).toFixed(0)}%` : '0%';

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h3 className="text-sm font-semibold text-zinc-200">Market Regime</h3>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {/* Trend regime chip */}
        <div className={`rounded-xl px-3 py-3 ${regime.bg}`}>
          <p className="text-xs font-medium text-zinc-500">Trend</p>
          <p className={`mt-1 text-base font-semibold ${regime.color}`}>{regime.label}</p>
          {regime.direction ? (
            <p className={`text-xs ${regime.color}`}>{regime.direction}</p>
          ) : null}
        </div>

        {/* ADX strength bar */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
          <p className="text-xs font-medium text-zinc-500">ADX Strength</p>
          <p className="mt-1 text-base font-semibold text-zinc-200">
            {adx != null ? adx.toFixed(1) : '--'}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800">
            <div
              className="h-1.5 rounded-full bg-amber-400 transition-all duration-500"
              style={{ width: adxBarWidth }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            +DI {plusDI?.toFixed(1) ?? '--'} / −DI {minusDI?.toFixed(1) ?? '--'}
          </p>
        </div>

        {/* Realized vol */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-3">
          <p className="text-xs font-medium text-zinc-500">20-Day Realized Vol</p>
          <p className="mt-1 text-base font-semibold text-zinc-200">
            {realized != null ? `${realized.toFixed(1)}%` : '--'}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${vol.color}`}
              style={{ width: vol.width }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">{vol.label.split('—')[1]?.trim() ?? ''}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire RegimePanel into Dashboard.jsx**

Add import at the top of Dashboard.jsx:
```js
import RegimePanel from './RegimePanel';
```

In the JSX, find the `technicalSummary` section (around line 603):
```jsx
{technicalSummary ? (
  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
    <h3 className="text-lg font-semibold text-white">Technical Snapshot</h3>
    <p className="mt-2 text-sm text-slate-300">{technicalSummary}</p>
  </div>
) : null}
```

Insert RegimePanel immediately before it:
```jsx
{indicatorSnapshots ? (
  <RegimePanel indicatorSnapshots={indicatorSnapshots} stockData={stockData} />
) : null}
```

- [ ] **Step 3: Verify RegimePanel renders**

Load the dashboard in the browser. After data loads, the Market Regime panel should appear above the Technical Snapshot. Check that the ADX bar, trend chip (color changes based on +DI/-DI), and vol meter render with correct values. Open DevTools and confirm no prop-type errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add frontend/src/components/RegimePanel.jsx frontend/src/components/Dashboard.jsx
git commit -m "feat: regime detection panel with ADX trend + realized vol"
```

---

## Task 4: Signal Conviction Chart

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx`

**Interfaces:**
- Consumes: `signalSeries` state (array of `{ signal: string, numericSignal: number, date: string | null }`) populated in Task 2 Step 3
- Produces: Recharts BarChart replacing the text list in the Signal Rundown section

- [ ] **Step 1: Add `BarChart` and `Bar` to Dashboard.jsx's recharts import**

At the top of Dashboard.jsx, find:
```js
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
```

Replace with:
```js
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
```

- [ ] **Step 2: Add conviction strength helper constants**

Near the top of Dashboard.jsx (after the FORECAST_MODELS constant), add:
```js
const SIGNAL_STRENGTH = {
  buy_strong: 3,
  buy_medium: 2,
  buy_weak: 1,
  hold: 0,
  sell_weak: -1,
  sell_medium: -2,
  sell_strong: -3,
};

function signalColor(value) {
  if (value >= 3) return '#10b981'; // emerald-500 — strong buy
  if (value >= 2) return '#34d399'; // emerald-400 — medium buy
  if (value >= 1) return '#6ee7b7'; // emerald-300 — weak buy
  if (value <= -3) return '#ef4444'; // red-500 — strong sell
  if (value <= -2) return '#f87171'; // red-400 — medium sell
  return '#fca5a5'; // red-300 — weak sell
}
```

- [ ] **Step 3: Replace the Signal Rundown section JSX in Dashboard.jsx**

Find the entire `{backtestSummary ? ( <section>... Signal Rundown ...</section> ) : null}` block and replace it:

```jsx
{backtestSummary ? (
  <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
    <h3 className="text-sm font-semibold text-zinc-200">Signal Conviction</h3>
    <p className="mt-1 text-xs text-zinc-500">
      {backtestSummary.indicator?.toUpperCase()} signals — strength from −3 (strong sell) to +3 (strong buy)
    </p>
    <div className="mt-4 grid grid-cols-4 gap-3">
      <div>
        <p className="text-xs font-medium text-zinc-500">Total</p>
        <p className="mt-1 text-lg font-semibold text-zinc-100">{backtestSummary.totalSignals ?? 0}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-zinc-500">Buy</p>
        <p className="mt-1 text-lg font-semibold text-emerald-400">{backtestSummary.buySignals ?? 0}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-zinc-500">Sell</p>
        <p className="mt-1 text-lg font-semibold text-red-400">{backtestSummary.sellSignals ?? 0}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-zinc-500">Snapshot</p>
        <p className="mt-1 text-sm text-zinc-200">{indicatorSnapshotDisplay}</p>
      </div>
    </div>
    {signalSeries.length > 0 ? (
      <div className="mt-4 h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={signalSeries.map((s) => ({
              date: s.date ? new Date(s.date).toLocaleDateString() : '',
              strength: SIGNAL_STRENGTH[s.signal] ?? 0,
            }))}
            margin={{ top: 4, right: 0, left: -24, bottom: 0 }}
          >
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: '#71717a' }}
              minTickGap={30}
            />
            <YAxis
              domain={[-3, 3]}
              ticks={[-3, -2, -1, 0, 1, 2, 3]}
              tick={{ fontSize: 9, fill: '#71717a' }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '0.5rem', fontSize: 11 }}
              formatter={(value) => [value > 0 ? `Buy +${value}` : `Sell ${value}`, 'Conviction']}
            />
            <Bar dataKey="strength" radius={[2, 2, 0, 0]}>
              {signalSeries.map((s, index) => (
                <Cell key={index} fill={signalColor(SIGNAL_STRENGTH[s.signal] ?? 0)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    ) : (
      <p className="mt-3 text-xs text-zinc-500">No non-hold signals in this period.</p>
    )}
  </section>
) : null}
```

- [ ] **Step 4: Verify conviction chart**

Run the dev server. After loading data, the Signal Conviction section should show a bar chart with green bars for buy signals and red bars for sell signals, sized by conviction strength. Hover a bar to see the conviction score tooltip. Verify that bars with `buy_strong` are darker green than `buy_weak`.

- [ ] **Step 5: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add frontend/src/components/Dashboard.jsx
git commit -m "feat: signal conviction bar chart replaces text list

Bar chart shows all non-hold signals over the period, colored and
sized by conviction strength (-3 sell_strong to +3 buy_strong)."
```

---

## Task 5: Visual Identity — Amber Accent + Remove Eyebrow Pattern

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Dashboard.jsx`
- Modify: `frontend/src/components/StockChart.jsx`

**Goal:** Replace the generic `slate`/`blue-500` design system with a zinc-base + amber accent. Remove the `text-xs uppercase tracking-wide` eyebrow label pattern from section titles (keep it only on 2-4 character data labels). Make the brand feel like a precision analytical tool, not a SaaS template.

- [ ] **Step 1: Update `tailwind.config.js` to add amber brand alias**

Replace the entire file:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#fbbf24', // amber-400
          light: '#fde68a',   // amber-200
          dim: '#f59e0b',     // amber-500
          glow: 'rgba(251,191,36,0.15)',
        },
        surface: {
          base: '#09090b',    // zinc-950
          raised: '#111116',  // slightly lighter than zinc-950
          card: 'rgba(24,24,27,0.6)', // zinc-900/60
          border: '#27272a',  // zinc-800
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Update `index.css` for base styling**

Replace the entire file:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  @apply bg-zinc-950 text-zinc-100 min-h-screen;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #09090b; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #fbbf24; }

/* Amber focus ring for inputs */
input:focus, select:focus, textarea:focus {
  outline: none;
}
```

- [ ] **Step 3: Update App.jsx loading screen to amber**

Find in App.jsx:
```jsx
<span className="h-3 w-3 animate-pulse rounded-full bg-blue-400" />
<p className="text-sm uppercase tracking-wide text-slate-400">Loading session…</p>
```

Replace with:
```jsx
<span className="h-3 w-3 animate-pulse rounded-full bg-amber-400" />
<p className="text-sm text-zinc-400">Loading session…</p>
```

Also update the container:
```jsx
<div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
```

- [ ] **Step 4: Apply targeted class replacements in Dashboard.jsx**

Run these find-and-replace operations in Dashboard.jsx. Each is a distinct, safe substitution:

**A. Background and border base classes:**
- Replace all `bg-slate-950` → `bg-zinc-950`
- Replace all `bg-slate-900/60` → `bg-zinc-900/60`
- Replace all `border-slate-800` → `border-zinc-800`
- Replace all `border-slate-700` → `border-zinc-700`
- Replace all `bg-slate-950/60` → `bg-zinc-950/60`
- Replace all `bg-slate-900/60` → `bg-zinc-900/60`
- Replace all `bg-slate-900/80` → `bg-zinc-900/80`
- Replace all `bg-slate-950/40` → `bg-zinc-950/40`

**B. Text colors:**
- Replace all `text-slate-100` → `text-zinc-100`
- Replace all `text-slate-200` → `text-zinc-200`
- Replace all `text-slate-300` → `text-zinc-300`
- Replace all `text-slate-400` → `text-zinc-400`
- Replace all `text-slate-500` → `text-zinc-500`

**C. Accent: blue → amber:**
- Replace `text-blue-200` → `text-amber-200`
- Replace `text-blue-300` → `text-amber-300`
- Replace `border-blue-500/60` → `border-amber-400/50`
- Replace `bg-blue-500/10` → `bg-amber-400/10`
- Replace `bg-blue-500/20` → `bg-amber-400/15`
- Replace `bg-blue-500` → `bg-amber-400`
- Replace `text-blue-900` → `text-amber-950`
- Replace `focus:border-blue-500` → `focus:border-amber-400`
- Replace `focus:ring-blue-500/40` → `focus:ring-amber-400/25`
- Replace `accent-blue-500` → `accent-amber-400`
- Replace `hover:border-blue-500` → `hover:border-amber-400`
- Replace `hover:text-blue-200` → `hover:text-amber-200`
- Replace `hover:border-blue-400` → `hover:border-amber-400`
- Replace `hover:bg-blue-500/20` → `hover:bg-amber-400/20`
- Replace `bg-blue-500/20 text-blue-200` → `bg-amber-400/15 text-amber-200` (tab active state)

**D. Remove eyebrow pattern on SECTION HEADERS only** (keep `text-xs` on 4-char data labels like stat boxes):

The pattern `text-xs uppercase tracking-wide` on `<h2>` and `<h3>` elements is the AI tell. In Dashboard.jsx, find every `<h2>` and `<h3>` tag. If the heading itself has these classes, remove `uppercase tracking-wide`. Keep them on `<p>` data labels that are 1-4 words of actual data context (like "Last Price", "Market Cap").

Specifically, replace the header element:
```jsx
<h1 className="text-2xl font-semibold text-white">AI Stock Intelligence Console</h1>
```
with:
```jsx
<h1 className="text-xl font-semibold tracking-tight text-zinc-100">Patterngrow</h1>
```

And the subtitle:
```jsx
<p className="text-sm text-slate-400">
  Build data-informed conviction with technical studies, simulations, watchlists, and AI helpers.
</p>
```
with:
```jsx
<p className="text-xs text-zinc-500">
  Technical intelligence for AAPL, TSLA, and beyond.
</p>
```

**E. Tab active pill:** Find `bg-blue-500/20 text-blue-200` in the TABS map and replace with `bg-amber-400/15 text-amber-200`. Find `hover:text-blue-200` and replace with `hover:text-amber-200`.

**F. Sign-out button hover:** Find `hover:border-red-400 hover:text-red-300` — keep it (red for destructive is correct).

**G. Header background update:**
```jsx
<div className="min-h-screen bg-slate-950 pb-16">
```
→ `bg-zinc-950`

```jsx
<header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
```
→ `border-zinc-800 bg-zinc-950/90`

- [ ] **Step 5: Update StockChart.jsx accent colors**

In StockChart.jsx:
- Replace `stroke="#1f2937"` (CartesianGrid) → `stroke="#27272a"`
- Replace `stroke="#475569"` (YAxis) → `stroke="#52525b"`
- Replace `backgroundColor: '#0f172a', borderColor: '#1e293b'` (tooltip styles) → `backgroundColor: '#18181b', borderColor: '#27272a'`
- The forecast stroke was already updated to `#fbbf24` (amber) in Task 2
- Replace `fill="#1d4ed8"` (volume area fill) → `fill="#3f3f46"` (neutral dark)
- Replace `stroke="#60a5fa"` (volume area stroke) → `stroke="#71717a"`

Also update the simulation chart in Dashboard.jsx:
- `stroke="#22d3ee"` (portfolio line) → keep cyan — it's portfolio value, not forecast, so cyan remains distinctive

- [ ] **Step 6: Run the dev server and do a visual pass**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend
npm run dev
```

Check each section:
1. Header: should say "Patterngrow" with smaller, tighter typography; amber tab pills
2. Sidebar: amber focus rings on inputs; amber accent on active indicator checkboxes
3. Charts: amber forecast cone; zinc-toned volume bar; dark tooltip
4. Market Regime panel: rendered with zinc card base
5. Signal Conviction chart: colored bars
6. Buttons: "Backtest Signals" (emerald), "Run Simulation" (amber), "Generate 60-day Forecast" (amber ghost)

Verify no sections show `uppercase` eyebrow on section headings (`h2`, `h3`). Data value labels (short ones under `<p>`) may keep `text-xs font-medium`.

- [ ] **Step 7: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add frontend/tailwind.config.js frontend/src/index.css frontend/src/App.jsx frontend/src/components/Dashboard.jsx frontend/src/components/StockChart.jsx
git commit -m "style: amber accent + zinc base + remove eyebrow pattern

Replace slate/blue palette with zinc/amber. Brand accent is amber-400
throughout. Remove uppercase tracking-wide from section headings — keep
only on short data labels. Scrollbar themed to match. Header renamed
to Patterngrow."
```

---

## Self-Review

**Spec coverage check:**
- [x] Prediction is non-typical: 3 linear models all gain vol-based cones; Monte Carlo GBM is a genuinely different model outputting 300 simulated paths
- [x] Forecast visualization is non-typical: amber cone with stacked Areas, not a single dashed line
- [x] Regime detection: new panel using already-computed ADX + client-side realized vol
- [x] Signal conviction: bar chart with conviction scores replacing text list
- [x] Visual identity: amber replaces blue, zinc replaces slate, eyebrow pattern removed, header rebranded

**Placeholder scan:** No TBDs, no "implement later" — every step has real code.

**Type consistency:**
- `predictFuturePrices` returns `{ forecast, forecastCloud, forecastVol }` — used consistently in computeSignals.js and unpacked before the return
- `ForecastPoint.lower68/upper68/lower95/upper95` — set in predictions.js, merged into chartData in Dashboard.jsx, consumed as `forecastLower68` etc. in StockChart.jsx (renamed to avoid Recharts field collision with raw data fields)
- `forecastBand68Height` = `upper68 - lower68` computed in chartData — consumed by the stacked Area with `stackId="cone68"`
- `RegimePanel` props: `indicatorSnapshots` (already in Dashboard state), `stockData` (already in Dashboard state) — both names match

**Potential gaps:**
- The `forecastCloud` state reset in `applyInsights(null)` is specified (Step 3, Task 2)
- The `signalSeries` state reset is specified in the same step
- The `hasForecastCloud` prop name matches usage in StockChart.jsx
- The `SIGNAL_STRENGTH` object keys match the signal labels from `backtesting.js` (`buy_strong`, `buy_medium`, `buy_weak`, `sell_weak`, `sell_medium`, `sell_strong`)

---

*Plan saved. Total: 5 tasks, ~25 steps across 8 files.*
