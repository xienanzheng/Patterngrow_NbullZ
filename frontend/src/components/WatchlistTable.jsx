import { useEffect, useMemo, useState } from 'react';
import { addWatchlistSymbol, getWatchlist, removeWatchlistSymbol, scanWatchlist } from '../services/api';

export default function WatchlistTable({ user, accessToken, activeSymbol, onSelectSymbol }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formSymbol, setFormSymbol] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [scanRows, setScanRows] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  const handleScan = async () => {
    if (!canManageWatchlist) return;
    setScanning(true);
    setFeedback(null);
    try {
      const payload = await scanWatchlist(accessToken);
      setScanRows(payload?.rows ?? []);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Scan failed.');
    } finally {
      setScanning(false);
    }
  };

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
    if (!/^[A-Z]{1,6}(\.[A-Z]{1,2})?$/.test(symbol)) {
      setFeedback('Enter a valid ticker symbol (e.g. AAPL, BRK.B)');
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
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId((prev) => (prev === id ? null : prev)), 3000);
      return;
    }
    setConfirmId(null);
    try {
      await removeWatchlistSymbol(id, accessToken);
      await refresh();
    } catch (err) {
      console.error('Failed to delete symbol', err);
      setFeedback(err instanceof Error ? err.message : 'Could not delete symbol.');
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-inner">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Watchlist</h2>
          <p className="text-xs text-zinc-400">
            Track tickers you care about. Click a ticker to load its chart.
          </p>
        </div>
        <span className="group relative shrink-0">
          <button
            type="button"
            onClick={handleScan}
            disabled={!canManageWatchlist || scanning || sortedRows.length === 0}
            className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : 'Scan conviction'}
          </button>
          <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
            Ranks all watchlist symbols by technical conviction score and 5-day up probability.
          </span>
        </span>
      </header>

      <form onSubmit={handleAdd} className="mb-4 flex gap-2">
        <input
          type="text"
          value={formSymbol}
          onChange={(event) => setFormSymbol(event.target.value)}
          placeholder="Add ticker (e.g. AAPL)"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          disabled={!canManageWatchlist}
        />
        <button
          type="submit"
          disabled={!canManageWatchlist}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
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
          <p className="text-sm text-zinc-400">Loading watchlist…</p>
        ) : sortedRows.length === 0 ? (
          <p className="text-sm text-zinc-500">No symbols yet. Add your first ticker above.</p>
        ) : (
          sortedRows.map((row) => (
            <div
              key={row.id}
              className={`flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 transition ${
                activeSymbol === row.symbol
                  ? 'bg-amber-400/10 border-amber-400/40'
                  : 'bg-zinc-950/50 hover:border-amber-400/30 hover:bg-amber-400/5'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSymbol?.(row.symbol)}
                className="text-sm font-semibold text-zinc-100"
              >
                {row.symbol}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(row.id)}
                className={`text-xs font-medium transition ${confirmId === row.id ? 'text-red-400 font-semibold' : 'text-zinc-400 hover:text-red-400'}`}
                disabled={!canManageWatchlist}
              >
                {confirmId === row.id ? 'Confirm?' : 'Remove'}
              </button>
            </div>
          ))
        )}
      </div>

      {scanRows ? (
        <div className="mt-4">
          <p className="text-xs font-medium text-zinc-500">Conviction scan (ranked)</p>
          {scanRows.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No scan results — add symbols first.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {scanRows.map((row) => (
                <li key={row.symbol}>
                  <button
                    type="button"
                    onClick={() => onSelectSymbol?.(row.symbol)}
                    className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-1.5 text-left text-xs transition hover:border-amber-400/30"
                  >
                    <span className="font-semibold text-zinc-100">{row.symbol}</span>
                    <span
                      className={`font-semibold ${
                        row.conviction.score > 0 ? 'text-emerald-300' : row.conviction.score < 0 ? 'text-red-300' : 'text-zinc-400'
                      }`}
                    >
                      {row.conviction.label} ({row.conviction.score >= 0 ? '+' : ''}{row.conviction.score})
                    </span>
                    <span className="text-zinc-400">
                      {row.probUp != null ? `${(row.probUp * 100).toFixed(0)}%↑` : '--'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
