import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  Brush,
} from 'recharts';
import { getHistory } from '../services/api';
import { backtestStrategy } from '../lib/backtesting';

const PERIOD_OPTIONS = [
  { label: '1 Year', value: '1y' },
  { label: '2 Years', value: '2y' },
  { label: '5 Years', value: '5y' },
  { label: '10 Years', value: '10y' },
  { label: 'Max', value: 'max' },
];

const BENCHMARKS = [
  { label: 'S&P 500 (SPY)', value: 'SPY' },
  { label: 'NASDAQ 100 (QQQ)', value: 'QQQ' },
  { label: 'Dow Jones (DIA)', value: 'DIA' },
];

const INDICATORS = [
  { label: 'Simple Moving Average', value: 'sma' },
  { label: 'MACD Momentum', value: 'macd' },
  { label: 'RSI Swings', value: 'rsi' },
];

function toPoints(history = []) {
  return history.map((row) => ({
    date: row.date,
    open: Number(row.open) ?? null,
    high: Number(row.high) ?? null,
    low: Number(row.low) ?? null,
    close: Number(row.close) ?? null,
    volume: Number(row.volume) ?? null,
  }));
}

function maxDrawdown(series = []) {
  let peak = -Infinity;
  let maxDd = 0;
  series.forEach((row) => {
    if (row.value > peak) {
      peak = row.value;
    }
    if (!Number.isFinite(peak) || peak === 0) return;
    const drawdown = (row.value - peak) / peak;
    if (drawdown < maxDd) {
      maxDd = drawdown;
    }
  });
  return maxDd;
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
}

function runSimulation(points, signals, initialCapital, { stopLossPct, takeProfitPct }) {
  const trades = [];
  const equity = [];
  let cash = initialCapital;
  let shares = 0;
  let entryPrice = null;

  points.forEach((row, idx) => {
    const price = Number(row.close ?? 0);
    const signal = signals[idx]?.numericSignal ?? 0;

    if (shares > 0 && entryPrice) {
      const changePct = ((price - entryPrice) / entryPrice) * 100;
      if (stopLossPct && changePct <= -stopLossPct) {
        cash += shares * price;
        trades.push({ type: 'STOP', date: row.date, price, changePct });
        shares = 0;
        entryPrice = null;
      } else if (takeProfitPct && changePct >= takeProfitPct) {
        cash += shares * price;
        trades.push({ type: 'TARGET', date: row.date, price, changePct });
        shares = 0;
        entryPrice = null;
      }
    }

    if (signal > 0 && shares === 0 && price > 0) {
      const qty = cash / price;
      if (qty > 0) {
        shares = qty;
        cash -= qty * price;
        entryPrice = price;
        trades.push({ type: 'BUY', date: row.date, price });
      }
    } else if (signal < 0 && shares > 0) {
      cash += shares * price;
      const changePct = entryPrice ? ((price - entryPrice) / entryPrice) * 100 : null;
      trades.push({ type: 'SELL', date: row.date, price, changePct });
      shares = 0;
      entryPrice = null;
    }

    equity.push({ date: row.date, value: cash + shares * price });
  });

  if (shares > 0) {
    const last = points.at(-1);
    if (last?.close) {
      cash += shares * last.close;
      trades.push({ type: 'LIQUIDATE', date: last.date, price: last.close });
    }
  }

  return { equity, trades };
}

