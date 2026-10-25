import { useState } from 'react';

const INDICATORS = [
  {
    name: 'SMA level · 20 bars',
    description: 'The ensemble compares the latest close with its 20-bar average: above adds a positive vote; at or below adds a negative vote. The separate strategy chart uses crossings.',
  },
  {
    name: 'RSI (14)',
    description: 'Uses a 3-bar EMA of the 14-bar RSI. Below 30 adds a positive vote; above 70 adds a negative vote. The raw RSI shown elsewhere can differ.',
  },
  {
    name: 'MACD',
    description: 'The sign of MACD minus its signal line supplies the ensemble vote. This is a level comparison, not a requirement for a new crossing.',
  },
  {
    name: 'Bollinger Bands',
    description: 'A close strictly below the lower band adds a positive vote; strictly above the upper band adds a negative vote. Inside the bands contributes zero.',
  },
  {
    name: 'Stochastic Oscillator',
    description: 'The latest %K below 20 adds a positive vote; above 80 adds a negative vote. Otherwise its contribution is zero.',
  },
  {
    name: 'ADX',
    description: 'At ADX 25 or higher, +DI versus −DI supplies a separate directional vote. It does not multiply the other indicators.',
  },
];

const RATINGS = [
  { dot: '●●', color: 'text-emerald-400', label: 'Strong Buy',   threshold: 'score ≥ +0.60' },
  { dot: '●',  color: 'text-emerald-400', label: 'Medium Buy',   threshold: '+0.35 ≤ score < +0.60' },
  { dot: '●',  color: 'text-emerald-300', label: 'Buy',          threshold: '+0.15 ≤ score < +0.35' },
  { dot: '●',  color: 'text-zinc-400',    label: 'Neutral',      threshold: '−0.15 ≤ score < +0.15' },
  { dot: '●',  color: 'text-red-300',     label: 'Sell',         threshold: '−0.35 < score < −0.15' },
  { dot: '●',  color: 'text-red-400',     label: 'Medium Sell',  threshold: '−0.60 < score ≤ −0.35' },
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
          How the displayed classifications are calculated
        </span>
        <span
          className={`text-zinc-500 transition-transform duration-200 ${open ? 'rotate-180' : 'rotate-0'}`}
          aria-hidden="true"
        >
          &#9660;
        </span>
      </button>

      {/* Collapsible content */}
      {open && <div>
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
                    Uses the provider, history window and bar interval selected for this analysis. Other screens may use different defaults.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-amber-400">&#8250;</span>
                  <span>Recomputed when requested; the latest bar may still be incomplete. Previous saved labels are not inputs to this calculation.</span>
                </li>
              </ul>
            </div>

            {/* Section 2: Indicators */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                6 Technical Indicators
              </h4>
              <p className="mb-2.5 text-xs text-zinc-500">
                Each contributes +1, −1 or 0, multiplied by its normalized weight. These are descriptive technical classifications.
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
                Legacy label definitions for the weighted score, which ranges from −1 to +1. These labels are not probabilities or instructions to transact.
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
      </div>}
    </div>
  );
}
