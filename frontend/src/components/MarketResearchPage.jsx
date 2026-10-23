import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getMarketResearch, getProviderStatus } from '../services/api';
import MarketResearchPanel from './MarketResearchPanel';
import FundamentalsCard from './FundamentalsCard';
import MarketComparisonPanel from './MarketComparisonPanel';
import MarketOverviewPanel from './MarketOverviewPanel';
import { downloadResearchFile, historyCsv, normalizeResearchSymbol, normalizeWorkspace, readSavedViews, researchSessionDate, researchSnapshot, saveWorkspaceView, WORKSPACE_STORAGE_KEY, workspaceQuery } from '../utils/researchWorkspace';

const periods = [{ label: '1M', range: '1mo' }, { label: '3M', range: '3mo' }, { label: '6M', range: '6mo' }, { label: '1Y', range: '1y' }, { label: '2Y', range: '2y' }];
const fmt = (v) => Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
const compact = (v) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const dateLabel = (date) => new Date(date).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
const tooltipStyle = { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 12, fontSize: 12 };

export default function MarketResearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const workspace = normalizeWorkspace(Object.fromEntries(searchParams));
  const { symbol, benchmark, range, view } = workspace;
  const [input, setInput] = useState(symbol);
  const [revision, setRevision] = useState(0);
  const [responsePayload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState(null);
  const [providerError, setProviderError] = useState('');
  const [savedViews, setSavedViews] = useState(() => { try { return readSavedViews(window.localStorage); } catch { return []; } });
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const requestId = useRef(0);
  const symbolInput = useRef(null);
  const workspaceKey = workspaceQuery(workspace);
  const payload = responsePayload?.symbol === symbol && responsePayload?.range === range ? responsePayload : null;
  const awaitingData = loading || (!payload && !error);

  function updateWorkspace(updates) {
    setSearchParams(workspaceQuery({ ...workspace, ...updates }));
    setWorkspaceMessage('');
    setShareUrl('');
  }

  function persistViews(views) {
    setSavedViews(views);
    try {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(views));
      setWorkspaceMessage('Saved views are stored in this browser.');
    } catch {
      setWorkspaceMessage('Browser storage is unavailable. Views will last until this page closes.');
    }
  }

  async function copyResearchLink() {
    const url = new URL(window.location.href);
    url.search = workspaceQuery(workspace);
    const isCurrent = () => workspaceQuery(Object.fromEntries(new URLSearchParams(window.location.search))) === workspaceKey;
    try { await navigator.clipboard.writeText(url.href); if (isCurrent()) setWorkspaceMessage('Research link copied. It preserves the symbols, period and view.'); }
    catch { if (isCurrent()) { setShareUrl(url.href); setWorkspaceMessage('Copy this research link:'); } }
  }

  useEffect(() => { setShareUrl(''); setWorkspaceMessage(''); }, [workspaceKey]);
  useEffect(() => { setInput(symbol); }, [symbol]);
  useEffect(() => {
    const focusSearch = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.target?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName ?? '')) return;
      event.preventDefault();
      symbolInput.current?.focus();
      symbolInput.current?.select();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setPayload(null);
    getMarketResearch(symbol, { range, interval: '1d', signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted && id === requestId.current) setPayload(data); })
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
    return { ...bar, displayDate: researchSessionDate(bar) ?? bar.date, averageVolume: complete ? prior.reduce((sum, item) => sum + item.volume, 0) / 20 : null };
  });
  const change = payload?.research?.risk?.return1;
  const source = payload?.research?.quality?.source;
  const sourceName = source === 'yahoo' ? 'Yahoo Finance' : source === 'twelvedata' ? 'Twelve Data' : source ?? 'Awaiting data';

  return (
    <div className="min-h-screen bg-[#09090b] pb-12">
      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-4 sm:px-7">
          <Link to="/research" className="text-lg font-semibold tracking-tight text-zinc-100">pattern<span className="text-amber-300">grow</span><span className="ml-3 hidden border-l border-zinc-700 pl-3 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 sm:inline">Research terminal</span></Link>
          <div className="flex items-center gap-4"><span className="hidden text-[10px] uppercase tracking-widest text-zinc-500 md:block">Historical data · Source attached</span><Link to="/dashboard" className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-amber-400">Dashboard ↗</Link></div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] space-y-5 px-4 pt-6 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">The market, in context</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Research workspace</h1></div><p className="max-w-md text-xs leading-relaxed text-zinc-500">Daily observations, comparative analytics and the evidence behind each number.</p></div>
        <div><button type="button" aria-expanded={overviewExpanded} aria-controls="market-overview-content" onClick={() => setOverviewExpanded((value) => !value)} className="mb-2 flex w-full items-center justify-between rounded-lg border border-zinc-800 px-4 py-3 text-xs text-zinc-300 md:hidden">Market overview · 6 fund proxies <span>{overviewExpanded ? 'Collapse −' : 'Expand +'}</span></button><div id="market-overview-content" className={`${overviewExpanded ? 'block' : 'hidden'} md:block`}><MarketOverviewPanel onSelectSymbol={(next) => { updateWorkspace({ symbol: next }); setOverviewExpanded(false); }} /></div></div>

        <section aria-label="Research controls" className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="flex flex-wrap items-end gap-4 p-4">
            <form onSubmit={(event) => { event.preventDefault(); const normalized = normalizeResearchSymbol(input, null); if (normalized) { updateWorkspace({ symbol: normalized }); setRevision((value) => value + 1); } }} className="w-full sm:w-auto">
              <label htmlFor="research-symbol" className="mb-2 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-zinc-500">Research symbol <span className="normal-case tracking-normal">Press / to search</span></label>
              <div className="flex gap-2"><input ref={symbolInput} id="research-symbol" required maxLength={20} pattern="[A-Za-z0-9.\^=\-]{1,20}" value={input} onChange={(event) => setInput(event.target.value.toUpperCase())} className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm font-medium focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 sm:w-40" /><button type="submit" className="rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-200">Explore</button></div>
            </form>
            <div><p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Period · Daily bars</p><div className="flex gap-1 rounded-lg bg-zinc-950 p-1" aria-label="History range">{periods.map((period) => <button key={period.range} type="button" aria-pressed={range === period.range} onClick={() => updateWorkspace({ range: period.range })} className={`rounded-md px-3 py-2 text-xs ${range === period.range ? 'bg-zinc-800 text-amber-200' : 'text-zinc-500 hover:text-zinc-200'}`}>{period.label}</button>)}</div></div>
            <div className="flex flex-wrap gap-2 sm:ml-auto"><button type="button" onClick={() => persistViews(saveWorkspaceView(savedViews, workspace))} className="rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:border-amber-400">Save view</button><button type="button" onClick={copyResearchLink} className="rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:border-amber-400">Copy link ↗</button></div>
          </div>
          <div className="flex flex-wrap gap-1 border-t border-zinc-800 px-3 py-2" aria-label="Research views">{[{ id: 'price', label: 'Price & volume' }, { id: 'compare', label: 'Compare' }, { id: 'fundamentals', label: 'Fundamentals' }, { id: 'sources', label: 'Sources' }].map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => updateWorkspace({ view: item.id })} className={`rounded-lg px-4 py-2 text-xs font-medium ${view === item.id ? 'bg-amber-300/10 text-amber-200' : 'text-zinc-400 hover:bg-zinc-800'}`}>{item.label}</button>)}</div>
        </section>
        {savedViews.length > 0 && <div aria-label="Saved research views" className="flex flex-wrap items-center gap-2"><span className="mr-1 text-[10px] uppercase tracking-wider text-zinc-500">Saved views</span>{savedViews.map((item) => { const key = workspaceQuery(item); return <div key={key} className="flex overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"><button type="button" onClick={() => updateWorkspace(item)} className="px-3 py-2 text-[11px] text-zinc-300 hover:text-amber-200">{item.symbol}{item.view === 'compare' ? ` / ${item.benchmark}` : ''} · {periods.find((period) => period.range === item.range)?.label} · {item.view}</button><button type="button" aria-label={`Remove saved view ${item.symbol} ${item.benchmark} ${item.range} ${item.view}`} onClick={() => persistViews(savedViews.filter((saved) => workspaceQuery(saved) !== key))} className="border-l border-zinc-800 px-2 text-zinc-500 hover:text-rose-300">×</button></div>; })}</div>}
        {workspaceMessage && <div role="status" className="text-xs text-amber-200">{workspaceMessage}{shareUrl && <input aria-label="Shareable research link" readOnly value={shareUrl} onFocus={(event) => event.target.select()} className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-zinc-300" />}</div>}

        {view === 'price' && <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40" aria-busy={awaitingData}>
          <div className="flex flex-wrap items-center justify-between gap-5 border-b border-zinc-800 p-5 sm:px-6">
            <div>
              <div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{symbol}</h2><span className="rounded-md bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">DAILY HISTORY</span></div>
              <div className="mt-2 flex flex-wrap items-baseline gap-3"><span className="text-3xl font-semibold tracking-tight">{fmt(latest?.close)}<span className="ml-2 text-sm font-normal text-zinc-500">{currency ?? ''}</span></span><span className={`text-xs ${change < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{Number.isFinite(change) ? `${change > 0 ? '+' : ''}${fmt(change)}% last bar` : 'Awaiting price history'}</span></div>
              <p className="mt-2 text-[11px] text-zinc-500">{sourceName} · Feed delay unverified{latest?.date ? ` · Last bar ${dateLabel(researchSessionDate(latest) ?? latest.date)}${researchSessionDate(latest) ? ' (exchange date)' : ' (UTC; exchange date unknown)'}` : ''}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={!history.length || loading} onClick={() => downloadResearchFile(historyCsv(payload), `${symbol}-${range}-daily.csv`, 'text/csv;charset=utf-8')} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 disabled:opacity-30">CSV ↓</button>
              <button type="button" disabled={!history.length || loading} onClick={() => downloadResearchFile(JSON.stringify(researchSnapshot(payload, workspace), null, 2), `${symbol}-${range}-research.json`, 'application/json')} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 disabled:opacity-30">Research snapshot ↓</button>
            </div>
          </div>
          {awaitingData ? <div role="status" className="flex h-80 items-center justify-center text-sm text-zinc-400">Loading historical market data…</div> : error ? <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-12 text-center"><p className="text-sm text-amber-200">{error}</p><p className="max-w-sm text-xs leading-relaxed text-zinc-500">No sample prices are substituted when a provider is unavailable.</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="rounded-lg border border-zinc-700 px-4 py-2 text-xs">Retry data request</button></div> : <>
            <div className="h-80 px-2 pt-6 sm:px-5" role="img" aria-label={`${symbol} daily closing prices for ${range}; latest ${fmt(latest?.close)} ${currency ?? ''}`}>
              <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }} syncId="research">
                <defs><linearGradient id="researchPriceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fcd34d" stopOpacity={0.16} /><stop offset="100%" stopColor="#fcd34d" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#27272a" strokeDasharray="3 6" />
                <XAxis dataKey="displayDate" tickFormatter={dateLabel} minTickGap={70} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={['auto', 'auto']} tickFormatter={fmt} width={65} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={dateLabel} formatter={(v) => [fmt(v), `Close ${currency ?? ''}`]} />
                <Area type="linear" dataKey="close" stroke="#fcd34d" strokeWidth={2} fill="url(#researchPriceFill)" isAnimationActive={false} connectNulls={false} />
              </AreaChart></ResponsiveContainer>
            </div>
            <div className="border-t border-zinc-800/70 px-2 pb-3 pt-4 sm:px-5">
              <div className="mb-2 flex flex-wrap justify-between gap-2 px-3 text-[11px]"><span className="font-medium text-zinc-300">Volume</span><span className="text-zinc-500">Green: close ≥ open · Pink: close &lt; open · Dashed: prior 20-bar average</span></div>
              <div className="h-36" role="img" aria-label={`${symbol} volume by session and prior 20-session average`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} syncId="research">
                <XAxis dataKey="displayDate" hide /><YAxis tickFormatter={compact} width={65} tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={dateLabel} formatter={(v, name) => [fmt(v), name === 'volume' ? 'Volume' : 'Prior 20 average']} />
                <Bar dataKey="volume" isAnimationActive={false}>{chartData.map((bar) => <Cell key={bar.date} fill={bar.open == null || bar.close == null ? '#52525b' : bar.close >= bar.open ? '#6ee7b7' : '#fda4af'} fillOpacity={0.65} />)}</Bar>
                <Line type="linear" dataKey="averageVolume" stroke="#a1a1aa" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </ComposedChart></ResponsiveContainer></div>
            </div>
          </>}
        </section>}

        {view === 'compare' && <MarketComparisonPanel symbol={symbol} benchmark={benchmark} range={range} onBenchmarkChange={(next) => updateWorkspace({ benchmark: next })} />}
        {view === 'fundamentals' && <FundamentalsCard symbol={symbol} />}
        {view !== 'fundamentals' && <MarketResearchPanel research={payload?.research} />}

        {view === 'sources' && <details open className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <summary className="cursor-pointer text-sm font-medium text-zinc-300">Data connections <span className="ml-2 text-xs font-normal text-zinc-500">Source coverage & availability</span></summary>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">Configuration status is not a health check. An API key does not establish real-time access or redistribution rights.</p>
          {providerError && <p className="mt-3 text-xs text-amber-200">Provider configuration is unavailable.</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{providers?.providers?.map((provider) => <div key={provider.id} className="rounded-xl border border-zinc-800 p-4"><p className="text-sm font-medium">{provider.name}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-amber-200">{provider.configured ? provider.role : 'Not configured'}</p><p className="mt-3 text-xs leading-relaxed text-zinc-500">{provider.notes}</p></div>)}</div>
        </details>}
        <footer className="flex flex-wrap justify-between gap-3 border-t border-zinc-800 pt-5 text-[11px] leading-relaxed text-zinc-500"><p>Historical research · Unverified feed delay · Latest bar may be incomplete</p><p>{payload?.fetchedAt ? `Retrieved ${new Date(payload.fetchedAt).toLocaleTimeString()} · Cache up to 60s` : 'Source timestamps appear when data is available.'}</p></footer>
      </main>
    </div>
  );
}
