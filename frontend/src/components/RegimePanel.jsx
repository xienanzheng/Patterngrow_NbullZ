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
    const directionKnown = plusDI != null && minusDI != null;
    const isUp = directionKnown && plusDI > minusDI;
    const dir = directionKnown ? (isUp ? 'Uptrend' : 'Downtrend') : null;
    return isUp
      ? { label: 'Trending', color: 'text-emerald-300', bg: 'bg-emerald-500/10', direction: dir }
      : { label: 'Trending', color: directionKnown ? 'text-red-300' : 'text-zinc-300', bg: directionKnown ? 'bg-red-500/10' : 'bg-zinc-700/40', direction: dir };
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
