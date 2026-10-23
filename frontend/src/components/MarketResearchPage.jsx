import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getMarketResearch, getProviderStatus } from '../services/api';
import MarketResearchPanel from './MarketResearchPanel';
import FundamentalsCard from './FundamentalsCard';

const periods = [{ label: '1M', range: '1mo' }, { label: '3M', range: '3mo' }, { label: '6M', range: '6mo' }, { label: '1Y', range: '1y' }, { label: '2Y', range: '2y' }];
const fmt = (v) => Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
const compact = (v) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const dateLabel = (date) => new Date(date).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
const tooltipStyle = { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 12, fontSize: 12 };

function exportHistory(payload) {
  const fields = ['date', 'open', 'high', 'low', 'close', 'volume', 'source', 'currency'];
  const escape = (value) => {
    const text = String(value ?? '');
    const safe = /^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [fields.join(','), ...payload.history.map((row) => fields.map((field) => escape(row[field])).join(','))].join('\r\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = `${payload.symbol}-${payload.range}-daily.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default function MarketResearchPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [input, setInput] = useState('AAPL');
  const [range, setRange] = useState('1y');
  const [revision, setRevision] = useState(0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState(null);
  const [providerError, setProviderError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setPayload(null);
    getMarketResearch(symbol, { range, interval: '1d', signal: controller.signal })
      .then((data) => { if (id === requestId.current) setPayload(data); })
      .catch((err) => { if (!controller.signal.aborted && id === requestId.current) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted && id === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [symbol, range, revision]);

  useEffect(() => {
    const controller = new AbortController();
    getProviderStatus(controller.signal)
      .then(setProviders)
      .catch((err) => { if (!controller.signal.aborted) setProviderError(err.message); });
    return () => controller.abort();
  }, []);

  const history = payload?.history ?? [];
  const latest = history.at(-1);
  const currency = payload?.research?.metadata?.currency;
  const chartData = history.map((bar, index) => {
    const prior = history.slice(Math.max(0, index - 20), index);
    const complete = prior.length === 20 && prior.every((item) => Number.isFinite(item.volume) && item.volume >= 0);
    return { ...bar, averageVolume: complete ? prior.reduce((sum, item) => sum + item.volume, 0) / 20 : null };
  });
  const change = payload?.research?.risk?.return1;
  const source = payload?.research?.quality?.source;
  const sourceName = source === 'yahoo' ? 'Yahoo Finance' : source === 'twelvedata' ? 'Twelve Data' : source ?? 'Awaiting data';

  return (
    <div className="min-h-screen bg-[#09090b] pb-12">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link to="/research" className="text-lg font-semibold tracking-tight text-zinc-100">pattern<span className="text-amber-300">grow</span><span className="ml-3 border-l border-zinc-700 pl-3 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">Research</span></Link>
          <Link to="/dashboard" className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-amber-400">Open dashboard ↗</Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-5 pt-10 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300">The market, in context</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Understand the activity.<br /><span className="text-zinc-500">Measure the uncertainty.</span></h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-zinc-400">Explore price history, volume and risk together, with the source and limitations attached to every dataset.</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); const normalized = input.trim().toUpperCase(); if (/^[A-Z0-9.^=-]{1,20}$/.test(normalized)) { setSymbol(normalized); setRevision((value) => value + 1); } }} className="w-full sm:w-auto">
            <label htmlFor="research-symbol" className="mb-2 block text-xs text-zinc-400">Research a symbol</label>
            <div className="flex gap-2">
              <input id="research-symbol" required maxLength={20} pattern="[A-Za-z0-9.\^=\-]{1,20}" value={input} onChange={(event) => setInput(event.target.value.toUpperCase())} className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 sm:w-40" />
              <button type="submit" disabled={loading} className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200 disabled:opacity-50">Explore</button>
            </div>
          </form>
        </div>

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40" aria-busy={loading}>
          <div className="flex flex-wrap items-center justify-between gap-5 border-b border-zinc-800 p-5 sm:px-6">
            <div>
              <div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{symbol}</h2><span className="rounded-md bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">DAILY HISTORY</span></div>
              <div className="mt-2 flex flex-wrap items-baseline gap-3"><span className="text-3xl font-semibold tracking-tight">{fmt(latest?.close)}<span className="ml-2 text-sm font-normal text-zinc-500">{currency ?? ''}</span></span><span className={`text-xs ${change < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{Number.isFinite(change) ? `${change > 0 ? '+' : ''}${fmt(change)}% last bar` : 'Awaiting price history'}</span></div>
              <p className="mt-2 text-[11px] text-zinc-500">{sourceName} · Feed delay unverified{latest?.date ? ` · Last bar ${dateLabel(latest.date)}` : ''}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1 rounded-lg bg-zinc-950 p-1" aria-label="History range">{periods.map((period) => <button key={period.range} type="button" aria-pressed={range === period.range} onClick={() => setRange(period.range)} className={`rounded-md px-3 py-2 text-xs ${range === period.range ? 'bg-zinc-800 text-amber-200' : 'text-zinc-500 hover:text-zinc-200'}`}>{period.label}</button>)}</div>
              <button type="button" disabled={!history.length || loading} onClick={() => exportHistory(payload)} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 disabled:opacity-30">Export CSV ↓</button>
            </div>
          </div>
          {loading ? <div role="status" className="flex h-80 items-center justify-center text-sm text-zinc-400">Loading historical market data…</div> : error ? <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-12 text-center"><p className="text-sm text-amber-200">{error}</p><p className="max-w-sm text-xs leading-relaxed text-zinc-500">No sample prices are substituted when a provider is unavailable.</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="rounded-lg border border-zinc-700 px-4 py-2 text-xs">Retry data request</button></div> : <>
            <div className="h-80 px-2 pt-6 sm:px-5" role="img" aria-label={`${symbol} daily closing prices for ${range}; latest ${fmt(latest?.close)} ${currency ?? ''}`}>
              <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }} syncId="research">
                <defs><linearGradient id="researchPriceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fcd34d" stopOpacity={0.16} /><stop offset="100%" stopColor="#fcd34d" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#27272a" strokeDasharray="3 6" />
                <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={70} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={['auto', 'auto']} tickFormatter={fmt} width={65} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={dateLabel} formatter={(v) => [fmt(v), `Close ${currency ?? ''}`]} />
                <Area type="linear" dataKey="close" stroke="#fcd34d" strokeWidth={2} fill="url(#researchPriceFill)" isAnimationActive={false} connectNulls={false} />
              </AreaChart></ResponsiveContainer>
            </div>
            <div className="border-t border-zinc-800/70 px-2 pb-3 pt-4 sm:px-5">
              <div className="mb-2 flex flex-wrap justify-between gap-2 px-3 text-[11px]"><span className="font-medium text-zinc-300">Volume</span><span className="text-zinc-500">Green: close ≥ open · Pink: close &lt; open · Dashed: prior 20-bar average</span></div>
              <div className="h-36" role="img" aria-label={`${symbol} volume by session and prior 20-session average`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} syncId="research">
                <XAxis dataKey="date" hide /><YAxis tickFormatter={compact} width={65} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={dateLabel} formatter={(v, name) => [fmt(v), name === 'volume' ? 'Volume' : 'Prior 20 average']} />
                <Bar dataKey="volume" isAnimationActive={false}>{chartData.map((bar) => <Cell key={bar.date} fill={bar.open == null || bar.close == null ? '#52525b' : bar.close >= bar.open ? '#6ee7b7' : '#fda4af'} fillOpacity={0.65} />)}</Bar>
                <Line type="linear" dataKey="averageVolume" stroke="#a1a1aa" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </ComposedChart></ResponsiveContainer></div>
            </div>
          </>}
        </section>

        <MarketResearchPanel research={payload?.research} />
        <FundamentalsCard symbol={symbol} />

        <details className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <summary className="cursor-pointer text-sm font-medium text-zinc-300">Data connections <span className="ml-2 text-xs font-normal text-zinc-500">Source coverage & availability</span></summary>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">Configuration status is not a health check. An API key does not establish real-time access or redistribution rights.</p>
          {providerError && <p className="mt-3 text-xs text-amber-200">Provider configuration is unavailable.</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{providers?.providers?.map((provider) => <div key={provider.id} className="rounded-xl border border-zinc-800 p-4"><p className="text-sm font-medium">{provider.name}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-amber-200">{provider.configured ? provider.role : 'Not configured'}</p><p className="mt-3 text-xs leading-relaxed text-zinc-500">{provider.notes}</p></div>)}</div>
        </details>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-zinc-800 pt-5 text-[11px] leading-relaxed text-zinc-500"><p>Historical research · Unverified feed delay · Latest bar may be incomplete</p><p>{payload?.fetchedAt ? `Retrieved ${new Date(payload.fetchedAt).toLocaleTimeString()} · Cache up to 60s` : 'Source timestamps appear when data is available.'}</p></footer>
      </main>
    </div>
  );
}
