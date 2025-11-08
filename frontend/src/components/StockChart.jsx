import { useMemo } from 'react';
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
import {
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateStochasticOscillator,
  calculateVWAP,
} from '../lib/indicators';

const formatAxisDate = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleDateString();
};

const tooltipFormatter = (value, name) => {
  if (value == null) return null;
  const label = name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  if (typeof value === 'number') {
    return [value.toFixed(2), label];
  }
  return [value, label];
};

export default function StockChart({ data, selectedIndicators }) {
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

  const forecastStartIndex = chartData.findIndex((row) => row.isForecast);

  return (
    <div className="space-y-6">
      <div className="h-[360px] rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id="smaGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatAxisDate} minTickGap={24} />
            <YAxis yAxisId="price" stroke="#475569" domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem' }}
              labelFormatter={(value) => `Date: ${formatAxisDate(value)}`}
              formatter={tooltipFormatter}
            />
            <Legend verticalAlign="top" height={36} />
            <Line
              type="monotone"
              dataKey="close"
              yAxisId="price"
              stroke="#3b82f6"
              strokeWidth={2.2}
              dot={false}
              name="Close"
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="h-40 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatAxisDate} minTickGap={24} />
            <YAxis tickFormatter={(value) => `${(value / 1_000_000).toFixed(1)}M`} stroke="#475569" />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem' }}
              labelFormatter={(value) => `Date: ${formatAxisDate(value)}`}
              formatter={(value) => [`${(value / 1_000_000).toFixed(2)}M`, 'Volume']}
            />
            <Legend verticalAlign="top" height={28} />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="#60a5fa"
              fill="#1d4ed8"
              fillOpacity={0.35}
              name="Volume"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {selectedIndicators.includes('rsi') ? (
        <div className="h-48 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatAxisDate} minTickGap={24} />
              <YAxis domain={[0, 100]} stroke="#475569" />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem' }}
                labelFormatter={(value) => `Date: ${formatAxisDate(value)}`}
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
        <div className="h-48 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatAxisDate} minTickGap={24} />
              <YAxis stroke="#475569" />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem' }}
                labelFormatter={(value) => `Date: ${formatAxisDate(value)}`}
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
        <div className="h-48 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatAxisDate} minTickGap={24} />
              <YAxis stroke="#475569" domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem' }}
                labelFormatter={(value) => `Date: ${formatAxisDate(value)}`}
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
