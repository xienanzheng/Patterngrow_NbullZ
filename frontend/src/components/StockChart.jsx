import { useState, useMemo, useCallback, useLayoutEffect } from 'react';
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

function TrendLineOverlay({ xAxisMap, yAxisMap, offset, drawnLines, pendingPoint, hoverPoint, onLineDelete, scalesRef, onDragStart }) {
  const [hoveredId, setHoveredId] = useState(null);
  const xScale = xAxisMap?.[0]?.scale;
  const yScale = yAxisMap?.['price']?.scale;
  useLayoutEffect(() => {
    if (scalesRef && xScale && yScale && offset) {
      scalesRef.current = { xScale, yScale, offset };
    }
  });
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
        const labelVal = line.type === 'horizontal' ? line.y1 : (line.y2 ?? line.y1);
        const labelPrice = labelVal >= 100 ? labelVal.toFixed(0) : labelVal >= 10 ? labelVal.toFixed(2) : labelVal.toFixed(3);
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
  onChartClick,
  onChartMouseMove,
  onLineDelete,
  scalesRef = null,
  onDragStart,
  isDragging = false,
}) {
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

  return (
    <div className="space-y-6">
      <div className="h-[360px] rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            onClick={onChartClick}
            onMouseMove={onChartMouseMove}
            style={(drawingMode || isDragging) ? { cursor: isDragging ? 'grabbing' : 'crosshair' } : undefined}
          >
            <defs>
              <linearGradient id="smaGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={xTickFormatter} minTickGap={24} />
            <YAxis yAxisId="price" stroke="#52525b" domain={priceDomain} tickFormatter={(v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))} />
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
            <Customized
              component={TrendLineOverlay}
              drawnLines={drawnLines}
              pendingPoint={pendingPoint}
              hoverPoint={hoverPoint}
              onLineDelete={onLineDelete}
              scalesRef={scalesRef}
              onDragStart={onDragStart}
            />
          </ComposedChart>
        </ResponsiveContainer>
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
