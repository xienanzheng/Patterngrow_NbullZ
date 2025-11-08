import { useEffect, useMemo, useState } from 'react';
import { addWatchlistSymbol, getWatchlist, removeWatchlistSymbol } from '../services/api';

export default function WatchlistTable({ user, accessToken, activeSymbol, onSelectSymbol }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formSymbol, setFormSymbol] = useState('');
  const [feedback, setFeedback] = useState(null);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (!a.inserted_at || !b.inserted_at) return 0;
        return new Date(b.inserted_at) - new Date(a.inserted_at);
      }),
    [rows],
  );

  const canManageWatchlist = Boolean(user?.id && accessToken);

  const refresh = async () => {
    if (!canManageWatchlist) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFeedback(null);
    try {
      const payload = await getWatchlist(accessToken);
      setRows(payload?.rows ?? []);
    } catch (err) {
      console.error('Failed to load watchlist', err);
      setFeedback(err instanceof Error ? err.message : 'Unable to load watchlist right now.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        if (!canManageWatchlist) {
          setRows([]);
          return;
        }
        const payload = await getWatchlist(accessToken);
        if (!cancelled) setRows(payload?.rows ?? []);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load watchlist', err);
          setFeedback(err instanceof Error ? err.message : 'Unable to load watchlist right now.');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [canManageWatchlist, accessToken]);

  const handleAdd = async (event) => {
    event.preventDefault();
    const symbol = formSymbol.trim().toUpperCase();
    if (!symbol) {
      setFeedback('Enter a ticker symbol before adding.');
      return;
    }
    if (!canManageWatchlist) {
      setFeedback('Sign in to manage your watchlist.');
      return;
    }
    setFeedback(null);

    const existing = rows.find((row) => row.symbol === symbol);
    if (existing) {
      setFeedback(`${symbol} is already on your watchlist.`);
      if (onSelectSymbol) onSelectSymbol(symbol);
      return;
    }

    try {
      await addWatchlistSymbol(symbol, accessToken);
      setFormSymbol('');
      await refresh();
      if (onSelectSymbol) onSelectSymbol(symbol);
    } catch (err) {
      console.error('Failed to add symbol', err);
      setFeedback(err instanceof Error ? err.message : 'Could not add symbol.');
    }
  };

  const handleDelete = async (id) => {
    if (!canManageWatchlist) return;
    try {
      await removeWatchlistSymbol(id, accessToken);
      await refresh();
    } catch (err) {
      console.error('Failed to delete symbol', err);
      setFeedback(err instanceof Error ? err.message : 'Could not delete symbol.');
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Watchlist</h2>
          <p className="text-xs text-slate-400">
            Track tickers you care about. Data is stored securely through the backend using a Supabase service role.
          </p>
        </div>
      </header>

      <form onSubmit={handleAdd} className="mb-4 flex gap-2">
        <input
          type="text"
          value={formSymbol}
          onChange={(event) => setFormSymbol(event.target.value)}
          placeholder="Add ticker (e.g. AAPL)"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          disabled={!canManageWatchlist}
        />
        <button
          type="submit"
          disabled={!canManageWatchlist}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add
        </button>
      </form>

      {feedback ? (
        <p className="mb-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {feedback}
        </p>
      ) : null}

      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-slate-400">Loading watchlist…</p>
        ) : sortedRows.length === 0 ? (
          <p className="text-sm text-slate-500">No symbols yet. Add your first ticker above.</p>
        ) : (
          sortedRows.map((row) => (
            <div
              key={row.id}
              className={`flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 transition ${
                activeSymbol === row.symbol
                  ? 'bg-blue-500/10 border-blue-500/40'
                  : 'bg-slate-950/50 hover:border-blue-500/30 hover:bg-blue-500/5'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSymbol?.(row.symbol)}
                className="text-sm font-semibold uppercase tracking-wide text-slate-100"
              >
                {row.symbol}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(row.id)}
                className="text-xs font-medium text-slate-400 transition hover:text-red-400"
                disabled={!canManageWatchlist}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
