import { useEffect, useId, useState } from 'react';
import { getMarketOverview } from '../services/marketOverview';

const formatNumber = (value) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
const formatChange = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${formatNumber(value)}%` : '—';
const changeClass = (value) => !Number.isFinite(value) || value === 0 ? 'text-zinc-400' : value > 0 ? 'text-emerald-300' : 'text-rose-300';
const sourceNames = { yahoo: 'Yahoo Finance', twelvedata: 'Twelve Data' };

function utcTimestamp(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `${date.toLocaleString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC` : 'Unavailable';
}

function Sparkline({ observations }) {
  const closes = observations.map((bar) => bar.close).filter((close) => Number.isFinite(close) && close > 0);
  if (closes.length < 2) return <div className="h-8" aria-hidden="true" />;
  const min = Math.min(...closes);
  const span = Math.max(...closes) - min;
  let connected = false;
  const path = observations.map((bar, index) => {
    if (!Number.isFinite(bar.close) || bar.close <= 0) { connected = false; return ''; }
    const x = 2 + index / Math.max(observations.length - 1, 1) * 156;
    const y = span > 0 ? 28 - (bar.close - min) / span * 24 : 16;
    const command = `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    connected = true;
    return command;
  }).join(' ');
  return <svg viewBox="0 0 160 32" preserveAspectRatio="none" className="h-8 w-full text-amber-300/70" aria-hidden="true"><path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" /></svg>;
}

export default function MarketOverviewPanel({ onSelectSymbol }) {
  const headingId = useId();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError('');
    setOverview(null);
    getMarketOverview({ signal: controller.signal })
      .then((result) => { if (active) setOverview(result); })
      .catch((failure) => { if (active && !controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [revision]);

  const coverage = overview?.coverage;
  return (
    <section aria-labelledby={headingId} aria-busy={loading} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/35">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-zinc-100">Across the market <span className="ml-2 font-normal text-zinc-500">Fund proxies</span></h2>
          <p className="mt-1 text-[11px] text-zinc-500">Daily observations · Feed delay unknown · Latest bars may be incomplete</p>
        </div>
        <button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)} className="rounded-lg border border-zinc-700 px-3 py-2 text-[11px] text-zinc-300 hover:border-amber-300/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">
          {loading ? 'Loading…' : error || overview?.status === 'unavailable' ? 'Retry overview' : 'Refresh overview'}
        </button>
      </div>
      {loading ? <div role="status" className="flex min-h-48 items-center justify-center px-5 py-10 text-sm text-zinc-400">Loading six daily fund proxies…</div>
        : error ? <p role="alert" className="px-5 py-10 text-sm text-amber-200">{error}</p>
          : overview ? <>
            <div role="status" className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-5 pt-4 text-[11px] text-zinc-400">
              <p>{coverage.available}/{coverage.requested} latest closes available{overview.status === 'partial' ? ' · Partial coverage' : overview.status === 'unavailable' ? ' · Provider data unavailable' : ''}</p>
              <p>{coverage.sameSession === true ? `All six: ${coverage.latestSessionDate}` : coverage.sameSession === false ? 'Different session dates — compare with care' : 'Same-session coverage unverified'}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 sm:gap-3 sm:p-5 lg:grid-cols-3 xl:grid-cols-6">
              {overview.rows.map((row) => <article key={row.symbol} className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/45 p-2.5 sm:p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" disabled={typeof onSelectSymbol !== 'function'} onClick={() => onSelectSymbol?.(row.symbol)} aria-label={`Explore ${row.symbol} historical research`} className="rounded text-sm font-semibold text-amber-200 hover:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 disabled:text-zinc-200">{row.symbol}<span className="ml-1 text-[10px]" aria-hidden="true">↗</span></button>
                  {row.status !== 'ok' && <span className="text-[9px] uppercase tracking-wide text-zinc-500">{row.status === 'unavailable' ? 'Unavailable' : 'Partial'}</span>}
                </div>
                <p className="mt-1 truncate text-[11px] text-zinc-400" title={row.name}>{row.name}</p>
                <p className="mt-3 text-xl font-semibold tracking-tight text-zinc-100">{formatNumber(row.latestClose)} <span className="text-[10px] font-normal text-zinc-500">{row.currency ?? 'Currency unknown'}</span></p>
                <div className="my-2"><Sparkline observations={row.sparkline ?? []} /></div>
                <dl className="grid grid-cols-3 gap-1 text-[10px]">
                  {[['1 bar', row.return1], ['5 bars', row.return5], ['20 bars', row.return20]].map(([label, value]) => <div key={label}><dt className="text-zinc-500">{label}</dt><dd className={`mt-1 font-medium ${changeClass(value)}`}>{formatChange(value)}</dd></div>)}
                </dl>
                <div className="mt-3 flex justify-between gap-2 border-t border-zinc-800 pt-2 text-[10px]"><span className="text-zinc-500">Relative volume · 20</span><span className="shrink-0 text-zinc-300">{Number.isFinite(row.relativeVolume20) ? `${formatNumber(row.relativeVolume20)}×` : '—'}</span></div>
                <p className="mt-2 text-[10px] text-zinc-400">{row.sessionDate ? `Session ${row.sessionDate}` : row.asOf ? `Bar ${utcTimestamp(row.asOf)}` : 'Observation unavailable'}</p>
                <p className="mt-1 text-[10px] text-zinc-600">{sourceNames[row.source] ?? row.source ?? 'Source unavailable'}</p>
                <details className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Source & limitations</summary>
                  <p className="mt-2">{row.description}</p>
                  <p className="mt-2">{row.asOfPrecision === 'date' || row.asOfPrecision === 'session-date' ? `Session-date label: ${row.sessionDate ?? 'unknown'}` : `Bar timestamp: ${utcTimestamp(row.asOf)}`}</p>
                  <p>Retrieved: {utcTimestamp(row.fetchedAt)}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-3">{row.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                </details>
              </article>)}
            </div>
            <div className="border-t border-zinc-800 px-5 py-3 text-[10px] leading-relaxed text-zinc-500">
              <p>Price changes over observed daily bars; cash distributions excluded. Relative volume compares the latest bar with the preceding 20 bars with reported volume. No automatic refresh; summaries are cached for up to 60 seconds.</p>
              <details className="mt-2"><summary className="cursor-pointer rounded text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Cross-section coverage & caveats</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4">{overview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                {coverage.sessionDates.map((group) => <p key={group.date} className="mt-1">{group.date}: {group.symbols.join(', ')}</p>)}
                {coverage.unverifiedSessionSymbols.length > 0 && <p className="mt-1">Unverified session date: {coverage.unverifiedSessionSymbols.join(', ')}</p>}
                {coverage.missingSymbols.length > 0 && <p className="mt-1">Unavailable: {coverage.missingSymbols.join(', ')}</p>}
              </details>
            </div>
          </> : null}
    </section>
  );
}
