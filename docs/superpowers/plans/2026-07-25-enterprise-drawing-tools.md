# Enterprise Drawing Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the stock chart from a line chart with basic stamp-click trend lines to an enterprise-grade charting surface with candlestick OHLC bars, accurate coordinate mapping, multiple drawing tools (trend line / horizontal / extended), price snap, extended-to-edge rendering, drag handles, and price labels.

**Architecture:** A `CandlestickBars` Customized component replaces the close-price `<Line>` inside the Recharts `ComposedChart`. A `scalesRef` (React ref) is populated by `TrendLineOverlay` on each render with the real Recharts D3 scale functions, eliminating the hardcoded `PLOT_TOP`/`PLOT_HEIGHT` approximation. The line data model gains a `type` field (`trend-line` | `horizontal` | `extended-line`) and `TrendLineOverlay` handles rendering differences per type. Drag state lives in Dashboard and is communicated down via props; hover state lives in `TrendLineOverlay` as local state.

**Tech Stack:** React 18, Recharts 3.3.0 (Customized component), D3 band/linear scales (via Recharts internals), Tailwind CSS, no new npm dependencies.

## Global Constraints

- ESM syntax throughout — no `require`, `.js` extension on all imports.
- Design system: `zinc-*` neutrals, `amber-400` primary accent, `emerald-500`/`#10b981` bullish candles, `red-500`/`#ef4444` bearish candles. No `slate-*` or `blue-*`.
- No new npm packages — use only what is already installed (Recharts 3.3.0, React 18, Tailwind).
- No TypeScript — plain `.jsx` files throughout.
- `StockChart.jsx` props interface must stay backward-compatible: all new props have defaults so callers with only `data + interval + selectedIndicators + forecastModel` still work.
- Build verification after every task: `cd frontend && npm run build` must exit 0 with no errors.
- The existing `TrendLineOverlay` Customized component lives inside `StockChart.jsx` (not a separate file) — keep it there.
- `CandlestickBars` also lives inside `StockChart.jsx` as a module-level function (same pattern as `TrendLineOverlay`).
- All drawn lines are stored in data-space `{ id, type, x1, y1, x2, y2 }` so they survive chart resize. Horizontal lines use `x1: null, x2: null, y1 === y2`.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/components/StockChart.jsx` | **Modify** | Add `CandlestickBars` function; upgrade `TrendLineOverlay` (scalesRef, types, drag handles, labels, extended rendering); add new props |
| `frontend/src/components/Dashboard.jsx` | **Modify** | Replace `PLOT_TOP`/`PLOT_HEIGHT`/`pixelToPrice` with scalesRef; add `drawingTool` state; add `draggingHandle` state; upgrade toolbar UI |

---

## Task 1: Candlestick OHLC chart

Replaces the flat `<Line dataKey="close">` with a `CandlestickBars` Customized component that draws green/red OHLC candles using the real Recharts D3 scales.

**Files:**
- Modify: `frontend/src/components/StockChart.jsx` (lines 1–72 for new function, lines 193–201 for Line replacement)

**Interfaces:**
- Consumes: `chartData` (each row has `date`, `open`, `high`, `low`, `close`, `isForecast` fields — already present)
- Produces: `CandlestickBars` function (used internally via `<Customized component={CandlestickBars} chartData={chartData} />` as first Customized in the ComposedChart)

- [ ] **Step 1: Read the current file**

Open `frontend/src/components/StockChart.jsx`. Confirm it has a `<Line dataKey="close" yAxisId="price" ...>` starting around line 193 and a `<Customized component={TrendLineOverlay} ...>` near line 369.

- [ ] **Step 2: Add `CandlestickBars` function above `TrendLineOverlay`**

Insert this function at the top of the file, after the imports and before `function TrendLineOverlay`:

```jsx
function CandlestickBars({ xAxisMap, yAxisMap, offset, chartData }) {
  const xScale = xAxisMap?.[0]?.scale;
  const yScale = yAxisMap?.['price']?.scale;
  if (!xScale || !yScale || !offset) return null;

  // Recharts band scale: xScale(date) → left edge of band; bandwidth() → full band width.
  // Center x = left + bandwidth/2. Fall back to 6px slot if bandwidth unavailable.
  const bw = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 6;
  const halfBw = bw / 2;
  const bodyW = Math.max(Math.floor(bw * 0.65), 2);

  return (
    <g>
      {chartData
        .filter((d) => !d.isForecast && d.open != null && d.close != null && d.high != null && d.low != null)
        .map((d) => {
          const cx = xScale(d.date);
          if (cx == null) return null;
          const px = cx + halfBw + (offset.left ?? 0);
          const openY  = yScale(d.open)  + (offset.top ?? 0);
          const closeY = yScale(d.close) + (offset.top ?? 0);
          const highY  = yScale(d.high)  + (offset.top ?? 0);
          const lowY   = yScale(d.low)   + (offset.top ?? 0);
          const bullish = d.close >= d.open;
          const color = bullish ? '#10b981' : '#ef4444';
          const bodyTop = Math.min(openY, closeY);
          const bodyH   = Math.max(Math.abs(closeY - openY), 1);
          return (
            <g key={d.date}>
              {/* High-low wick */}
              <line x1={px} y1={highY} x2={px} y2={lowY} stroke={color} strokeWidth={1} />
              {/* Open-close body */}
              <rect x={px - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
            </g>
          );
        })}
    </g>
  );
}
```

- [ ] **Step 3: Replace the `<Line dataKey="close">` with `CandlestickBars` Customized**

In the `ComposedChart`, find:
```jsx
<Line
  type="monotone"
  dataKey="close"
  yAxisId="price"
  stroke="#d4d4d8"
  strokeWidth={2.2}
  dot={false}
  name="Close"
/>
```

Replace with:
```jsx
<Customized
  component={CandlestickBars}
  chartData={chartData}
/>
```

Also remove `name="Close"` from the Legend — it will no longer appear since Customized does not register with the Legend. No other change needed.

- [ ] **Step 4: Remove the duplicate `Customized` issue — ordering**

The `<Customized component={TrendLineOverlay} ...>` must remain the **last** child of `ComposedChart` so drawing lines render on top of candles. Confirm it is still last after the previous step.

- [ ] **Step 5: Verify build**

```bash
cd /path/to/project/frontend && npm run build 2>&1 | grep -iE "^.*error" | grep -v node_modules
```
Expected: no output (no errors).

- [ ] **Step 6: Visual check**

Run `npm run dev` in the frontend folder, open the dashboard, load AAPL. The chart should now show green/red candlestick bars instead of a line. Verify wicks (thin vertical lines) and bodies (filled rectangles) both appear. Bullish (close ≥ open) = green, bearish = red.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/StockChart.jsx
git commit -m "feat: replace line chart with candlestick OHLC bars (CandlestickBars Customized)"
```

---

## Task 2: Accurate coordinate system via scalesRef

Removes the broken `PLOT_TOP = 5` / `PLOT_HEIGHT = 320` approximation in Dashboard and replaces `pixelToPrice` with a ref-based approach that reads the real D3 `yScale.invert()` from Recharts internals, populated by `TrendLineOverlay` on each render.

**Files:**
- Modify: `frontend/src/components/StockChart.jsx` — `TrendLineOverlay` gets a `scalesRef` prop; it populates the ref on every render
- Modify: `frontend/src/components/Dashboard.jsx` — remove `PLOT_TOP`, `PLOT_HEIGHT`, `chartPriceDomain`, old `pixelToPrice`; add `scalesRef`; rewrite `pixelToPrice` as a function that reads from `scalesRef`

**Interfaces:**
- Produces: `scalesRef.current = { xScale, yScale, offset }` — used by Task 3 and Task 4 handlers

- [ ] **Step 1: Update `TrendLineOverlay` to accept and populate `scalesRef`**

In `StockChart.jsx`, change the `TrendLineOverlay` function signature and add ref population at the top:

Old signature:
```jsx
function TrendLineOverlay({ xAxisMap, yAxisMap, offset, drawnLines, pendingPoint, hoverPoint, onLineDelete }) {
  const xScale = xAxisMap?.[0]?.scale;
  const yScale = yAxisMap?.['price']?.scale;
  if (!xScale || !yScale || !offset) return null;
```

New signature (add `scalesRef` param, populate it before the null guard):
```jsx
function TrendLineOverlay({ xAxisMap, yAxisMap, offset, drawnLines, pendingPoint, hoverPoint, onLineDelete, scalesRef }) {
  const xScale = xAxisMap?.[0]?.scale;
  const yScale = yAxisMap?.['price']?.scale;
  // Populate the ref so Dashboard handlers can use the real D3 scales for coordinate conversion.
  if (scalesRef && xScale && yScale && offset) {
    scalesRef.current = { xScale, yScale, offset };
  }
  if (!xScale || !yScale || !offset) return null;
```

- [ ] **Step 2: Pass `scalesRef` through `StockChart` to `TrendLineOverlay`**

In `StockChart.jsx`, add `scalesRef = null` to the props destructuring:

Old:
```jsx
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

New (add `scalesRef = null`):
```jsx
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
  scalesRef = null,
}) {
```

Then in the `<Customized component={TrendLineOverlay} ...>` element, add `scalesRef={scalesRef}`:

Old:
```jsx
<Customized
  component={TrendLineOverlay}
  drawnLines={drawnLines}
  pendingPoint={pendingPoint}
  hoverPoint={hoverPoint}
  onLineDelete={onLineDelete}
/>
```

New:
```jsx
<Customized
  component={TrendLineOverlay}
  drawnLines={drawnLines}
  pendingPoint={pendingPoint}
  hoverPoint={hoverPoint}
  onLineDelete={onLineDelete}
  scalesRef={scalesRef}
/>
```

- [ ] **Step 3: Remove `PLOT_TOP`, `PLOT_HEIGHT`, `chartPriceDomain`, old `pixelToPrice` from Dashboard**

In `frontend/src/components/Dashboard.jsx`:

Delete these two module-level constants (around line 80–81):
```js
const PLOT_TOP = 5;
const PLOT_HEIGHT = 320;
```

Delete the `chartPriceDomain` useMemo (around lines 386–395):
```js
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

Delete the old `pixelToPrice` useCallback (around lines 397–405):
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

- [ ] **Step 4: Add `scalesRef` and the accurate `pixelToPrice` in Dashboard**

Add `useRef` to the React import if not already present (check line 1 of Dashboard.jsx — if `useRef` is missing, add it).

After the drawing state declarations (after `const [hoverPoint, setHoverPoint] = useState(null);`), add:

```js
const scalesRef = useRef(null);

const pixelToPrice = useCallback((chartY) => {
  const sc = scalesRef.current;
  if (!sc?.yScale?.invert || !sc?.offset) return null;
  const price = sc.yScale.invert(chartY - (sc.offset.top ?? 0));
  return Number.isFinite(price) ? price : null;
}, []); // reads from ref — no reactive deps needed
```

- [ ] **Step 5: Pass `scalesRef` to `StockChart` in Dashboard's JSX**

Find the `<StockChart ...>` element (around line 951) and add `scalesRef={scalesRef}`:

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
  scalesRef={scalesRef}
/>
```

- [ ] **Step 6: Verify build**

```bash
cd frontend && npm run build 2>&1 | grep -iE "^.*error" | grep -v node_modules
```
Expected: no output.

- [ ] **Step 7: Visual check**

Draw a trend line: enable Draw mode, click two points. The line should align precisely with where you clicked — no vertical offset. Previously clicks near the top/bottom of the chart were slightly off; now they should be exact.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/StockChart.jsx frontend/src/components/Dashboard.jsx
git commit -m "fix: replace PLOT_HEIGHT approximation with scalesRef D3 invert for accurate pixelToPrice"
```

---

## Task 3: Drawing modes — horizontal lines, extended lines, snap-to-price, toolbar

Adds three named drawing tools (trend line / horizontal / extended line), snap-to-price rounding on click, extended-to-edge line rendering, and a redesigned toolbar with tool-type selector buttons.

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx` — add `drawingTool` state; update `handleChartClick`; add `snapPrice` helper; update toolbar JSX
- Modify: `frontend/src/components/StockChart.jsx` — update `TrendLineOverlay` to render three line types; update `drawnLines` shape accepted

**Interfaces:**
- Consumes: `scalesRef` from Task 2 (accurate pixelToPrice)
- Produces: stored line shape `{ id: string, type: 'trend-line'|'horizontal'|'extended-line', x1: string|null, y1: number, x2: string|null, y2: number }` — consumed by Task 4's drag rendering

- [ ] **Step 1: Add `drawingTool` state in Dashboard**

Add after `const [drawingMode, setDrawingMode] = useState(false);`:
```js
const [drawingTool, setDrawingTool] = useState('trend-line'); // 'trend-line' | 'horizontal' | 'extended-line'
```

- [ ] **Step 2: Add `snapPrice` module-level helper in Dashboard**

Add before the `Dashboard` component function (alongside where `SIGNAL_STRENGTH` is defined):
```js
function snapPrice(price) {
  if (price == null || !Number.isFinite(price)) return price;
  const abs = Math.abs(price);
  if (abs >= 1000) return Math.round(price / 5) * 5;
  if (abs >= 100)  return Math.round(price);
  if (abs >= 10)   return Math.round(price * 4) / 4;       // nearest 0.25
  if (abs >= 1)    return Math.round(price * 20) / 20;     // nearest 0.05
  return Math.round(price * 100) / 100;                    // nearest 0.01
}
```

- [ ] **Step 3: Update `handleChartClick` for all three tools**

Replace the existing `handleChartClick` with:
```js
const handleChartClick = useCallback(
  (data) => {
    if (!drawingMode || !data?.activeLabel) return;
    const rawPrice = pixelToPrice(data.chartY);
    if (rawPrice == null) return;
    const price = snapPrice(rawPrice);

    if (drawingTool === 'horizontal') {
      // Single click — full-width horizontal line
      setDrawnLines((prev) => [
        ...prev,
        { id: Date.now().toString(), type: 'horizontal', x1: null, y1: price, x2: null, y2: price },
      ]);
      return;
    }

    // trend-line and extended-line: two-click flow
    const point = { x: data.activeLabel, y: price };
    if (!pendingPoint) {
      setPendingPoint(point);
    } else {
      setDrawnLines((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: drawingTool,
          x1: pendingPoint.x, y1: pendingPoint.y,
          x2: point.x, y2: point.y,
        },
      ]);
      setPendingPoint(null);
      setHoverPoint(null);
    }
  },
  [drawingMode, drawingTool, pendingPoint, pixelToPrice],
);
```

- [ ] **Step 4: Update `handleChartMouseMove` to snap the preview too**

Replace with:
```js
const handleChartMouseMove = useCallback(
  (data) => {
    if (!drawingMode || drawingTool === 'horizontal') {
      if (hoverPoint) setHoverPoint(null);
      return;
    }
    if (!pendingPoint || !data?.activeLabel) {
      if (hoverPoint) setHoverPoint(null);
      return;
    }
    const rawPrice = pixelToPrice(data.chartY);
    if (rawPrice == null) return;
    setHoverPoint({ x: data.activeLabel, y: snapPrice(rawPrice) });
  },
  [drawingMode, drawingTool, pendingPoint, hoverPoint, pixelToPrice],
);
```

- [ ] **Step 5: Update `TrendLineOverlay` to render three line types**

Replace the entire body of `TrendLineOverlay` (the return statement and helpers) with:

```jsx
function TrendLineOverlay({ xAxisMap, yAxisMap, offset, drawnLines, pendingPoint, hoverPoint, onLineDelete, scalesRef }) {
  const xScale = xAxisMap?.[0]?.scale;
  const yScale = yAxisMap?.['price']?.scale;
  if (scalesRef && xScale && yScale && offset) {
    scalesRef.current = { xScale, yScale, offset };
  }
  if (!xScale || !yScale || !offset) return null;

  const bw = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 0;

  const toX = (date) => {
    if (date == null) return null;
    const v = xScale(date);
    return v != null ? v + bw / 2 + (offset.left ?? 0) : null;
  };
  const toY = (price) => {
    const v = yScale(price);
    return v != null ? v + (offset.top ?? 0) : null;
  };

  const plotLeft  = (offset.left ?? 0);
  const plotRight = (offset.left ?? 0) + (offset.width ?? 0);

  // For extended lines: compute where the infinite line through (x1,y1)→(x2,y2) intersects the plot edges.
  const extendLine = (px1, py1, px2, py2) => {
    if (px1 === px2) return { ex1: px1, ey1: (offset.top ?? 0), ex2: px2, ey2: (offset.top ?? 0) + (offset.height ?? 0) };
    const slope = (py2 - py1) / (px2 - px1);
    const intercept = py1 - slope * px1;
    const yAtLeft  = slope * plotLeft  + intercept;
    const yAtRight = slope * plotRight + intercept;
    return { ex1: plotLeft, ey1: yAtLeft, ex2: plotRight, ey2: yAtRight };
  };

  return (
    <g>
      {drawnLines.map((line) => {
        const y1 = toY(line.y1);
        const y2 = toY(line.y2);
        if (y1 == null || y2 == null) return null;

        let rx1, ry1, rx2, ry2;

        if (line.type === 'horizontal') {
          rx1 = plotLeft;  ry1 = y1;
          rx2 = plotRight; ry2 = y1;
        } else {
          const x1 = toX(line.x1);
          const x2 = toX(line.x2);
          if (x1 == null || x2 == null) return null;
          if (line.type === 'extended-line') {
            const ext = extendLine(x1, y1, x2, y2);
            rx1 = ext.ex1; ry1 = ext.ey1; rx2 = ext.ex2; ry2 = ext.ey2;
          } else {
            rx1 = x1; ry1 = y1; rx2 = x2; ry2 = y2;
          }
        }

        // Price label at right edge
        const labelPrice = line.y1.toFixed(line.y1 >= 100 ? 2 : line.y1 >= 10 ? 2 : 3);
        const labelX = plotRight + 4;
        const labelY = line.type === 'horizontal' ? ry1 : ry2;

        return (
          <g key={line.id}>
            <line x1={rx1} y1={ry1} x2={rx2} y2={ry2}
              stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" />
            {/* Wide invisible hit target for delete */}
            <line x1={rx1} y1={ry1} x2={rx2} y2={ry2}
              stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onLineDelete?.(line.id); }} />
            {/* Price label */}
            <rect x={labelX} y={labelY - 9} width={44} height={16} rx={3} fill="#18181b" />
            <text x={labelX + 3} y={labelY + 3} fontSize={10} fill="#fbbf24" fontFamily="monospace">
              ${labelPrice}
            </text>
          </g>
        );
      })}

      {/* Dashed preview line */}
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

