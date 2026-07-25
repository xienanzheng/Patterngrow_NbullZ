import { useEffect, useState } from 'react';
import { getCompanyDetails, getFundamentals } from '../services/api';

const fmt = {
  currency: (v, cur = 'USD') => {
    if (v == null) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${cur} ${(v / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${cur} ${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${cur} ${(v / 1e6).toFixed(2)}M`;
    return `${cur} ${v.toLocaleString()}`;
  },
  num: (v, decimals = 2) => (v == null ? '—' : Number(v).toFixed(decimals)),
  pct: (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`),
  vol: (v) => {
    if (v == null) return '—';
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  },
};

export default function FundamentalsCard({ symbol }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    getCompanyDetails(symbol)
      .then((res) => { if (!cancelled) setCompany(res.details); })
      .catch(() => { if (!cancelled) setCompany(null); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    getFundamentals(symbol)
      .then((res) => { if (!cancelled) setData(res.fundamentals); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (!symbol) return null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-3">
        <p className="text-xs text-zinc-500">Loading fundamentals…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-3">
        <p className="text-xs text-zinc-500">{error || 'Fundamentals unavailable for this ticker.'}</p>
      </div>
    );
  }

  const cur = data.currency ?? 'USD';

  const keyMetrics = [
    { label: 'Market Cap', value: fmt.currency(data.marketCap, cur) },
    { label: 'P/E (TTM)',  value: fmt.num(data.trailingPE) },
    { label: 'Fwd P/E',   value: fmt.num(data.forwardPE) },
    { label: 'EPS (TTM)', value: data.trailingEps != null ? `${cur} ${fmt.num(data.trailingEps)}` : '—' },
    { label: 'Beta',      value: fmt.num(data.beta) },
    { label: '52W Range', value: data.fiftyTwoWeekLow != null && data.fiftyTwoWeekHigh != null
        ? `${fmt.num(data.fiftyTwoWeekLow, 0)} – ${fmt.num(data.fiftyTwoWeekHigh, 0)}` : '—' },
  ];

  const allMetrics = [
    ...keyMetrics,
    { label: 'Fwd EPS',       value: data.forwardEps != null ? `${cur} ${fmt.num(data.forwardEps)}` : '—' },
    { label: 'Volume',        value: fmt.vol(data.volume) },
    { label: 'Avg Volume',    value: fmt.vol(data.averageVolume) },
    { label: 'Dividend',      value: data.dividendRate != null ? `${cur} ${fmt.num(data.dividendRate)} (${fmt.pct(data.dividendYield)})` : '—' },
    { label: 'Revenue',       value: fmt.currency(data.totalRevenue, cur) },
    { label: 'Rev Growth',    value: fmt.pct(data.revenueGrowth) },
    { label: 'Gross Margin',  value: fmt.pct(data.grossMargins) },
    { label: 'Net Margin',    value: fmt.pct(data.profitMargins) },
    { label: 'Total Debt',    value: fmt.currency(data.totalDebt, cur) },
    { label: 'Analyst Target',value: data.targetMeanPrice != null ? `${cur} ${fmt.num(data.targetMeanPrice)}` : '—' },
  ];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <h3 className="text-sm font-semibold text-zinc-200">Fundamentals</h3>
        <span className={`text-zinc-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {/* Always-visible key metrics strip */}
      <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 md:grid-cols-6">
        {keyMetrics.map((m) => (
          <div key={m.label}>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{m.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-100">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Expanded: rest of metrics + quarterly results */}
      {expanded ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-zinc-800 pt-4 md:grid-cols-4">
            {allMetrics.slice(keyMetrics.length).map((m) => (
              <div key={m.label}>
                <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{m.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-zinc-100">{m.value}</p>
              </div>
            ))}
          </div>

          {company?.description ? (
            <div className="mt-4 border-t border-zinc-800 pt-4">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">About</p>
              <p className="text-xs leading-relaxed text-zinc-300 line-clamp-4">{company.description}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                {company.exchange ? <span>Exchange: <span className="text-zinc-300">{company.exchange}</span></span> : null}
                {company.sic ? <span>Sector: <span className="text-zinc-300">{company.sic}</span></span> : null}
                {company.employees ? <span>Employees: <span className="text-zinc-300">{Number(company.employees).toLocaleString()}</span></span> : null}
                {company.listDate ? <span>Listed: <span className="text-zinc-300">{company.listDate}</span></span> : null}
                {company.homepage ? (
                  <a href={company.homepage} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
                    {new URL(company.homepage).hostname}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {data.quarterlyResults?.length > 0 ? (
            <div className="mt-4 border-t border-zinc-800 pt-4">
              <p className="mb-2 text-xs font-semibold text-zinc-400">Quarterly Financials (last 4)</p>
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-800 text-xs">
                  <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 text-left w-36">Metric</th>
                      {data.quarterlyResults.map((q) => (
                        <th key={q.date} className="px-3 py-2 text-right">{q.date ?? '—'}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-200">
                    {[
                      { label: 'Revenue',         key: 'revenue',           type: 'cur' },
                      { label: 'Gross Profit',     key: 'grossProfit',       type: 'cur' },
                      { label: 'Net Income',       key: 'netIncome',         type: 'cur', color: true },
                      { label: 'EPS (basic)',      key: 'basicEps',          type: 'eps', color: true },
                      { label: 'Operating CF',     key: 'operatingCashFlow', type: 'cur', color: true },
                      { label: 'Capex',            key: 'capEx',             type: 'cur' },
                      { label: 'Free Cash Flow',   key: 'freeCashFlow',      type: 'cur', color: true },
                      { label: 'Cash & Equiv',     key: 'cash',              type: 'cur' },
                      { label: 'Total Assets',     key: 'totalAssets',       type: 'cur' },
                      { label: 'Total Liabilities',key: 'totalLiabilities',  type: 'cur' },
                      { label: 'LT Debt',          key: 'longTermDebt',      type: 'cur' },
                      { label: 'Equity',           key: 'shareholderEquity', type: 'cur', color: true },
                    ].map(({ label, key, type, color }) => (
                      <tr key={key}>
                        <td className="px-3 py-1.5 text-zinc-400 font-medium">{label}</td>
                        {data.quarterlyResults.map((q) => {
                          const v = q[key];
                          const colorClass = color && v != null
                            ? (v >= 0 ? 'text-emerald-300' : 'text-red-300')
                            : 'text-zinc-200';
                          return (
                            <td key={q.date} className={`px-3 py-1.5 text-right font-semibold ${colorClass}`}>
                              {v == null
                                ? '—'
                                : type === 'eps'
                                  ? `${cur} ${fmt.num(v)}`
                                  : fmt.currency(v, cur)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
