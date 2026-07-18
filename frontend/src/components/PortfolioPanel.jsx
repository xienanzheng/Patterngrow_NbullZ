import { useCallback, useEffect, useState } from 'react';
import { createPosition, deletePosition, getPositions } from '../services/api';

const money = (value) => (value == null ? '—' : `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (value) => (value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`);
const pnlColor = (value) => (value == null ? 'text-slate-400' : value >= 0 ? 'text-emerald-300' : 'text-red-300');

export default function PortfolioPanel({ accessToken }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({ symbol: '', shares: '', costBasis: '', openedAt: '' });

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await getPositions(accessToken);
      setRows(payload?.rows ?? []);
      setSummary(payload?.summary ?? null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Unable to load positions.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = async (event) => {
    event.preventDefault();
    setStatus('');
    if (!form.symbol.trim() || !(Number(form.shares) > 0) || !(Number(form.costBasis) > 0)) {
      setStatus('Symbol, positive shares, and positive cost basis are required.');
      return;
    }
    try {
      await createPosition({
        symbol: form.symbol.trim().toUpperCase(),
        shares: Number(form.shares),
        costBasis: Number(form.costBasis),
        openedAt: form.openedAt || undefined,
      }, accessToken);
      setForm({ symbol: '', shares: '', costBasis: '', openedAt: '' });
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not add position.');
    }
  };

  const handleDelete = async (id) => {
    try {
      await deletePosition(id, accessToken);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not remove position.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">Add Position</h2>
        <p className="mt-1 text-xs text-slate-400">Track real holdings: shares and per-share cost basis. Requires the Supabase positions table.</p>
        <form onSubmit={handleAdd} className="mt-4 grid gap-3 md:grid-cols-5">
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => setForm((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
            placeholder="Symbol"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <input
            type="number"
            min="0"
            step="any"
            value={form.shares}
            onChange={(e) => setForm((prev) => ({ ...prev, shares: e.target.value }))}
            placeholder="Shares"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.costBasis}
            onChange={(e) => setForm((prev) => ({ ...prev, costBasis: e.target.value }))}
            placeholder="Cost / share ($)"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <input
            type="date"
            value={form.openedAt}
            onChange={(e) => setForm((prev) => ({ ...prev, openedAt: e.target.value }))}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <button
            type="submit"
            disabled={!accessToken}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add
          </button>
        </form>
        {status ? <p className="mt-3 text-sm text-amber-200">{status}</p> : null}
      </section>

      {summary ? (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total Cost</p>
            <p className="mt-1 text-xl font-semibold text-white">{money(summary.totalCost)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-400">Market Value</p>
            <p className="mt-1 text-xl font-semibold text-white">{money(summary.totalValue)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-400">Unrealized P&L</p>
            <p className={`mt-1 text-xl font-semibold ${pnlColor(summary.totalPnl)}`}>
              {money(summary.totalPnl)} {summary.totalPnlPct != null ? `(${pct(summary.totalPnlPct)})` : ''}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-400">SPY (same period)</p>
            <p className={`mt-1 text-xl font-semibold ${pnlColor(summary.spyReturnPct)}`}>{pct(summary.spyReturnPct)}</p>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Positions</h3>
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No positions yet. Add your first holding above.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
              <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left">Symbol</th>
                  <th className="px-4 py-2 text-right">Shares</th>
                  <th className="px-4 py-2 text-right">Cost / share</th>
                  <th className="px-4 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right">Value</th>
                  <th className="px-4 py-2 text-right">P&L</th>
                  <th className="px-4 py-2 text-right" aria-label="actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 font-semibold text-white">{row.symbol}</td>
                    <td className="px-4 py-2 text-right">{row.shares}</td>
                    <td className="px-4 py-2 text-right">{money(row.costBasis)}</td>
                    <td className="px-4 py-2 text-right">{money(row.price)}</td>
                    <td className="px-4 py-2 text-right">{money(row.value)}</td>
                    <td className={`px-4 py-2 text-right ${pnlColor(row.pnl)}`}>
                      {money(row.pnl)} {row.pnlPct != null ? `(${pct(row.pnlPct)})` : ''}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="text-xs font-medium text-slate-400 transition hover:text-red-400"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