- [ ] **Step 6: Replace the drawing toolbar in Dashboard JSX**

Find the `{/* Drawing toolbar */}` div (around line 907) and replace the entire div with:

```jsx
{/* Drawing toolbar */}
<div className="flex flex-wrap items-center gap-2">
  {/* Tool type selector — only visible in draw mode */}
  {drawingMode ? (
    <div className="flex items-center rounded-md border border-zinc-700 overflow-hidden">
      {[
        { key: 'trend-line',    label: 'Trend' },
        { key: 'horizontal',    label: 'H-Line' },
        { key: 'extended-line', label: 'Extended' },
      ].map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => setDrawingTool(key)}
          className={`px-2.5 py-1 text-xs font-semibold transition ${
            drawingTool === key
              ? 'bg-amber-400 text-zinc-900'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null}

  {/* Draw / Stop button */}
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
    {drawingMode ? '✓ Done' : '✏ Draw'}
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
    <span className="text-xs text-zinc-500">Click to set endpoint</span>
  ) : drawingMode && drawingTool === 'horizontal' ? (
    <span className="text-xs text-zinc-500">Click anywhere to place a horizontal line</span>
  ) : drawingMode ? (
    <span className="text-xs text-zinc-500">Click to start drawing</span>
  ) : null}
</div>
```

Also reset `drawingTool` when clearing state on symbol change:
Find the symbol-change `useEffect` and add `setDrawingTool('trend-line');`:
```js
useEffect(() => {
  setDrawnLines([]);
  setPendingPoint(null);
  setHoverPoint(null);
  setDrawingMode(false);
  setDrawingTool('trend-line');
}, [symbol]);
```

- [ ] **Step 7: Verify build**

```bash
cd frontend && npm run build 2>&1 | grep -iE "^.*error" | grep -v node_modules
```
Expected: no output.

- [ ] **Step 8: Visual check**

1. Enable Draw mode → select "H-Line" → click once → a full-width horizontal amber line appears with a price label on the right.
2. Switch to "Extended" → click two points → the line extends to both chart edges.
3. Switch to "Trend" → click two points → finite segment between the two dates.
4. Prices should snap to clean levels: clicking near $147.63 should store $147.50 (nearest 0.25 for a $100+ stock).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/StockChart.jsx frontend/src/components/Dashboard.jsx
git commit -m "feat: horizontal lines, extended lines, snap-to-price, price labels, toolbar redesign"
```

