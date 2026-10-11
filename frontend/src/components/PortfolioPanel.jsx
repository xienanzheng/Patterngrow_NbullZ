import { useCallback, useEffect, useState } from 'react';
import { createPosition, deletePosition, getPositions, updatePosition } from '../services/api';

const money = (value) => (value == null ? '—' : `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (value) => (value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`);
const pnlColor = (value) => (value == null ? 'text-zinc-400' : value >= 0 ? 'text-emerald-300' : 'text-red-300');

export default function PortfolioPanel({ accessToken }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({ symbol: '', shares: '', costBasis: '', openedAt: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ shares: '', costBasis: '' });

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

  const startEdit = (row) => {
    setStatus('');
    setEditingId(row.id);
    setEditForm({ shares: String(row.shares ?? ''), costBasis: String(row.costBasis ?? '') });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ shares: '', costBasis: '' });
  };

  const handleUpdate = async (id) => {
    setStatus('');
    if (!(Number(editForm.shares) > 0) || !(Number(editForm.costBasis) > 0)) {
      setStatus('Positive shares and positive cost basis are required.');
      return;
    }
    try {
      await updatePosition(id, {
        shares: Number(editForm.shares),
        costBasis: Number(editForm.costBasis),
      }, accessToken);
      cancelEdit();
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not update position.');
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
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">Add Position</h2>
        <p className="mt-1 text-xs text-zinc-400">Manually track your holdings — enter shares and cost per share. Live prices are fetched for P&amp;L calculations. This is a personal tracker, not connected to any brokerage.</p>
        <form onSubmit={handleAdd} className="mt-4 grid gap-3 md:grid-cols-5">
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => setForm((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
            placeholder="Symbol"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          />
          <input
            type="number"
            min="0"
            step="any"
            value={form.shares}
            onChange={(e) => setForm((prev) => ({ ...prev, shares: e.target.value }))}
            placeholder="Shares"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.costBasis}
            onChange={(e) => setForm((prev) => ({ ...prev, costBasis: e.target.value }))}
            placeholder="Cost / share ($)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          />
          <input
            type="date"
            value={form.openedAt}
            onChange={(e) => setForm((prev) => ({ ...prev, openedAt: e.target.value }))}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          />
          <button
            type="submit"
            disabled={!accessToken}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add
          </button>
        </form>
        {status ? <p className="mt-3 text-sm text-amber-200">{status}</p> : null}
      </section>

      {summary ? (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <p className="text-xs font-medium text-zinc-500">Total Cost</p>
            <p className="mt-1 text-xl font-semibold text-white">{money(summary.totalCost)}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <p className="text-xs font-medium text-zinc-500">Market Value</p>
            <p className="mt-1 text-xl font-semibold text-white">{money(summary.totalValue)}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <p className="text-xs font-medium text-zinc-500">Unrealized P&L</p>
            <p className={`mt-1 text-xl font-semibold ${pnlColor(summary.totalPnl)}`}>
              {money(summary.totalPnl)} {summary.totalPnlPct != null ? `(${pct(summary.totalPnlPct)})` : ''}
            </p>
            {summary.unpricedCount > 0 ? (
              <p className="text-xs text-amber-300">Excludes {summary.unpricedCount} position{summary.unpricedCount > 1 ? 's' : ''} with no live quote.</p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <p className="text-xs font-medium text-zinc-500">SPY benchmark</p>
            <p className={`mt-1 text-xl font-semibold ${pnlColor(summary.spyReturnPct)}`}>{pct(summary.spyReturnPct)}</p>
            <p className="mt-1 text-xs text-zinc-500">S&P 500 ETF return since your earliest position date</p>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h3 className="text-sm font-semibold text-zinc-400">Positions</h3>
        {loading ? (
          <p className="mt-3 text-sm text-zinc-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No positions yet. Add your first holding above.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800 text-sm text-zinc-200">
              <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-400">
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
              <tbody className="divide-y divide-zinc-800">
                {rows.map((row) => {
                  const isEditing = editingId === row.id;
                  return (
                  <tr key={row.id}>
                    <td className="px-4 py-2 font-semibold text-white">{row.symbol}</td>
                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editForm.shares}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, shares: e.target.value }))}
                          className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                        />
                      ) : (
                        row.shares
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.costBasis}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, costBasis: e.target.value }))}
                          className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                        />
                      ) : (
                        money(row.costBasis)
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{money(row.price)}</td>
                    <td className="px-4 py-2 text-right">{money(row.value)}</td>
                    <td className={`px-4 py-2 text-right ${pnlColor(row.pnl)}`}>
                      {money(row.pnl)} {row.pnlPct != null ? `(${pct(row.pnlPct)})` : ''}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <span className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => handleUpdate(row.id)}
                            className="text-xs font-medium text-emerald-300 transition hover:text-emerald-200"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="text-xs font-medium text-zinc-400 transition hover:text-amber-300"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row.id)}
                            className="text-xs font-medium text-zinc-400 transition hover:text-red-400"
                          >
                            Remove
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
