import { useState, useMemo, useCallback, useLayoutEffect, useRef } from 'react';
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
import {
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateStochasticOscillator,
  calculateVWAP,
} from '../lib/indicators';

// Fixed layout constants — must match ComposedChart margin + explicit axis sizes below.
const CHART_MARGIN = { top: 5, right: 5, left: 5, bottom: 5 };
const Y_AXIS_W = 62;
const X_AXIS_H = 30;

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

const tooltipFormatter = (value, name) => {
  if (value == null) return null;
  const label = name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  if (typeof value === 'number') {
    return [value.toFixed(2), label];
  }
  return [value, label];
};

export default function StockChart({
  data, interval, selectedIndicators, forecastModel, hasForecastCloud,
  showForecast = true,
  drawingMode = false,
  drawnLines = [],
  pendingPoint = null,
  hoverPoint = null,
  onDrawingClick,
  onDrawingMove,
  onLineDelete,
  onDragStart,
  isDragging = false,
}) {
  const plotContainerRef = useRef(null);
  const plotBoundsRef = useRef(null);
  const [hoveredLineId, setHoveredLineId] = useState(null);

  const actualData = useMemo(() => data.filter((row) => !row.isForecast), [data]);

  // Calculate only the indicators that are currently toggled on.
  const indicatorData = useMemo(() => {
    const context = {};
    if (selectedIndicators.includes('sma')) {
      context.sma = calculateSMA(actualData, 20);
    }
    if (selectedIndicators.includes('bollinger')) {
      context.bollinger = calculateBollingerBands(actualData, 20, 2);
    }
    if (selectedIndicators.includes('vwap')) {
      context.vwap = calculateVWAP(actualData);
    }
    if (selectedIndicators.includes('rsi')) {
      context.rsi = calculateRSI(actualData);
    }
    if (selectedIndicators.includes('macd')) {
      context.macd = calculateMACD(actualData);
    }
    if (selectedIndicators.includes('stochastic')) {
      context.stochastic = calculateStochasticOscillator(actualData);
    }
    return context;
  }, [actualData, selectedIndicators]);

  const chartData = useMemo(() => {
    return data.map((row, index) => ({
      ...row,
      // Inject precomputed indicator series so Recharts can consume them.
      sma20: indicatorData.sma?.[index] ?? null,
      bollingerUpper: indicatorData.bollinger?.upper?.[index] ?? null,
      bollingerLower: indicatorData.bollinger?.lower?.[index] ?? null,
      bollingerMiddle: indicatorData.bollinger?.middle?.[index] ?? null,
      vwap: indicatorData.vwap?.[index] ?? null,
      volume: row.volume ?? null,
      rsi: indicatorData.rsi?.[index] ?? null,
      macd: indicatorData.macd?.macd?.[index] ?? null,
      macdSignal: indicatorData.macd?.signal?.[index] ?? null,
      stochasticK: indicatorData.stochastic?.percentK?.[index] ?? null,
      stochasticD: indicatorData.stochastic?.percentD?.[index] ?? null,
    }));
  }, [data, indicatorData]);

  const priceDomain = useMemo(() => {
    const nonForecast = chartData.filter((row) => !row.isForecast);
    const lows  = nonForecast.map((row) => row.low  ?? row.close).filter((v) => v != null);
    const highs = nonForecast.map((row) => row.high ?? row.close).filter((v) => v != null);
    if (!lows.length) return ['auto', 'auto'];
    const mn = Math.min(...lows);
    const mx = Math.max(...highs);
    const pad = Math.max((mx - mn) * 0.06, mx * 0.01);
    return [mn - pad, mx + pad];
  }, [chartData]);

  const xTickFormatter = useCallback(
    (value) => formatAxisTick(value, interval),
    [interval],
  );

  const forecastStartIndex = useMemo(() => chartData.findIndex((row) => row.isForecast), [chartData]);

  const dates = useMemo(() => chartData.map((r) => r.date), [chartData]);

  // Update plot bounds after every render so the SVG overlay always has accurate coordinates.
  useLayoutEffect(() => {
    const el = plotContainerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = CHART_MARGIN.left + Y_AXIS_W;
    const top = CHART_MARGIN.top;
    const right = width - CHART_MARGIN.right;
    const bottom = height - CHART_MARGIN.bottom - X_AXIS_H;
    plotBoundsRef.current = { left, top, right, bottom, width: right - left, height: bottom - top };
  });

  const handleOverlayClick = useCallback((e) => {
    if (!drawingMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    const b = plotBoundsRef.current;
    if (!b || svgX < b.left || svgX > b.right || svgY < b.top || svgY > b.bottom) return;
    const [minP, maxP] = priceDomain;
    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || b.height <= 0 || b.width <= 0) return;
    const price = maxP - ((svgY - b.top) / b.height) * (maxP - minP);
    const dateIdx = Math.round(((svgX - b.left) / b.width) * (dates.length - 1));
    const date = dates[Math.max(0, Math.min(dates.length - 1, dateIdx))] ?? null;
    if (date != null) onDrawingClick?.(date, price);
  }, [drawingMode, priceDomain, dates, onDrawingClick]);

  const handleOverlayMouseMove = useCallback((e) => {
    if (!drawingMode && !isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;
    const b = plotBoundsRef.current;
    if (!b || svgX < b.left || svgX > b.right || svgY < b.top || svgY > b.bottom) {
      onDrawingMove?.(null, null);
      return;
    }
    const [minP, maxP] = priceDomain;
    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || b.height <= 0 || b.width <= 0) return;
    const price = maxP - ((svgY - b.top) / b.height) * (maxP - minP);
    const dateIdx = Math.round(((svgX - b.left) / b.width) * (dates.length - 1));
    const date = dates[Math.max(0, Math.min(dates.length - 1, dateIdx))] ?? null;
    onDrawingMove?.(date, price);
  }, [drawingMode, isDragging, priceDomain, dates, onDrawingMove]);

  return (
    <div className="space-y-6">
      <div className="h-[360px] rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div ref={plotContainerRef} className="relative w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={CHART_MARGIN}
          >
            <defs>
              <linearGradient id="smaGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis dataKey="date" height={X_AXIS_H} tickFormatter={xTickFormatter} minTickGap={24} />
            <YAxis yAxisId="price" width={Y_AXIS_W} stroke="#52525b" domain={priceDomain} tickFormatter={(v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))} />
            <Tooltip
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem' }}
              labelFormatter={(value) => `Date: ${formatAxisTick(value, interval)}`}
              formatter={tooltipFormatter}
            />
            <Legend verticalAlign="top" height={36} />
            <Customized
              component={CandlestickBars}
              chartData={chartData}
            />
            {selectedIndicators.includes('sma') ? (
              <Line
                type="monotone"
                dataKey="sma20"
                yAxisId="price"
                stroke="#22d3ee"
                strokeWidth={1.8}
                dot={false}
                name="SMA 20"
              />
            ) : null}
            {selectedIndicators.includes('bollinger') ? (
              <>
                <Line
                  type="monotone"
                  dataKey="bollingerUpper"
                  yAxisId="price"
                  stroke="#a855f7"
                  strokeDasharray="4 4"
                  dot={false}
                  name="Bollinger Upper"
                />
                <Line
                  type="monotone"
                  dataKey="bollingerLower"
                  yAxisId="price"
                  stroke="#ec4899"
                  strokeDasharray="4 4"
                  dot={false}
                  name="Bollinger Lower"
                />
              </>
            ) : null}
            {selectedIndicators.includes('vwap') ? (
              <Line
                type="monotone"
                dataKey="vwap"
                yAxisId="price"
                stroke="#facc15"
                strokeWidth={1.6}
                dot={false}
                name="VWAP"
              />
            ) : null}
            {showForecast && forecastStartIndex > -1 ? (
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
                {showForecast && hasForecastCloud ? (
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
          </ComposedChart>
        </ResponsiveContainer>

        {/* SVG overlay — native events, no Recharts dependency for drawing */}
        <svg
          className="absolute inset-0 w-full h-full"
          style={{
            overflow: 'hidden',
            pointerEvents: (drawingMode || isDragging) ? 'all' : 'none',
            cursor: drawingMode ? 'crosshair' : isDragging ? 'grabbing' : 'default',
          }}
          onClick={handleOverlayClick}
          onMouseMove={handleOverlayMouseMove}
        >
          {(() => {
            const b = plotBoundsRef.current;
            if (!b || b.height <= 0 || b.width <= 0) return null;
            const [minP, maxP] = priceDomain;
            if (!Number.isFinite(minP) || !Number.isFinite(maxP) || maxP <= minP) return null;
            const range = maxP - minP;
            const toY = (p) => b.top + ((maxP - p) / range) * b.height;
            const toX = (d) => {
              const idx = dates.indexOf(d);
              return idx === -1 ? null : b.left + (idx / Math.max(dates.length - 1, 1)) * b.width;
            };
            return (
              <>
                <defs>
                  <clipPath id="chartClip">
                    <rect x={b.left} y={b.top} width={b.width} height={b.height} />
                  </clipPath>
                </defs>
                {drawnLines.map((line) => {
                  const y1px = toY(line.y1);
                  const y2px = line.type === 'horizontal' ? y1px : toY(line.y2);
                  let rx1, ry1, rx2, ry2, h1x, h1y, h2x, h2y;
                  if (line.type === 'horizontal') {
                    rx1 = b.left; ry1 = y1px; rx2 = b.right; ry2 = y1px;
                    h1x = b.left + b.width * 0.25; h1y = y1px;
                    h2x = b.left + b.width * 0.75; h2y = y1px;
                  } else {
                    const x1px = toX(line.x1);
                    const x2px = toX(line.x2);
                    if (x1px == null || x2px == null) return null;
                    if (line.type === 'extended-line') {
                      if (x1px !== x2px) {
                        const slope = (y2px - y1px) / (x2px - x1px);
                        const ic = y1px - slope * x1px;
                        rx1 = b.left; ry1 = slope * b.left + ic;
                        rx2 = b.right; ry2 = slope * b.right + ic;
                      } else {
                        rx1 = x1px; ry1 = b.top; rx2 = x2px; ry2 = b.bottom;
                      }
                    } else {
                      rx1 = x1px; ry1 = y1px; rx2 = x2px; ry2 = y2px;
                    }
                    h1x = x1px; h1y = y1px;
                    h2x = x2px; h2y = y2px;
                  }
                  const isHov = hoveredLineId === line.id;
                  const labelVal = line.y2 ?? line.y1;
                  const lp = labelVal >= 1000 ? labelVal.toFixed(0) : labelVal >= 100 ? labelVal.toFixed(1) : labelVal.toFixed(2);
                  const labelY = line.type === 'horizontal' ? ry1 : ry2;
                  return (
                    <g key={line.id}
                      onMouseEnter={() => setHoveredLineId(line.id)}
                      onMouseLeave={() => setHoveredLineId(null)}
                    >
                      <g clipPath="url(#chartClip)">
                        <line x1={rx1} y1={ry1} x2={rx2} y2={ry2}
                          stroke="#fbbf24" strokeWidth={isHov ? 2.5 : 2} strokeLinecap="round"
                          style={{ pointerEvents: 'none' }} />
                        <line x1={rx1} y1={ry1} x2={rx2} y2={ry2}
                          stroke="transparent" strokeWidth={14}
                          style={{ cursor: 'pointer', pointerEvents: 'all' }}
                          onClick={(ev) => { ev.stopPropagation(); onLineDelete?.(line.id); }} />
                      </g>
                      <text x={b.right - 4} y={labelY - 4} fontSize={10} fill="#fbbf24"
                        fontFamily="monospace" textAnchor="end" style={{ pointerEvents: 'none' }}>
                        ${lp}
                      </text>
                      {isHov && onDragStart ? (
                        <>
                          <circle cx={h1x} cy={h1y} r={5} fill="#fbbf24" stroke="#18181b" strokeWidth={1.5}
                            style={{ cursor: 'grab', pointerEvents: 'all' }}
                            onMouseDown={(ev) => { ev.stopPropagation(); onDragStart(line.id, 'start'); }} />
                          <circle cx={h2x} cy={h2y} r={5} fill="#fbbf24" stroke="#18181b" strokeWidth={1.5}
                            style={{ cursor: 'grab', pointerEvents: 'all' }}
                            onMouseDown={(ev) => { ev.stopPropagation(); onDragStart(line.id, 'end'); }} />
                        </>
                      ) : null}
                    </g>
                  );
                })}
                {pendingPoint && hoverPoint ? (() => {
                  const px = toX(pendingPoint.x); const py = toY(pendingPoint.y);
                  const hx = toX(hoverPoint.x); const hy = toY(hoverPoint.y);
                  if (px == null || py == null || hx == null || hy == null) return null;
                  return (
                    <g clipPath="url(#chartClip)">
                      <circle cx={px} cy={py} r={4} fill="#fbbf24" stroke="#18181b" strokeWidth={1.5}
                        style={{ pointerEvents: 'none' }} />
                      <line x1={px} y1={py} x2={hx} y2={hy}
                        stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="6 3" strokeLinecap="round"
                        style={{ pointerEvents: 'none' }} />
                    </g>
                  );
                })() : null}
                {pendingPoint && !hoverPoint ? (() => {
                  const x = toX(pendingPoint.x); const y = toY(pendingPoint.y);
                  if (x == null || y == null) return null;
                  return (
                    <g clipPath="url(#chartClip)">
                      <circle cx={x} cy={y} r={4} fill="#fbbf24" stroke="#18181b" strokeWidth={1.5}
                        style={{ pointerEvents: 'none' }} />
                    </g>
                  );
                })() : null}
              </>
            );
          })()}
        </svg>
        </div>
      </div>

      <div className="h-40 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={xTickFormatter} minTickGap={24} />
            <YAxis tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`} stroke="#52525b" />
            <Tooltip
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem' }}
              labelFormatter={(value) => `Date: ${formatAxisTick(value, interval)}`}
              formatter={(value) => [`${(value / 1_000_000).toFixed(2)}M`, 'Volume']}
            />
            <Legend verticalAlign="top" height={28} />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="#71717a"
              fill="#3f3f46"
              fillOpacity={0.35}
              name="Volume"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {selectedIndicators.includes('rsi') ? (
        <div className="h-48 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} minTickGap={24} />
              <YAxis domain={[0, 100]} stroke="#52525b" />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem' }}
                labelFormatter={(value) => `Date: ${formatAxisTick(value, interval)}`}
                formatter={tooltipFormatter}
              />
              <Legend verticalAlign="top" height={36} />
              <Line type="monotone" dataKey="rsi" stroke="#f97316" strokeWidth={1.5} dot={false} name="RSI" />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '70', position: 'insideLeft', fill: '#ef4444' }} />
              <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 4" label={{ value: '30', position: 'insideLeft', fill: '#22c55e' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {selectedIndicators.includes('macd') ? (
        <div className="h-48 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} minTickGap={24} />
              <YAxis stroke="#52525b" />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem' }}
                labelFormatter={(value) => `Date: ${formatAxisTick(value, interval)}`}
                formatter={tooltipFormatter}
              />
              <Legend verticalAlign="top" height={36} />
              <Line type="monotone" dataKey="macd" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="MACD" />
              <Line type="monotone" dataKey="macdSignal" stroke="#facc15" strokeWidth={1.5} dot={false} name="Signal" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {selectedIndicators.includes('stochastic') ? (
        <div className="h-48 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} minTickGap={24} />
              <YAxis stroke="#52525b" domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem' }}
                labelFormatter={(value) => `Date: ${formatAxisTick(value, interval)}`}
                formatter={tooltipFormatter}
              />
              <Legend verticalAlign="top" height={36} />
              <Line type="monotone" dataKey="stochasticK" stroke="#22c55e" strokeWidth={1.5} dot={false} name="%K" />
              <Line type="monotone" dataKey="stochasticD" stroke="#f472b6" strokeWidth={1.5} dot={false} name="%D" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}