---

## Task 4: Drag handles — reposition lines after drawing

Adds visible circular handles at both endpoints of each line (and a midpoint for horizontal lines). Hovering a line reveals handles; dragging a handle repositions that endpoint in real time.

**Files:**
- Modify: `frontend/src/components/StockChart.jsx` — `TrendLineOverlay` gains `hoveredLineId`/`setHoveredLineId` local state and handle circles; new `onDragStart` prop
- Modify: `frontend/src/components/Dashboard.jsx` — add `draggingHandle` state; update `handleChartMouseMove` and `handleChartMouseUp`; pass `onDragStart` and `onChartMouseUp` to StockChart

**Interfaces:**
- Consumes: `scalesRef` from Task 2 (for live coordinate conversion during drag)
- `drawnLines` shape from Task 3: `{ id, type, x1, y1, x2, y2 }`

- [ ] **Step 1: Add `draggingHandle` state in Dashboard**

After the existing drawing state declarations:
```js
const [draggingHandle, setDraggingHandle] = useState(null); // { lineId: string, endpoint: 'start'|'end' } | null
```

- [ ] **Step 2: Update `handleChartMouseMove` to move handles during drag**

Replace `handleChartMouseMove` with:
```js
const handleChartMouseMove = useCallback(
  (data) => {
    if (draggingHandle) {
      // Drag mode — update the dragged endpoint
      const rawPrice = pixelToPrice(data.chartY);
      if (rawPrice == null || !data?.activeLabel) return;
      const newPrice = snapPrice(rawPrice);
      const newDate  = data.activeLabel;
      setDrawnLines((prev) => prev.map((l) => {
        if (l.id !== draggingHandle.lineId) return l;
        if (l.type === 'horizontal') return { ...l, y1: newPrice, y2: newPrice };
        if (draggingHandle.endpoint === 'start') return { ...l, x1: newDate, y1: newPrice };
        return { ...l, x2: newDate, y2: newPrice };
      }));
      return;
    }
    if (!drawingMode || drawingTool === 'horizontal') {
      if (hoverPoint) setHoverPoint(null);
      return;
    }
    if (!pendingPoint || !data?.activeLabel) {
      if (hoverPoint) setHoverPoint(null);
      return;
    }
    const rawPrice = pixelToPrice(data.chartY);
    if (rawPrice == null) return;
    setHoverPoint({ x: data.activeLabel, y: snapPrice(rawPrice) });
  },
  [draggingHandle, drawingMode, drawingTool, pendingPoint, hoverPoint, pixelToPrice],
);
```

