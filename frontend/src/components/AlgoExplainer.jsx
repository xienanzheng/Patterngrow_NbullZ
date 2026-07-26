import { useState } from 'react';

const INDICATORS = [
  {
    name: 'SMA Crossover',
    description: '50-day vs 200-day moving average. Price above both = bullish.',
  },
  {
    name: 'RSI (14)',
    description: 'Relative Strength Index. Below 30 = oversold (buy). Above 70 = overbought (sell).',
  },
  {
    name: 'MACD',
    description: 'Moving Average Convergence Divergence. Bullish when MACD line crosses above signal line.',
  },
  {
    name: 'Bollinger Bands',
    description: 'Price near the lower band = buy signal. Near the upper band = sell signal.',
  },
  {
    name: 'Stochastic Oscillator',
    description: 'Momentum oscillator. Below 20 = oversold (buy). Above 80 = overbought (sell).',
  },
  {
    name: 'ADX',
    description: 'Average Directional Index. Measures trend strength — high ADX amplifies other signals.',
  },
];

const RATINGS = [
  { dot: '●●', color: 'text-emerald-400', label: 'Strong Buy',   threshold: 'score ≥ 0.60' },
  { dot: '●',  color: 'text-emerald-400', label: 'Medium Buy',   threshold: 'score ≥ 0.35' },
  { dot: '●',  color: 'text-emerald-300', label: 'Buy',          threshold: 'score ≥ 0.15' },
  { dot: '●',  color: 'text-zinc-400',    label: 'Neutral',      threshold: '−0.15 to +0.15' },
  { dot: '●',  color: 'text-red-300',     label: 'Sell',         threshold: 'score ≤ −0.15' },
  { dot: '●',  color: 'text-red-400',     label: 'Medium Sell',  threshold: 'score ≤ −0.35' },
  { dot: '●●', color: 'text-red-500',     label: 'Strong Sell',  threshold: 'score ≤ −0.60' },
];

export default function AlgoExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-inner">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
          <span className="text-amber-400">&#9432;</span>
          How Signals Work
        </span>
        <span
          className={`text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : 'rotate-0'}`}
          aria-hidden="true"
        >
          &#9660;
        </span>
      </button>

      {/* Collapsible content */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          open ? 'max-h-[1200px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-zinc-800 px-5 pb-5 pt-4">
          <div className="grid gap-6 md:grid-cols-3">

            {/* Section 1: Data Source */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Data Source
              </h4>
              <ul className="space-y-1.5 text-xs text-zinc-300">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-amber-400">&#8250;</span>
                  <span>
                    <span className="font-medium text-zinc-100">Yahoo Finance</span> — 3 months of daily OHLCV bars
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-amber-400">&#8250;</span>
                  <span>Conviction signals are computed fresh each day on the latest data</span>
                </li>
              </ul>
            </div>

            {/* Section 2: Indicators */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                6 Technical Indicators
              </h4>
              <p className="mb-2.5 text-xs text-zinc-500">
                Each casts a vote: +1 buy · −1 sell · 0 neutral
              </p>
              <ul className="space-y-2">
                {INDICATORS.map((ind) => (
                  <li key={ind.name} className="text-xs">
                    <span className="font-semibold text-zinc-200">{ind.name}</span>
                    <span className="ml-1 text-zinc-400">— {ind.description}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Section 3: Conviction Ratings */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Conviction Ratings
              </h4>
              <p className="mb-2.5 text-xs text-zinc-500">
                Composite score from −1.0 (strong sell) to +1.0 (strong buy)
              </p>
              <div className="overflow-hidden rounded-lg border border-zinc-800">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-zinc-800">
                    {RATINGS.map((r) => (
                      <tr key={r.label} className="hover:bg-zinc-800/40">
                        <td className={`px-3 py-1.5 font-semibold tracking-tight ${r.color}`}>
                          {r.dot}
                        </td>
                        <td className="px-2 py-1.5 font-medium text-zinc-200">{r.label}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-zinc-500">
                          {r.threshold}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