export default function AdvancedBacktest() {
  const [ticker, setTicker] = useState('AAPL');
  const [benchmark, setBenchmark] = useState('SPY');
  const [period, setPeriod] = useState('1y');
  const [indicator, setIndicator] = useState('sma');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [stopLoss, setStopLoss] = useState(5);
  const [takeProfit, setTakeProfit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const capital = Math.max(Number(initialCapital) || 0, 0);
      if (capital <= 0) {
        throw new Error('Initial capital must be greater than zero.');
      }

      const [{ history: targetHistory }, { history: benchHistory }] = await Promise.all([
        getHistory(ticker, { range: period, interval: '1d' }),
        getHistory(benchmark, { range: period, interval: '1d' }),
      ]);

      const targetPoints = toPoints(targetHistory);
      const benchmarkPoints = toPoints(benchHistory);
      if (targetPoints.length === 0) {
        throw new Error('No price history returned for the selected symbol.');
      }

      const { signals } = backtestStrategy(targetPoints, indicator);
      const benchmarkSignals = backtestStrategy(benchmarkPoints, 'sma').signals;

      const { equity, trades } = runSimulation(targetPoints, signals, capital, {
        stopLossPct: Number(stopLoss) || 0,
        takeProfitPct: Number(takeProfit) || 0,
      });
      const benchmarkSim = runSimulation(benchmarkPoints, benchmarkSignals, capital, {
        stopLossPct: 0,
        takeProfitPct: 0,
      });

      const finalValue = equity.at(-1)?.value ?? 0;
      const benchmarkFinal = benchmarkSim.equity.at(-1)?.value ?? 0;

      setResult({
        trades,
        metrics: {
          finalValue,
          benchmarkFinal,
          totalReturn: ((finalValue / capital) - 1) * 100,
          benchmarkReturn: ((benchmarkFinal / capital) - 1) * 100,
          maxDrawdown: maxDrawdown(equity) * 100,
        },
        chart: equity.map((row) => ({
          date: row.date,
          strategy: row.value,
          benchmark: benchmarkSim.equity.find((b) => b.date === row.date)?.value ?? null,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run backtest.');
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => result?.chart ?? [], [result]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Ticker</label>
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Benchmark</label>
            <select
              value={benchmark}
              onChange={(event) => setBenchmark(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              {BENCHMARKS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Period</label>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Signal Engine</label>
            <select
              value={indicator}
              onChange={(event) => setIndicator(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              {INDICATORS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Initial Capital ($)
            <input
              type="number"
              min="1000"
              step="100"
              value={initialCapital}
              onChange={(event) => setInitialCapital(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Stop Loss (%)
            <input
              type="number"
              min="0"
              step="0.5"
              value={stopLoss}
              onChange={(event) => setStopLoss(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Take Profit (%)
            <input
              type="number"
              min="0"
              step="0.5"
              value={takeProfit}
              onChange={(event) => setTakeProfit(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleRun}
              disabled={loading}
              className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Running…' : 'Run Advanced Backtest'}
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        {result ? (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Final Value</p>
                <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(result.metrics.finalValue)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Strategy Return</p>
                <p className={`mt-1 text-lg font-semibold ${result.metrics.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPercent(result.metrics.totalReturn)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Benchmark Return</p>
                <p className={`mt-1 text-lg font-semibold ${result.metrics.benchmarkReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPercent(result.metrics.benchmarkReturn)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Max Drawdown</p>
                <p className="mt-1 text-lg font-semibold text-red-400">{formatPercent(result.metrics.maxDrawdown)}</p>
              </div>
            </div>

            <div className="mt-6 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={24} tickFormatter={(value) => new Date(value).toLocaleDateString()} />
                  <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} stroke="#475569" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem' }}
                    labelFormatter={(value) => new Date(value).toLocaleString()}
                    formatter={(value, name) => [formatCurrency(value), name === 'strategy' ? 'Strategy' : 'Benchmark']}
                  />
                  <Legend verticalAlign="top" />
                  <Brush dataKey="date" travellerWidth={12} stroke="#38bdf8" height={24} />
                  <Line type="monotone" dataKey="strategy" stroke="#38bdf8" strokeWidth={2} dot={false} name="Strategy" />
                  <Line type="monotone" dataKey="benchmark" stroke="#f97316" strokeWidth={2} dot={false} name="Benchmark" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent Trades</h3>
              {result.trades.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No trades were generated for the chosen configuration.</p>
              ) : (
                <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
                  <table className="w-full text-left text-sm text-slate-300">
                    <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-4 py-2">Date</th>
                        <th className="px-4 py-2">Type</th>
                        <th className="px-4 py-2">Price</th>
                        <th className="px-4 py-2">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-25).reverse().map((trade, index) => (
                        <tr key={`${trade.date}-${index}`} className="border-t border-slate-800/60">
                          <td className="px-4 py-2 text-slate-400">{new Date(trade.date).toLocaleString()}</td>
                          <td className="px-4 py-2 font-semibold text-white">{trade.type}</td>
                          <td className="px-4 py-2">{formatCurrency(trade.price)}</td>
                          <td className="px-4 py-2">
                            {trade.changePct != null ? (
                              <span className={trade.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {trade.changePct.toFixed(2)}%
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/40">
            <p className="text-sm text-slate-500">Configure parameters and run the advanced backtest to see performance analytics.</p>
          </div>
        )}
      </section>
    </div>
  );
}
