import { useEffect, useRef, useState } from 'react';
import { createLatestRequestGate, getRecordedHistory } from '../services/api';

const INDICATORS = [['sma', 'SMA'], ['rsi', 'RSI'], ['macd', 'MACD'], ['bollinger', 'Bollinger'], ['stochastic', 'Stochastic'], ['adx', 'ADX']];
const number = (value, digits = 4) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : 'Unavailable';
const signed = (value, digits = 12) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value, digits)}` : 'Unavailable';
const timestamp = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `${date.toLocaleString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC` : 'Unavailable';
};

function measurementText(indicator, measurements) {
  const m = measurements ?? {};
  const values = {
    sma: `Close ${number(m.close)} · SMA20 ${number(m.sma20)}`,
    rsi: `Smoothed RSI ${number(m.rsiSmoothed3)} · raw RSI14 ${number(m.rsi14)}`,
    macd: `MACD − signal ${number(m.macdDivergence)}`,
    bollinger: `Close ${number(m.close)} · lower ${number(m.bollingerLower)} · upper ${number(m.bollingerUpper)}`,
    stochastic: `%K ${number(m.stochasticK14)}`,
    adx: `ADX ${number(m.adx14)} · +DI ${number(m.plusDI)} · −DI ${number(m.minusDI)}`,
  };
  return values[indicator];
}

const RULES = {
  sma: 'Close above SMA20 contributes +1; otherwise −1 when both observations are valid.',
  rsi: 'EMA3 of RSI14: below 30 contributes +1, above 70 contributes −1, otherwise 0.',
  macd: 'Positive MACD-minus-signal contributes +1; negative contributes −1; zero contributes 0.',
  bollinger: 'Close below the lower band contributes +1; above the upper band contributes −1; otherwise 0.',
  stochastic: '%K below 20 contributes +1; above 80 contributes −1; otherwise 0.',
  adx: 'ADX below 25 contributes 0. At 25 or above, +DI greater than −DI contributes +1; otherwise −1.',
};

function RecordingStatus({ recording }) {
  const forecast = {
    saved: 'Forecast row saved. A later request for the same symbol, date and model can replace it.',
    failed: 'The forecast save could not be confirmed; reload recorded history to check.',
    not_eligible: 'This request is not eligible for forecast recording.',
    not_configured: 'Forecast recording is not configured.',
  }[recording?.forecast?.status] ?? 'Forecast recording status is unavailable for this response.';
  return <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
    <p>{forecast}</p>
    <p>{recording?.rating?.status === 'not_recorded_by_this_request' ? 'This page request did not write a daily rating record. Daily-summary records are separate.' : 'Daily rating recording status is unavailable for this response.'}</p>
  </div>;
}

function ArchiveTable({ section, kind }) {
  const daily = kind === 'daily';
  const rows = Array.isArray(section?.rows) ? section.rows.slice(0, 10) : [];
  const title = daily ? 'Recorded daily ratings' : 'Recorded forecast snapshots';
  const empty = section?.status === 'available' ? 'No stored observations were returned for this symbol.'
    : section?.status === 'not_configured' ? 'This archive is not configured.' : 'This archive could not be read. No missing history is inferred.';
  return <div>
    <h4 className="text-xs font-medium text-zinc-200">{title}</h4>
    <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{daily ? 'Daily-summary observations only. The first record for a symbol and UTC date is retained.' : 'The same symbol, UTC date and forecast model share one replaceable row; this is not a history of every request.'}</p>
    {section?.status !== 'available' || rows.length === 0 ? <p className="mt-3 text-xs text-zinc-400">{empty}</p> : <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" role="region" aria-label={title} tabIndex={0}>
      <table className="w-full min-w-[650px] text-left text-[11px]">
        <caption className="sr-only">{title}; showing at most 10 returned observations. Legacy labels are historical records.</caption>
        <thead className="bg-zinc-950 text-zinc-500"><tr><th scope="col" className="px-3 py-2">Record date</th><th scope="col" className="px-3 py-2">Created at (UTC)</th><th scope="col" className="px-3 py-2">Recorded legacy label</th><th scope="col" className="px-3 py-2">Score</th><th scope="col" className="px-3 py-2">{daily ? 'Recorded votes' : 'Model / horizon'}</th></tr></thead>
        <tbody className="divide-y divide-zinc-800">{rows.map((row, index) => <tr key={`${row.decisionDate ?? row.snapshotDate}-${row.model ?? ''}-${index}`}>
          <td className="whitespace-nowrap px-3 py-2 text-zinc-300">{row.decisionDate ?? row.snapshotDate ?? 'Unavailable'}</td>
          <td className="px-3 py-2 text-zinc-500">{timestamp(row.createdAt)}</td>
          <td className="px-3 py-2 text-zinc-300">{row.label ?? 'Unavailable'}</td>
          <td className="px-3 py-2 font-mono text-zinc-300">{signed(row.score)}</td>
          <td className="max-w-xs px-3 py-2 text-zinc-500">{daily ? INDICATORS.filter(([key]) => Number.isFinite(row.votes?.[key])).map(([key, label]) => `${label} ${signed(row.votes[key], 0)}`).join(' · ') || 'Votes unavailable' : `${row.model ?? 'Unknown model'} / ${Number.isFinite(row.horizon) ? `${row.horizon} bars` : 'unknown horizon'}`}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

export default function RatingAuditPanel({ snapshot, token }) {
  const symbol = snapshot?.symbol;
  const [archive, setArchive] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requests = useRef(null);
  if (requests.current == null) requests.current = createLatestRequestGate();

  useEffect(() => {
    requests.current.cancel();
    setArchive(null);
    setError('');
    setLoading(false);
    return () => requests.current.cancel();
  }, [symbol, token]);

  async function loadHistory() {
    if (!token || !symbol) return;
    const current = requests.current.start();
    setLoading(true);
    setError('');
    try {
      const result = await getRecordedHistory(symbol, { token, signal: current.signal });
      if (!current.isCurrent()) return;
      if (result?.symbol !== symbol) throw new Error('The recorded history does not match this symbol. Please retry.');
      setArchive(result);
    } catch {
      if (current.isCurrent()) { setArchive(null); setError('Recorded history could not be loaded. Please retry.'); }
    } finally {
      if (current.isCurrent()) setLoading(false);
    }
  }

  if (!snapshot) return null;
  const conviction = snapshot.conviction ?? {};
  const quality = snapshot.research?.quality ?? {};
  const weights = conviction.normalizedWeights ?? conviction.weights ?? {};
  const visibleArchive = archive?.symbol === symbol ? archive : null;
  const dateOnly = quality.asOfPrecision === 'date' || quality.asOfPrecision === 'session-date';

  return <details className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-4">
    <summary className="cursor-pointer rounded text-sm font-medium text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Explain this state <span className="ml-2 text-[11px] font-normal text-zinc-500">Inputs, recording status & historical observations</span></summary>
    <div className="mt-4 space-y-5">
      <p className="text-xs leading-relaxed text-zinc-400">This is a historical rule calculation. Comparing the same symbol requires the same period, bar interval, weights, calculation version and data provenance. A changed label alone does not establish what changed in the underlying observations.</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[11px] sm:grid-cols-4">
        {[
          ['Symbol / period', `${symbol} / ${snapshot.range ?? 'unknown'}`],
          ['Bar interval', snapshot.interval ?? 'Unknown'],
          [dateOnly ? 'Latest session label' : 'Latest bar timestamp', dateOnly ? quality.asOf?.slice(0, 10) ?? 'Unavailable' : timestamp(quality.asOf)],
          ['Calculated at', timestamp(snapshot.generatedAt)],
          ['Calculation version', conviction.calculationVersion ?? 'Unavailable'],
          ['Weighted score', signed(conviction.score)],
          ['Historical input', `${conviction.inputs?.validCloseCount ?? 'Unknown'} valid closes / ${conviction.inputs?.barCount ?? 'unknown'} bars`],
          ['Source', quality.source ?? snapshot.dataSource ?? 'Unknown'],
        ].map(([label, value]) => <div key={label}><dt className="text-zinc-500">{label}</dt><dd className="mt-1 break-words text-zinc-300">{value}</dd></div>)}
      </dl>
      {conviction.insufficientData && <p className="text-xs text-amber-200">Indicator warm-up is incomplete. The returned votes are withheld; the neutral state is not evidence of balanced observations.</p>}
      <div className="overflow-x-auto rounded-lg border border-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" role="region" aria-label="Current indicator vote contributions" tabIndex={0}>
        <table className="w-full min-w-[620px] text-left text-[11px]">
          <caption className="sr-only">Current measured indicator inputs, signed votes and normalized weighted contributions.</caption>
          <thead className="bg-zinc-950 text-zinc-500"><tr><th scope="col" className="px-3 py-2">Indicator / observed basis</th><th scope="col" className="px-3 py-2">Vote</th><th scope="col" className="px-3 py-2">Weight</th><th scope="col" className="px-3 py-2">Contribution</th></tr></thead>
          <tbody className="divide-y divide-zinc-800">{INDICATORS.map(([key, label]) => {
            const vote = conviction.votes?.[key];
            const weight = weights[key];
            const contribution = conviction.contributions?.[key] ?? (Number.isFinite(vote) && Number.isFinite(weight) ? vote * weight : null);
            return <tr key={key}><th scope="row" className="px-3 py-2 font-normal"><p className="font-medium text-zinc-300">{label}</p><p className="mt-1 text-[10px] text-zinc-500">{measurementText(key, conviction.measurements)}</p></th><td className="px-3 py-2 font-mono text-zinc-300">{signed(vote, 0)}</td><td className="px-3 py-2 text-zinc-300">{Number.isFinite(weight) ? `${number(weight * 100, 4)}%` : 'Unavailable'}</td><td className="px-3 py-2 font-mono text-zinc-300">{signed(contribution)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <details className="text-[11px] leading-relaxed text-zinc-500"><summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">How these signed contributions are calculated</summary><ul className="mt-2 list-disc space-y-1 pl-4">{INDICATORS.map(([key, label]) => <li key={key}><span className="text-zinc-400">{label}:</span> {RULES[key]}</li>)}</ul><p className="mt-2">Weights are normalized before multiplication; the score is their signed sum. RSI uses the smoothed value shown here. Displayed measurements may be rounded. Some indicators retain earlier values across missing source observations, so a displayed value does not guarantee a fresh observation.</p>{conviction.previousDecisionsUsed === false && <p className="mt-2">This calculation does not use earlier recorded ratings as an input.</p>}</details>
      <RecordingStatus recording={snapshot.recording} />
      <div className="border-t border-zinc-800 pt-4" aria-busy={loading}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xs font-medium text-zinc-200">Existing recorded observations</h3><p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-500">These are shared symbol archives, not a record of every page view. Archived legacy labels are shown as historical evidence. Missing historical measurements, weights and versions prevent exact attribution of a past label change.</p></div><button type="button" disabled={!token || loading} onClick={loadHistory} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">{loading ? 'Loading records…' : visibleArchive ? 'Reload recorded history' : 'Load recorded history'}</button></div>
        {!token && <p className="mt-2 text-xs text-zinc-500">Sign in to read existing recorded history.</p>}
        {loading && <p role="status" className="mt-3 text-xs text-zinc-400">Reading stored observations…</p>}
        {error && <p role="alert" className="mt-3 text-xs text-amber-200">{error}</p>}
        {visibleArchive && <div className="mt-4 space-y-5"><ArchiveTable section={visibleArchive.decisionLog} kind="daily" /><ArchiveTable section={visibleArchive.forecastLog} kind="forecast" />{visibleArchive.notes?.length > 0 && <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-500">{visibleArchive.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}</div>}
      </div>
    </div>
  </details>;
}
