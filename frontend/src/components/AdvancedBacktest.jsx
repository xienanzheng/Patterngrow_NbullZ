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
import { getEvaluation, runBacktest } from '../services/api';

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
  { label: 'SMA Crossover', value: 'sma' },
  { label: 'RSI Swings', value: 'rsi' },
  { label: 'MACD Momentum', value: 'macd' },
  { label: 'Bollinger Bands', value: 'bollinger' },
  { label: 'Stochastic', value: 'stochastic' },
  { label: 'Ensemble (all signals)', value: 'ensemble' },
];

function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
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
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState(null);
  const [evaluation, setEvaluation] = useState(null);

  const handleEvaluate = async () => {
    setEvalLoading(true);
    setEvalError(null);
    try {
      setEvaluation(await getEvaluation(ticker, { range: period, indicator }));
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setEvalLoading(false);
    }
  };

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const capital = Math.max(Number(initialCapital) || 0, 0);
      if (capital <= 0) throw new Error('Initial capital must be greater than zero.');

      const data = await runBacktest({
        symbol: ticker,
        benchmark,
        period,
        strategy: indicator,
        initialCapital: capital,
        stopLossPct: Number(stopLoss) || 0,
        takeProfitPct: Number(takeProfit) || 0,
      });

      const toDateKey = (d) => (d ? String(d).slice(0, 10) : '');
      const benchEquityMap = new Map(data.benchmark.equity.map((r) => [toDateKey(r.date), r.value]));
      setResult({
        trades: data.target.trades,
        metrics: {
          finalValue: data.target.metrics.finalValue,
          benchmarkFinal: data.benchmark.metrics.finalValue,
          totalReturn: data.target.metrics.totalReturn,
          benchmarkReturn: data.benchmark.metrics.totalReturn,
          maxDrawdown: data.target.metrics.maxDrawdown,
        },
        chart: data.target.equity.map((row) => ({
          date: row.date,
          strategy: row.value,
          benchmark: benchEquityMap.get(toDateKey(row.date)) ?? null,
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
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-zinc-500">Ticker</label>
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500">Benchmark</label>
            <select
              value={benchmark}
              onChange={(event) => setBenchmark(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            >
              {BENCHMARKS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500">Period</label>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500">Signal Engine</label>
            <select
              value={indicator}
              onChange={(event) => setIndicator(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            >
              {INDICATORS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="text-xs font-medium text-zinc-500">
            Initial Capital ($)
            <input
              type="number"
              min="1000"
              step="100"
              value={initialCapital}
              onChange={(event) => setInitialCapital(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            />
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Stop Loss (%)
            <input
              type="number"
              min="0"
              step="0.5"
              value={stopLoss}
              onChange={(event) => setStopLoss(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            />
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Take Profit (%)
            <input
              type="number"
              min="0"
              step="0.5"
              value={takeProfit}
              onChange={(event) => setTakeProfit(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
            />
          </label>
          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              onClick={handleRun}
              disabled={loading}
              className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Running…' : 'Run Advanced Backtest'}
            </button>
            <button
              type="button"
              onClick={handleEvaluate}
              disabled={evalLoading}
              className="w-full rounded-lg border border-amber-400/50 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {evalLoading ? 'Evaluating…' : 'Evaluate Models (walk-forward)'}
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        {evalError ? <p className="mt-3 text-sm text-red-400">{evalError}</p> : null}
      </section>

      {evaluation ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h3 className="text-lg font-semibold text-white">Walk-Forward Model Evaluation</h3>
          <p className="mt-1 text-xs text-zinc-400">
            {evaluation.folds} folds · {evaluation.horizon}-day horizon · out-of-sample. Lower MAE/RMSE/MAPE is better; directional accuracy above the naive row means the model adds signal.
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800 text-sm text-zinc-200">
              <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="px-4 py-2 text-left">Model</th>
                  <th className="px-4 py-2 text-right">MAE</th>
                  <th className="px-4 py-2 text-right">RMSE</th>
                  <th className="px-4 py-2 text-right">MAPE</th>
                  <th className="px-4 py-2 text-right">Direction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {[...evaluation.forecasts, evaluation.baseline].map((row) => (
                  <tr key={row.model}>
                    <td className="px-4 py-2 font-semibold text-white">{row.model}</td>
                    <td className="px-4 py-2 text-right">{row.mae != null ? row.mae.toFixed(2) : '—'}</td>
                    <td className="px-4 py-2 text-right">{row.rmse != null ? row.rmse.toFixed(2) : '—'}</td>
                    <td className="px-4 py-2 text-right">{row.mape != null ? `${row.mape.toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-2 text-right">
                      {row.directionalAccuracy != null ? `${(row.directionalAccuracy * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-400">Strategy (OOS)</p>
              <p className="mt-1 text-lg font-semibold text-white">{evaluation.strategy.strategyReturn.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-400">Buy &amp; Hold (OOS)</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {evaluation.strategy.buyHoldReturn != null ? `${evaluation.strategy.buyHoldReturn.toFixed(2)}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-400">Win Rate</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {evaluation.strategy.winRate != null ? `${(evaluation.strategy.winRate * 100).toFixed(0)}%` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-400">Max Drawdown</p>
              <p className="mt-1 text-lg font-semibold text-red-400">{evaluation.strategy.maxDrawdown.toFixed(2)}%</p>
            </div>
          </div>
          {evaluation.directional ? (
            <p className="mt-4 text-xs text-zinc-400">
              Direction classifier: {(evaluation.directional.probUp * 100).toFixed(0)}% up over next {evaluation.directional.horizon} days ·
              holdout accuracy {(evaluation.directional.accuracy * 100).toFixed(0)}% vs {(evaluation.directional.baselineUpShare * 100).toFixed(0)}% always-up baseline.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        {result ? (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Final Value</p>
                <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(result.metrics.finalValue)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Strategy Return</p>
                <p className={`mt-1 text-lg font-semibold ${result.metrics.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPercent(result.metrics.totalReturn)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Benchmark Return</p>
                <p className={`mt-1 text-lg font-semibold ${result.metrics.benchmarkReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPercent(result.metrics.benchmarkReturn)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Max Drawdown</p>
                <p className="mt-1 text-lg font-semibold text-red-400">{formatPercent(result.metrics.maxDrawdown)}</p>
              </div>
            </div>

            <div className="mt-6 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="date" minTickGap={24} tickFormatter={(value) => new Date(value).toLocaleDateString()} />
                  <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} stroke="#52525b" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem' }}
                    labelFormatter={(value) => new Date(value).toLocaleString()}
                    formatter={(value, name) => [formatCurrency(value), name === 'strategy' ? 'Strategy' : 'Benchmark']}
                  />
                  <Legend verticalAlign="top" />
                  <Brush dataKey="date" travellerWidth={12} stroke="#52525b" height={24} />
                  <Line type="monotone" dataKey="strategy" stroke="#fbbf24" strokeWidth={2} dot={false} name="Strategy" />
                  <Line type="monotone" dataKey="benchmark" stroke="#a1a1aa" strokeWidth={2} dot={false} name="Benchmark" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-zinc-400">Recent Trades</h3>
              {result.trades.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No trades were generated for the chosen configuration.</p>
              ) : (
                <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
                  <table className="w-full text-left text-sm text-zinc-300">
                    <thead className="sticky top-0 bg-zinc-900 text-xs uppercase tracking-wide text-zinc-400">
                      <tr>
                        <th className="px-4 py-2">Date</th>
                        <th className="px-4 py-2">Type</th>
                        <th className="px-4 py-2">Price</th>
                        <th className="px-4 py-2">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-25).reverse().map((trade, index) => (
                        <tr key={`${trade.date}-${index}`} className="border-t border-zinc-800/60">
                          <td className="px-4 py-2 text-zinc-400">{new Date(trade.date).toLocaleString()}</td>
                          <td className="px-4 py-2 font-semibold text-white">{trade.type}</td>
                          <td className="px-4 py-2">{formatCurrency(trade.price)}</td>
                          <td className="px-4 py-2">
                            {trade.changePct != null ? (
                              <span className={trade.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {trade.changePct.toFixed(2)}%
                              </span>
                            ) : '—'}
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
          <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40">
            <p className="text-sm text-zinc-500">Configure parameters and run the advanced backtest to see performance analytics.</p>
          </div>
        )}
      </section>
    </div>
  );
}