- [ ] **Step 3: Add `handleChartMouseUp` in Dashboard**

Add after `handleLineDelete`:
```js
const handleChartMouseUp = useCallback(() => {
  if (draggingHandle) setDraggingHandle(null);
}, [draggingHandle]);
```

- [ ] **Step 4: Add `onDragStart` callback in Dashboard**

```js
const handleDragStart = useCallback((lineId, endpoint) => {
  setDraggingHandle({ lineId, endpoint });
  setPendingPoint(null); // cancel any in-progress drawing
}, []);
```

- [ ] **Step 5: Pass new props to `StockChart`**

Update the `<StockChart>` JSX to add three new props:
```jsx
<StockChart
  ...existing props...
  scalesRef={scalesRef}
  onDragStart={handleDragStart}
  onChartMouseUp={handleChartMouseUp}
  isDragging={draggingHandle != null}
/>
```

- [ ] **Step 6: Add new props to `StockChart` function signature**

Update the destructuring in `StockChart`:
```jsx
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
  scalesRef = null,
  onDragStart,
  onChartMouseUp,
  isDragging = false,
}) {
```

Add `onMouseUp={onChartMouseUp}` to the `ComposedChart` element:
```jsx
<ComposedChart
  data={chartData}
  onClick={onChartClick}
  onMouseMove={onChartMouseMove}
  onMouseUp={onChartMouseUp}
  style={(drawingMode || isDragging) ? { cursor: isDragging ? 'grabbing' : 'crosshair' } : undefined}
>
```

