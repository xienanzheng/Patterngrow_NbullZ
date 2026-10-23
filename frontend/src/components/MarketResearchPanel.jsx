import { useState } from 'react';

const sources = { yahoo: 'Yahoo Finance', twelvedata: 'Twelve Data', synthetic: 'Synthetic sample', unknown: 'Unknown source' };
const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
const compact = (value) => Number.isFinite(value) ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value) : '—';
const percent = (value) => Number.isFinite(value) ? `${number(value)}%` : '—';

function Metric({ label, value, detail, accent = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className={`mt-2 text-2xl font-semibold tracking-tight ${accent ? 'text-amber-300' : 'text-zinc-100'}`}>{value}</dd>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{detail}</p>
    </div>
  );
}

export default function MarketResearchPanel({ research, interval = '1d', compactView = false }) {
  const [view, setView] = useState('volume');
  if (!research) return null;
  const { volume = {}, risk = {}, quality = {}, metadata = {} } = research;
  const daily = interval === '1d';
  const unit = daily ? 'session' : 'bar';
  const currency = metadata.currency;
  const views = [{ id: 'volume', label: 'Volume & activity' }, { id: 'risk', label: 'Returns & risk' }, { id: 'quality', label: 'Data quality' }];
  const asOf = quality.asOf ? new Date(quality.asOf) : null;
  const sessionDate = quality.asOfPrecision === 'date';
  const dateText = asOf && !Number.isNaN(asOf.getTime()) ? asOf.toLocaleString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...(sessionDate ? {} : { hour: '2-digit', minute: '2-digit' }) }) : 'Unavailable';

  return (
    <section aria-label="Market research analytics" className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div>
          <h2 className="font-semibold text-zinc-100">{compactView ? 'Volume & historical risk' : 'Inside the numbers'}</h2>
          <p className="mt-1 text-xs text-zinc-500">{number(quality.barCount, 0)} observed bars · {sources[quality.source] ?? quality.source ?? 'Unknown source'}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider ${quality.status === 'ok' ? 'border-zinc-700 text-zinc-300' : 'border-amber-400/25 text-amber-300'}`}>
          {quality.status === 'ok' ? 'Fields complete' : quality.status === 'unavailable' ? 'Unavailable' : 'Partial data'}
        </span>
      </div>
      <div className="px-5 py-4">
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Analytics sections">
          {views.map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => setView(item.id)} className={`rounded-lg px-3 py-2 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 ${view === item.id ? 'bg-amber-400/15 text-amber-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}`}>{item.label}</button>)}
        </div>
        {view === 'volume' && <>
          <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label={`Latest ${unit} volume`} value={compact(volume.latest)} detail="Reported volume; the latest bar may be incomplete." />
            <Metric label="Relative volume · 20" value={Number.isFinite(volume.relative20) ? `${number(volume.relative20)}×` : '—'} detail={`Latest ÷ prior 20 ${unit}s. ${daily ? 'An unfinished session is not directly comparable.' : 'Not normalized for time of day.'}`} accent />
            <Metric label="Volume percentile" value={percent(volume.percentile20)} detail={`Percent of the prior 20 ${unit}s below the latest volume, with half-weight for ties.`} />
            <Metric label="Approx. turnover" value={Number.isFinite(volume.dollarVolume) ? `${currency ? `${currency} ` : ''}${compact(volume.dollarVolume)}` : '—'} detail={`Close × volume. ${currency ? `${currency}; ` : 'Currency unverified; '}not actual traded value or bid–ask liquidity.`} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-xs text-zinc-400">
            <p>Prior 20 average <span className="ml-2 font-medium text-zinc-200">{compact(volume.average20)}</span></p>
            <p>OBV change · 20 bars <span className="ml-2 font-medium text-zinc-200">{compact(volume.obvChange20)}</span></p>
            <p>Prior volume observations <span className="ml-2 font-medium text-zinc-200">{volume.sampleSize ?? 0}/20</span></p>
          </div>
        </>}
        {view === 'risk' && <>
          <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label={`1-${unit} return`} value={percent(risk.return1)} detail="Close-to-close price change." />
            <Metric label={`5-${unit} return`} value={percent(risk.return5)} detail="Price return over five observed bars." />
            <Metric label={`20-${unit} return`} value={percent(risk.return20)} detail="Price return over twenty observed bars." />
            <Metric label="Maximum drawdown" value={percent(risk.maxDrawdown)} detail="Largest close-to-close peak decline in the selected history." accent />
            <Metric label="Realized volatility · 20" value={percent(risk.realizedVolatility20)} detail={daily ? 'Annualized sample standard deviation of daily log returns; 252 sessions/year.' : 'Available on daily bars only; intraday annualization is not assumed.'} />
            <Metric label="ATR · 14" value={number(risk.atr14)} detail="Mean of 14 true ranges, in price units. Not a price forecast." />
            <Metric label="ATR / close" value={percent(risk.atrPercent14)} detail="The same historical range measure as a percentage of the latest close." />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">Historical price returns exclude cash dividends. Corporate-action adjustments are unverified. These descriptive measures are not a forecast.</p>
        </>}
        {view === 'quality' && <div className="space-y-4 text-xs text-zinc-400">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
            {[[sessionDate ? 'Latest session date' : 'Latest bar timestamp (UTC)', dateText], ['Bar age', sessionDate ? 'Session date only' : Number.isFinite(quality.ageHours) ? `${number(quality.ageHours, 1)} hours` : 'Unknown'], ['Missing volume', quality.missingVolumeBars ?? '—'], ['Invalid price bars', quality.invalidPriceBars ?? '—'], ['Duplicate timestamps', quality.duplicateBars ?? '—'], ['Out-of-order bars', quality.outOfOrderBars ?? '—'], ['Feed latency', 'Unverified'], ['Currency', currency ?? 'Unverified']].map(([label, value]) => <div key={label}><dt className="text-zinc-500">{label}</dt><dd className="mt-1 text-zinc-200">{value}</dd></div>)}
          </dl>
          <p className="leading-relaxed">Bar age is measured from the provider timestamp, which may represent a session date or the opening of a bar. It does not establish whether the market is open, a session has completed, or a feed is real time.</p>
          {quality.warnings?.length > 0 && <ul className="list-disc space-y-2 border-t border-zinc-800 pl-4 pt-4">{quality.warnings.map((warning, i) => <li key={i}>{typeof warning === 'string' ? warning : warning.message}</li>)}</ul>}
        </div>}
      </div>
    </section>
  );
}
