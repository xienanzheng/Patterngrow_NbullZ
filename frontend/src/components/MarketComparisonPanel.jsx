import { useEffect, useRef, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getMarketComparison } from '../services/api';
import { downloadResearchFile, normalizeResearchSymbol } from '../utils/researchWorkspace';

const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
const percent = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value)}%` : '—';
const dateLabel = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
const tooltipStyle = { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 };

export default function MarketComparisonPanel({ symbol, benchmark, range, onBenchmarkChange }) {
  const [input, setInput] = useState(benchmark);
  const [responsePayload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const requestId = useRef(0);

  useEffect(() => { setInput(benchmark); }, [benchmark]);
  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setPayload(null);
    setLoading(true);
    setError('');
    getMarketComparison(symbol, { benchmark, range, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted && id === requestId.current) setPayload(data); })
      .catch((err) => { if (!controller.signal.aborted && id === requestId.current) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted && id === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [symbol, benchmark, range, revision]);

  const payload = responsePayload?.symbol === symbol && responsePayload?.benchmark === benchmark && responsePayload?.range === range ? responsePayload : null;
  const awaitingData = loading || (!payload && !error);
  const { series = [], metrics = {}, sample = {}, metadata = {}, quality = {} } = payload?.comparison ?? {};
  const hasComparableSessions = quality.status !== 'unavailable' && sample.commonSessions > 0;
  const cards = [
    { label: `${symbol} price return`, value: percent(metrics.symbolReturnPct), detail: 'From first to last common session.' },
    { label: `${benchmark} price return`, value: percent(metrics.benchmarkReturnPct), detail: 'Same comparison dates.' },
    { label: 'Return difference', value: Number.isFinite(metrics.relativePerformancePp) ? `${number(metrics.relativePerformancePp)} pp` : '—', detail: 'Symbol return minus benchmark return.' },
    { label: 'Daily correlation', value: number(metrics.correlation, 3), detail: 'Pearson correlation of paired daily returns.' },
    { label: 'Historical beta', value: number(metrics.beta, 3), detail: 'Covariance with benchmark ÷ benchmark variance.' },
    { label: 'Tracking error', value: Number.isFinite(metrics.trackingErrorPct) ? `${number(metrics.trackingErrorPct)}%` : '—', detail: 'Annualized variability of the daily return difference.' },
  ];

  return <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40" aria-busy={awaitingData} aria-label="Benchmark comparison">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 p-5 sm:px-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Comparative research</p><h2 className="mt-1 text-lg font-semibold">{symbol} <span className="mx-1 text-zinc-600">/</span> {benchmark}</h2><p className="mt-1 text-xs text-zinc-500">Indexed to 100 on the first common session · Price return, excluding distributions</p></div>
      <form className="flex w-full gap-2 sm:w-auto" onSubmit={(event) => { event.preventDefault(); const next = normalizeResearchSymbol(input, null); if (next) { onBenchmarkChange(next); setRevision((value) => value + 1); } }}>
        <label className="min-w-0 flex-1 text-[10px] uppercase tracking-wider text-zinc-500">Benchmark
          <input aria-label="Benchmark symbol" required maxLength={20} pattern="[A-Za-z0-9.\^=\-]{1,20}" className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 sm:w-28" value={input} onChange={(event) => setInput(event.target.value.toUpperCase())} />
        </label><button type="submit" className="self-end rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:border-amber-300">Compare</button>
      </form>
    </div>
    {awaitingData ? <div role="status" className="flex h-80 items-center justify-center text-sm text-zinc-400">Aligning daily market observations…</div> : error ? <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center"><p className="text-sm text-amber-200">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="rounded-lg border border-zinc-700 px-4 py-2 text-xs">Retry comparison</button></div> : <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-4 text-[11px] text-zinc-500"><span>{symbol}: {metadata.symbolCurrency ?? 'currency unknown'} · {benchmark}: {metadata.benchmarkCurrency ?? 'currency unknown'}</span><span>{quality.status === 'ok' ? 'Observed fields aligned' : 'Limited coverage · see notes below'}</span></div>
      {metadata.currencyMatch !== true && <p className="mx-6 mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-200">{metadata.currencyMatch === false ? 'The two histories use different currencies.' : 'A quote currency is unverified.'} This comparison uses each instrument’s own currency and excludes exchange-rate changes.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-5 text-xs"><div className="flex gap-5"><span className="text-amber-300">━ {symbol}</span><span className="text-sky-300">┄ {benchmark}</span></div><span className="text-zinc-500">{sample.commonSessions ?? 0} shared sessions · {sample.pairedReturns ?? 0} paired returns</span></div>
      {hasComparableSessions ? <div className="h-80 px-2 pt-4 sm:px-5" role="img" aria-label={`${symbol} and ${benchmark} indexed closing-price comparison; ${sample.commonSessions ?? 0} common sessions`}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ top: 5, right: 10, bottom: 5, left: 0 }} syncId="comparison">
          <CartesianGrid vertical={false} stroke="#27272a" strokeDasharray="3 6" />
          <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={70} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} width={60} tickFormatter={(value) => number(value, 0)} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
          <ReferenceLine y={100} stroke="#52525b" strokeDasharray="3 5" />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={dateLabel} formatter={(value, name) => [number(value), name === 'symbolIndex' ? symbol : benchmark]} />
          <Line type="linear" dataKey="symbolIndex" stroke="#fcd34d" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="linear" dataKey="benchmarkIndex" stroke="#7dd3fc" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart></ResponsiveContainer>
      </div> : <p className="p-8 text-sm text-amber-200">No valid shared sessions are available for this comparison.</p>}
      <dl className="grid grid-cols-2 gap-px border-y border-zinc-800 bg-zinc-800 lg:grid-cols-3">{cards.map((card) => <div key={card.label} className="bg-zinc-950 p-5"><dt className="text-xs text-zinc-400">{card.label}</dt><dd className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{card.value}</dd><p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{card.detail}</p></div>)}</dl>
      {hasComparableSessions && <div className="border-b border-zinc-800 px-4 pb-4 pt-5 sm:px-6"><div className="mb-3 flex flex-wrap justify-between gap-2 text-xs"><h3 className="font-medium text-zinc-300">Rolling correlation · 20 paired daily returns</h3><span className="text-zinc-500">−1 opposite · 0 no linear relationship · +1 together</span></div><div className="h-32" role="img" aria-label="Rolling 20-observation daily return correlation"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} syncId="comparison">
        <XAxis dataKey="date" hide /><YAxis domain={[-1, 1]} ticks={[-1, 0, 1]} width={40} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} /><ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="3 4" />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={dateLabel} formatter={(value) => [number(value, 3), '20-return correlation']} /><Line type="linear" dataKey="rollingCorrelation20" stroke="#c4b5fd" dot={false} isAnimationActive={false} connectNulls={false} />
      </LineChart></ResponsiveContainer></div></div>}
      <div className="space-y-3 p-5 text-xs text-zinc-500 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><p>{sample.startDate ?? '—'} → {sample.endDate ?? '—'} · Daily statistics require at least 20 paired returns.</p><button type="button" disabled={!series.length} onClick={() => downloadResearchFile(JSON.stringify({ schemaVersion: 'patterngrow.comparison-snapshot.v1', exportedAt: new Date().toISOString(), dataset: payload }, null, 2), `${symbol}-vs-${benchmark}-${range}-comparison.json`, 'application/json')} className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 disabled:opacity-30">Export comparison ↓</button></div>
        <p>Native-currency price histories; no currency conversion. Corporate-action adjustments and market-calendar coverage are unverified. Historical relationships can change.</p>
        {(quality.warnings ?? []).length > 0 && <details><summary className="cursor-pointer text-amber-200">Comparison coverage & limitations ({quality.warnings.length})</summary><ul className="mt-3 list-disc space-y-2 pl-4">{quality.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <details><summary className="cursor-pointer text-zinc-400">Source details & alignment</summary><dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{[
          [`${symbol} source`, metadata.symbolSources?.join(', ') || 'Unknown'], [`${benchmark} source`, metadata.benchmarkSources?.join(', ') || 'Unknown'],
          [`${symbol} latest provider date / timestamp`, metadata.symbolAsOf ?? 'Unknown'], [`${benchmark} latest provider date / timestamp`, metadata.benchmarkAsOf ?? 'Unknown'],
          [`${symbol} exchange timezone`, metadata.symbolTimezones?.join(', ') || 'Unknown'], [`${benchmark} exchange timezone`, metadata.benchmarkTimezones?.join(', ') || 'Unknown'],
          ['Observed input bars', `${symbol}: ${sample.symbolBars ?? 0} · ${benchmark}: ${sample.benchmarkBars ?? 0}`], ['Longest uninterrupted paired run', `${sample.longestPairedRun ?? 0} returns`],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mt-1 break-words text-zinc-300">{value}</dd></div>)}</dl><p className="mt-4 leading-relaxed">Daily return pairs require adjacent valid observations in both histories. Unmatched sessions, invalid closes and intervals longer than seven calendar days break the pair. Rolling correlation requires 20 uninterrupted pairs; relationship statistics use the available valid pairs.</p></details>
      </div>
    </>}
  </section>;
}