Pass `onDragStart` through the `<Customized component={TrendLineOverlay} ...>`:
```jsx
<Customized
  component={TrendLineOverlay}
  drawnLines={drawnLines}
  pendingPoint={pendingPoint}
  hoverPoint={hoverPoint}
  onLineDelete={onLineDelete}
  scalesRef={scalesRef}
  onDragStart={onDragStart}
/>
```

- [ ] **Step 7: Add hover state and handle circles to `TrendLineOverlay`**

`TrendLineOverlay` is a plain function (not a React component with hooks), so hover state must use a ref-based approach via a wrapper. Convert `TrendLineOverlay` to properly use React's `useState` by wrapping it — **this requires making it a proper React component rendered via Customized**.

Replace the `TrendLineOverlay` function signature and add local state. Recharts Customized passes all extra props to the component. Add `useState` at the top of the TrendLineOverlay component (it IS a React component — Recharts calls it with `React.createElement`):

Add `useState` to the React import in `StockChart.jsx` (currently only `useMemo, useCallback` are imported):
```jsx
import { useState, useMemo, useCallback } from 'react';
```

Then update `TrendLineOverlay` to add hover state and handle circles:

```jsx
function TrendLineOverlay({ xAxisMap, yAxisMap, offset, drawnLines, pendingPoint, hoverPoint, onLineDelete, scalesRef, onDragStart }) {
  const [hoveredId, setHoveredId] = useState(null);
  const xScale = xAxisMap?.[0]?.scale;
  const yScale = yAxisMap?.['price']?.scale;
  if (scalesRef && xScale && yScale && offset) {
    scalesRef.current = { xScale, yScale, offset };
  }
  if (!xScale || !yScale || !offset) return null;

  const bw = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 0;

  const toX = (date) => {
    if (date == null) return null;
    const v = xScale(date);
    return v != null ? v + bw / 2 + (offset.left ?? 0) : null;
  };
  const toY = (price) => {
    const v = yScale(price);
    return v != null ? v + (offset.top ?? 0) : null;
  };

  const plotLeft  = (offset.left  ?? 0);
  const plotRight = (offset.left  ?? 0) + (offset.width  ?? 0);

  const extendLine = (px1, py1, px2, py2) => {
    if (px1 === px2) return { ex1: px1, ey1: offset.top ?? 0, ex2: px2, ey2: (offset.top ?? 0) + (offset.height ?? 0) };
    const slope = (py2 - py1) / (px2 - px1);
    const intercept = py1 - slope * px1;
    return { ex1: plotLeft, ey1: slope * plotLeft + intercept, ex2: plotRight, ey2: slope * plotRight + intercept };
  };

  const HANDLE_R = 5;

  return (
    <g>
      {drawnLines.map((line) => {
        const y1px = toY(line.y1);
        const y2px = toY(line.y2);
        if (y1px == null || y2px == null) return null;

        let rx1, ry1, rx2, ry2;
        let h1x, h1y, h2x, h2y; // handle positions

        if (line.type === 'horizontal') {
          rx1 = plotLeft;  ry1 = y1px;
          rx2 = plotRight; ry2 = y1px;
          h1x = plotLeft  + (plotRight - plotLeft) * 0.25; h1y = y1px;
          h2x = plotLeft  + (plotRight - plotLeft) * 0.75; h2y = y1px;
        } else {
          const x1px = toX(line.x1);
          const x2px = toX(line.x2);
          if (x1px == null || x2px == null) return null;
          if (line.type === 'extended-line') {
            const ext = extendLine(x1px, y1px, x2px, y2px);
            rx1 = ext.ex1; ry1 = ext.ey1; rx2 = ext.ex2; ry2 = ext.ey2;
          } else {
            rx1 = x1px; ry1 = y1px; rx2 = x2px; ry2 = y2px;
          }
          h1x = x1px; h1y = y1px;
          h2x = x2px; h2y = y2px;
        }

        const isHovered = hoveredId === line.id;
        const labelPrice = line.y1 >= 100 ? line.y1.toFixed(2) : line.y1 >= 10 ? line.y1.toFixed(2) : line.y1.toFixed(3);
        const labelY = line.type === 'horizontal' ? ry1 : ry2;

        return (
          <g key={line.id}
            onMouseEnter={() => setHoveredId(line.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Visible line */}
            <line x1={rx1} y1={ry1} x2={rx2} y2={ry2}
              stroke="#fbbf24" strokeWidth={isHovered ? 2.5 : 2} strokeLinecap="round" />
            {/* Wide invisible hit target for delete */}
            <line x1={rx1} y1={ry1} x2={rx2} y2={ry2}
              stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onLineDelete?.(line.id); }} />
            {/* Price label */}
            <rect x={plotRight + 4} y={labelY - 9} width={48} height={16} rx={3} fill="#18181b" />
            <text x={plotRight + 7} y={labelY + 3} fontSize={10} fill="#fbbf24" fontFamily="monospace">
              ${labelPrice}
            </text>
            {/* Drag handles — visible on hover */}
            {isHovered && onDragStart ? (
              <>
                <circle cx={h1x} cy={h1y} r={HANDLE_R}
                  fill="#fbbf24" stroke="#18181b" strokeWidth={1.5}
                  style={{ cursor: 'grab' }}
                  onMouseDown={(e) => { e.stopPropagation(); onDragStart(line.id, 'start'); }} />
                <circle cx={h2x} cy={h2y} r={HANDLE_R}
                  fill="#fbbf24" stroke="#18181b" strokeWidth={1.5}
                  style={{ cursor: 'grab' }}
                  onMouseDown={(e) => { e.stopPropagation(); onDragStart(line.id, 'end'); }} />
              </>
            ) : null}
          </g>
        );
      })}

      {/* Dashed preview line */}
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

- [ ] **Step 8: Verify build**

```bash
cd frontend && npm run build 2>&1 | grep -iE "^.*error" | grep -v node_modules
```
Expected: no output.

- [ ] **Step 9: Visual check — drag handles**

1. Draw any line (trend, horizontal, or extended).
2. Hover the line — two amber circles appear at the endpoints.
3. Click and drag a circle — the endpoint follows the mouse in real time, snapping to clean prices.
4. Release — the line stays in the new position.
5. Click the line body (not a handle) — line deletes (existing behavior preserved).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/StockChart.jsx frontend/src/components/Dashboard.jsx
git commit -m "feat: drag handles for repositioning drawn lines, hover highlight, grabbing cursor"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Candlestick chart → Task 1
- ✅ Accurate coordinate system → Task 2 (scalesRef + D3 yScale.invert)
- ✅ Snap-to-price → Task 3 (snapPrice helper, applied in handleChartClick and handleChartMouseMove)
- ✅ Horizontal lines (one-click support/resistance) → Task 3
- ✅ Extended lines to chart edges → Task 3 (extendLine helper in TrendLineOverlay)
- ✅ Price labels → Task 3 (amber label at right edge of each line)
- ✅ Drag handles → Task 4
- ✅ Build verification → each task ends with build check

**Placeholder scan:** None found — all code is complete.

**Type consistency:** `drawnLines` shape `{ id, type, x1, y1, x2, y2 }` introduced in Task 3 Step 3 (`handleChartClick`) and consumed identically in Task 3 Step 5 (`TrendLineOverlay`) and Task 4 Step 7 (`TrendLineOverlay` with handles). `scalesRef` created Task 2 Step 4, populated Task 2 Step 1, consumed Task 2 Step 5, Task 3, Task 4. Consistent throughout.
