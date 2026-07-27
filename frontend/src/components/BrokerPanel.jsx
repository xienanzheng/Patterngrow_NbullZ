import { useCallback, useEffect, useState } from 'react';
import { connectBroker, disconnectBroker, getBrokerPortfolio, placeBrokerOrder } from '../services/api';

const money = (v) =>
  v == null ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) =>
  v == null ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
const pnlColor = (v) =>
  v == null ? 'text-zinc-400' : Number(v) >= 0 ? 'text-emerald-300' : 'text-red-300';

export default function BrokerPanel({ accessToken, defaultSymbol }) {
  const [connected, setConnected] = useState(false);
  const [isPaper, setIsPaper] = useState(true);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [connectForm, setConnectForm] = useState({ keyId: '', secretKey: '', isPaper: true });
  const [orderForm, setOrderForm] = useState({ symbol: defaultSymbol ?? '', qty: '1', side: 'buy' });
  const [orderStatus, setOrderStatus] = useState('');
  const [placing, setPlacing] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await getBrokerPortfolio(accessToken);
      setPortfolio(data);
      setConnected(true);
      setIsPaper(data.isPaper);
    } catch (err) {
      if (err.message === 'No Alpaca account connected.') {
        setConnected(false);
        setPortfolio(null);
      } else {
        setStatus(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { refresh(); }, [refresh]);

  // Keep the quick-trade symbol in sync when the active chart symbol changes.
  useEffect(() => {
    setOrderForm((prev) => ({ ...prev, symbol: defaultSymbol ?? '' }));
  }, [defaultSymbol]);

  const handleConnect = async (e) => {
    e.preventDefault();
    setStatus('');
    if (!connectForm.keyId.trim() || !connectForm.secretKey.trim()) {
      setStatus('Both Key ID and Secret Key are required.');
      return;
    }
    try {
      await connectBroker(
        { keyId: connectForm.keyId.trim(), secretKey: connectForm.secretKey.trim(), isPaper: connectForm.isPaper },
        accessToken,
      );
      setConnectForm({ keyId: '', secretKey: '', isPaper: true });
      await refresh();
    } catch (err) {
      setStatus(err.message);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectBroker(accessToken);
      setConnected(false);
      setPortfolio(null);
    } catch (err) {
      setStatus(err.message);
    }
  };

  const handleOrder = async (e) => {
    e.preventDefault();
    setOrderStatus('');
    const qty = Number(orderForm.qty);
    if (!orderForm.symbol.trim()) { setOrderStatus('Symbol is required.'); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setOrderStatus('Qty must be a positive number.'); return; }
    setPlacing(true);
    try {
      const { order } = await placeBrokerOrder(
        { symbol: orderForm.symbol, side: orderForm.side, qty },
        accessToken,
      );
      setOrderStatus(
        `Order submitted: ${order.side?.toUpperCase()} ${order.qty} ${order.symbol} @ market (${order.status}).`,
      );
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      setOrderStatus(err.message);
    } finally {
      setPlacing(false);
    }
  };

  if (!accessToken) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-sm text-zinc-400">Sign in to connect your broker.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-sm text-zinc-400">Loading broker connection…</p>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h2 className="text-lg font-semibold text-white">Connect Alpaca Paper Trading</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Link your Alpaca paper account to execute trades directly from dashboard signals. Paper trading is free —
            no real money involved.
          </p>
          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-950/60 px-4 py-3 text-xs text-zinc-400 space-y-1">
            <p className="font-semibold text-zinc-300">How to get your paper trading keys:</p>
            <ol className="mt-1 list-decimal list-inside space-y-0.5">
              <li>Go to <span className="text-zinc-200">app.alpaca.markets</span> and sign up (free)</li>
              <li>Switch to <span className="text-zinc-200">Paper Trading</span> in the top navigation</li>
              <li>Open the right-side panel → <span className="text-zinc-200">Your API Keys</span> → Generate New Key</li>
              <li>Copy the Key ID and Secret Key into the form below</li>
            </ol>
          </div>
          <form onSubmit={handleConnect} className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-zinc-500">
              Key ID
              <input
                type="text"
                value={connectForm.keyId}
                onChange={(e) => setConnectForm((prev) => ({ ...prev, keyId: e.target.value }))}
                placeholder="PKXXXXXXXXXXXXXXXX"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
              />
            </label>
            <label className="text-xs font-medium text-zinc-500">
              Secret Key
              <input
                type="password"
                value={connectForm.secretKey}
                onChange={(e) => setConnectForm((prev) => ({ ...prev, secretKey: e.target.value }))}
                placeholder="••••••••••••••••••••••••••••••••••••••••"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
              <input
                type="checkbox"
                checked={connectForm.isPaper}
                onChange={(e) => {
                  const nextIsPaper = e.target.checked;
                  if (!nextIsPaper) {
                    const confirmed = window.confirm(
                      'Warning: You are about to connect a LIVE trading account with real money. Paper trading mode will be disabled. Are you sure?',
                    );
                    if (!confirmed) return;
                  }
                  setConnectForm((prev) => ({ ...prev, isPaper: nextIsPaper }));
                }}
                className="h-4 w-4 accent-amber-400"
              />
              Paper trading account (recommended for testing)
            </label>
            <button
              type="submit"
              className="md:col-start-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-300"
            >
              Connect
            </button>
          </form>
          {status ? <p className="mt-3 text-sm text-red-400">{status}</p> : null}
        </section>
      </div>
    );
  }

  const account = portfolio?.account;
  const positions = portfolio?.positions ?? [];
  const orders = portfolio?.orders ?? [];
  const todayPnl = account?.equity != null && account?.last_equity != null
    ? Number(account.equity) - Number(account.last_equity)
    : null;

  return (
    <div className="space-y-6">
      {/* Account summary */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Alpaca</h2>
            {isPaper ? (
              <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-300">Paper</span>
            ) : (
              <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">Live</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            className="text-xs text-zinc-500 transition hover:text-red-400"
          >
            Disconnect
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-zinc-500">Portfolio Value</p>
            <p className="mt-1 text-xl font-semibold text-white">{money(account?.portfolio_value)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">Buying Power</p>
            <p className="mt-1 text-xl font-semibold text-white">{money(account?.buying_power)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">Cash</p>
            <p className="mt-1 text-xl font-semibold text-white">{money(account?.cash)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">Today&apos;s P&amp;L</p>
            <p className={`mt-1 text-xl font-semibold ${pnlColor(todayPnl)}`}>{money(todayPnl)}</p>
          </div>
        </div>
        {status ? <p className="mt-3 text-sm text-red-400">{status}</p> : null}
      </section>

      {/* Quick paper trade */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h3 className="text-sm font-semibold text-zinc-200">Quick Paper Trade</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Submit a market order to your paper account. Fills at the next available price.
        </p>
        <form onSubmit={handleOrder} className="mt-3 grid gap-3 md:grid-cols-4">
          <input
            type="text"
            value={orderForm.symbol}
            onChange={(e) => setOrderForm((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
            placeholder="Symbol"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          />
          <input
            type="number"
            min="0.001"
            step="any"
            value={orderForm.qty}
            onChange={(e) => setOrderForm((prev) => ({ ...prev, qty: e.target.value }))}
            placeholder="Shares"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          />
          <select
            value={orderForm.side}
            onChange={(e) => setOrderForm((prev) => ({ ...prev, side: e.target.value }))}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <button
            type="submit"
            disabled={placing}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              orderForm.side === 'buy'
                ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                : 'bg-red-500 text-white hover:bg-red-400'
            }`}
          >
            {placing ? 'Placing…' : orderForm.side === 'buy' ? 'Buy at Market' : 'Sell at Market'}
          </button>
        </form>
        {orderStatus ? <p className="mt-2 text-xs text-amber-300">{orderStatus}</p> : null}
      </section>

      {/* Open positions */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h3 className="text-sm font-semibold text-zinc-200">
          Open Positions{positions.length > 0 ? ` (${positions.length})` : ''}
        </h3>
        {positions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No open positions. Use Quick Paper Trade above to open one.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-800 text-sm text-zinc-200">
              <thead className="bg-zinc-900/60 text-xs text-zinc-400">
                <tr>
                  <th className="px-4 py-2 text-left">Symbol</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Avg Cost</th>
                  <th className="px-4 py-2 text-right">Current Price</th>
                  <th className="px-4 py-2 text-right">Market Value</th>
                  <th className="px-4 py-2 text-right">Unrealized P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {positions.map((pos) => (
                  <tr key={pos.asset_id ?? pos.symbol}>
                    <td className="px-4 py-2 font-semibold text-white">{pos.symbol}</td>
                    <td className="px-4 py-2 text-right">{pos.qty}</td>
                    <td className="px-4 py-2 text-right">{money(pos.avg_entry_price)}</td>
                    <td className="px-4 py-2 text-right">{money(pos.current_price)}</td>
                    <td className="px-4 py-2 text-right">{money(pos.market_value)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${pnlColor(pos.unrealized_pl)}`}>
                      {money(pos.unrealized_pl)}
                      {pos.unrealized_plpc != null
                        ? ` (${pct(Number(pos.unrealized_plpc) * 100)})`
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent orders */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h3 className="text-sm font-semibold text-zinc-200">Recent Orders</h3>
        {orders.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No recent orders.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className={`font-semibold ${order.side === 'buy' ? 'text-emerald-300' : 'text-red-300'}`}>
                    {order.side?.toUpperCase()}
                  </span>
                  <span className="text-white">{order.qty} {order.symbol}</span>
                  <span className="text-zinc-400 text-xs">{order.type} · {order.time_in_force}</span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    order.status === 'filled'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : order.status === 'canceled'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-zinc-700 text-zinc-300'
                  }`}
                >
                  {order.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
