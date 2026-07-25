# Alpaca Paper Trading Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users connect their Alpaca paper trading account so they can execute trades directly from dashboard signals and track live P&L alongside model predictions.

**Architecture:** A new `broker_connections` Supabase table stores Alpaca API credentials per user (RLS-protected). A new Express route `GET/PUT/POST/DELETE /api/broker/*` proxies calls to Alpaca's paper trading REST API. A new `BrokerPanel` React component renders account summary, open positions, recent orders, and a quick paper trade form. The panel is added as a "Trading" tab in Dashboard.jsx next to Portfolio.

**Tech Stack:** Alpaca Markets REST API v2 (paper-api.alpaca.markets), Supabase (RLS), Express (Node.js ESM), React 18, Tailwind CSS, Vercel serverless.

## Global Constraints

- ESM syntax throughout (`import`/`export`, no `require`). All backend files use `.js` extension.
- Supabase admin client: imported from `backend/utils/supabaseClient.js` as `{ supabaseAdmin }`.
- Auth middleware: imported from `backend/utils/authMiddleware.js` as `{ requireAuth }`. Sets `req.user.id`.
- Frontend API calls go through `frontend/src/services/api.js` `request()` helper. Authenticated calls pass `token` option.
- All Tailwind classes use the existing design system: `zinc-*` neutrals, `amber-400` primary accent, `emerald-*` buy signals, `red-*` sell signals. No `slate-*` or `blue-*`.
- Paper-only trading for v1 — the order endpoint must reject non-paper accounts with HTTP 403.
- No placeholder text, no TBD steps.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `backend/routes/broker.js` | **Create** | All Alpaca proxy endpoints: connect, portfolio, order, disconnect |
| `backend/index.js` | **Modify** | Register `broker` router at `/api/broker` |
| `frontend/src/services/api.js` | **Modify** | Add `connectBroker`, `getBrokerPortfolio`, `placeBrokerOrder`, `disconnectBroker` |
| `frontend/src/components/BrokerPanel.jsx` | **Create** | Connect form, account summary, positions table, orders list, quick trade form |
| `frontend/src/components/Dashboard.jsx` | **Modify** | Add `{ id: 'trading', label: 'Trading' }` tab; render `<BrokerPanel>` for that tab |

**Supabase table (run manually in SQL Editor — not a code file):**
```sql
CREATE TABLE IF NOT EXISTS broker_connections (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  broker     TEXT NOT NULL DEFAULT 'alpaca',
  key_id     TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  is_paper   BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT broker_connections_user_broker_key UNIQUE (user_id, broker)
);
ALTER TABLE broker_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only access their own broker connections"
  ON broker_connections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## Task 1: Supabase table + backend broker route

**Files:**
- Create: `backend/routes/broker.js`
- Modify: `backend/index.js` (lines 1-10 imports, line ~30 route registration)

**Interfaces:**
- Consumes: `requireAuth` from `../utils/authMiddleware.js`; `supabaseAdmin` from `../utils/supabaseClient.js`
- Produces:
  - `PUT /api/broker/connect` → `{ connected: true, isPaper: boolean }`
  - `GET /api/broker/portfolio` → `{ account, positions[], orders[], isPaper }`
  - `POST /api/broker/order` → `{ order }` (Alpaca order object)
  - `DELETE /api/broker/connect` → `{ disconnected: true }`

- [ ] **Step 1: Run the Supabase SQL**

Open Supabase → SQL Editor → paste and run:
```sql
CREATE TABLE IF NOT EXISTS broker_connections (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  broker     TEXT NOT NULL DEFAULT 'alpaca',
  key_id     TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  is_paper   BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT broker_connections_user_broker_key UNIQUE (user_id, broker)
);
ALTER TABLE broker_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only access their own broker connections"
  ON broker_connections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Expected: "Success. No rows returned."

- [ ] **Step 2: Create `backend/routes/broker.js`**

```js
import express from 'express';
import { requireAuth } from '../utils/authMiddleware.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();
router.use(requireAuth);

function alpacaBase(isPaper) {
  return isPaper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
}

function alpacaHeaders(keyId, secretKey) {
  return {
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secretKey,
    'Content-Type': 'application/json',
  };
}

async function getConnection(userId) {
  const { data } = await supabaseAdmin
    .from('broker_connections')
    .select('key_id, secret_key, is_paper, broker')
    .eq('user_id', userId)
    .eq('broker', 'alpaca')
    .single();
  return data ?? null;
}

// Connect or update Alpaca credentials
router.put('/connect', async (req, res) => {
  const { keyId, secretKey, isPaper = true } = req.body ?? {};
  if (!keyId?.trim() || !secretKey?.trim()) {
    return res.status(400).json({ error: 'keyId and secretKey are required.' });
  }

  // Verify credentials before saving — fail fast with a clear message.
  const base = alpacaBase(isPaper);
  let verifyRes;
  try {
    verifyRes = await fetch(`${base}/v2/account`, {
      headers: alpacaHeaders(keyId.trim(), secretKey.trim()),
    });
  } catch {
    return res.status(400).json({ error: 'Could not reach Alpaca API. Check your network.' });
  }

  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => ({}));
    return res.status(400).json({ error: body.message ?? 'Invalid Alpaca credentials.' });
  }

  const { error } = await supabaseAdmin.from('broker_connections').upsert(
    { user_id: req.user.id, broker: 'alpaca', key_id: keyId.trim(), secret_key: secretKey.trim(), is_paper: Boolean(isPaper) },
    { onConflict: 'user_id,broker' },
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ connected: true, isPaper: Boolean(isPaper) });
});

// Fetch Alpaca account, positions, and recent orders in parallel
router.get('/portfolio', async (req, res) => {
  const conn = await getConnection(req.user.id);
  if (!conn) return res.status(404).json({ error: 'No Alpaca account connected.' });

  const base = alpacaBase(conn.is_paper);
  const hdrs = alpacaHeaders(conn.key_id, conn.secret_key);

  try {
    const [accountRes, positionsRes, ordersRes] = await Promise.all([
      fetch(`${base}/v2/account`, { headers: hdrs }),
      fetch(`${base}/v2/positions`, { headers: hdrs }),
      fetch(`${base}/v2/orders?status=all&limit=25&direction=desc`, { headers: hdrs }),
    ]);

    if (!accountRes.ok) {
      const body = await accountRes.json().catch(() => ({}));
      return res.status(400).json({ error: body.message ?? 'Alpaca account fetch failed.' });
    }

    const [account, positions, orders] = await Promise.all([
      accountRes.json(),
      positionsRes.json(),
      ordersRes.json(),
    ]);

    res.json({
      account,
      positions: Array.isArray(positions) ? positions : [],
      orders: Array.isArray(orders) ? orders : [],
      isPaper: conn.is_paper,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Place a paper market order
router.post('/order', async (req, res) => {
  const { symbol, side, qty } = req.body ?? {};
  if (!symbol?.trim()) return res.status(400).json({ error: 'symbol is required.' });
  if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: "side must be 'buy' or 'sell'." });
  const parsedQty = Number(qty);
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    return res.status(400).json({ error: 'qty must be a positive number.' });
  }

  const conn = await getConnection(req.user.id);
  if (!conn) return res.status(404).json({ error: 'No Alpaca account connected.' });
  if (!conn.is_paper) return res.status(403).json({ error: 'Live trading is not enabled in this version. Use a paper account.' });

  const base = alpacaBase(conn.is_paper);
  const hdrs = alpacaHeaders(conn.key_id, conn.secret_key);

  try {
    const orderRes = await fetch(`${base}/v2/orders`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        symbol: symbol.trim().toUpperCase(),
        qty: String(parsedQty),
        side,
        type: 'market',
        time_in_force: 'day',
      }),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) return res.status(400).json({ error: order.message ?? 'Order rejected by Alpaca.' });
    res.status(201).json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect (delete stored credentials)
router.delete('/connect', async (req, res) => {
  await supabaseAdmin
    .from('broker_connections')
    .delete()
    .eq('user_id', req.user.id)
    .eq('broker', 'alpaca');
  res.json({ disconnected: true });
});

export default router;
```

- [ ] **Step 3: Register the router in `backend/index.js`**

Add after the existing imports (around line 7):
```js
import brokerRouter from './routes/broker.js';
```

Add after the existing `app.use('/api/user', preferencesRouter);` line:
```js
app.use('/api/broker', brokerRouter);
```

- [ ] **Step 4: Smoke test the route**

Start the backend: `cd backend && node index.js` (or `npm run dev`)

```bash
# Should return 401 (no auth token)
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/broker/portfolio
# Expected: 401

# Health check still works
curl http://localhost:4000/api/health
# Expected: {"status":"ok","service":"stock-dashboard-api"}
```

- [ ] **Step 5: Commit**

```bash
git add backend/routes/broker.js backend/index.js
git commit -m "feat: add Alpaca broker route — connect, portfolio, order, disconnect"
```

---

## Task 2: Frontend API functions

**Files:**
- Modify: `frontend/src/services/api.js` (append to end of file)

**Interfaces:**
- Consumes: existing `request()` helper already in api.js
- Produces:
  - `connectBroker({ keyId, secretKey, isPaper }, token)` → `Promise<{ connected, isPaper }>`
  - `getBrokerPortfolio(token)` → `Promise<{ account, positions[], orders[], isPaper }>`
  - `placeBrokerOrder({ symbol, side, qty }, token)` → `Promise<{ order }>`
  - `disconnectBroker(token)` → `Promise<{ disconnected }>`

- [ ] **Step 1: Append the four functions to `frontend/src/services/api.js`**

```js
export function connectBroker({ keyId, secretKey, isPaper }, token) {
  return request('/api/broker/connect', { method: 'PUT', body: { keyId, secretKey, isPaper }, token });
}

export function getBrokerPortfolio(token) {
  return request('/api/broker/portfolio', { token });
}

export function placeBrokerOrder({ symbol, side, qty }, token) {
  return request('/api/broker/order', { method: 'POST', body: { symbol, side, qty }, token });
}

export function disconnectBroker(token) {
  return request('/api/broker/connect', { method: 'DELETE', token });
}
```

- [ ] **Step 2: Verify the imports resolve**

```bash
cd frontend && node --input-type=module <<'EOF'
import { connectBroker, getBrokerPortfolio, placeBrokerOrder, disconnectBroker } from './src/services/api.js';
console.log(typeof connectBroker, typeof getBrokerPortfolio, typeof placeBrokerOrder, typeof disconnectBroker);
EOF
# Expected: function function function function
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.js
git commit -m "feat: add broker API client functions (connectBroker, getBrokerPortfolio, placeBrokerOrder, disconnectBroker)"
```

---

## Task 3: BrokerPanel component

**Files:**
- Create: `frontend/src/components/BrokerPanel.jsx`

**Interfaces:**
- Consumes: `connectBroker`, `getBrokerPortfolio`, `placeBrokerOrder`, `disconnectBroker` from `../services/api`
- Props: `{ accessToken: string | null, defaultSymbol: string }`
- Renders: connect form (when not connected) OR account summary + positions table + orders list + quick trade form (when connected)

- [ ] **Step 1: Create `frontend/src/components/BrokerPanel.jsx`**

```jsx
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
                onChange={(e) => setConnectForm((prev) => ({ ...prev, isPaper: e.target.checked }))}
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
```

- [ ] **Step 2: Verify the component renders without errors**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|Error|warning" | head -20
# Expected: no errors mentioning BrokerPanel.jsx
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/BrokerPanel.jsx
git commit -m "feat: add BrokerPanel component — connect form, account summary, positions, orders, quick trade"
```

---

## Task 4: Wire BrokerPanel into Dashboard

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx`

**Interfaces:**
- Consumes: `BrokerPanel` from `./BrokerPanel`
- Adds `{ id: 'trading', label: 'Trading' }` to TABS after `{ id: 'portfolio', label: 'Portfolio' }`
- Renders `<BrokerPanel accessToken={session?.access_token} defaultSymbol={symbol} />` when `activeTab === 'trading'`

- [ ] **Step 1: Add the import**

At the top of `frontend/src/components/Dashboard.jsx`, find the existing imports:
```js
import PortfolioPanel from './PortfolioPanel';
```

Add after it:
```js
import BrokerPanel from './BrokerPanel';
```

- [ ] **Step 2: Add the tab to TABS**

Find:
```js
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'assistant', label: 'AI Assistant' },
```

Replace with:
```js
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'trading', label: 'Trading' },
  { id: 'assistant', label: 'AI Assistant' },
```

- [ ] **Step 3: Add the tab render block**

Find:
```jsx
        {activeTab === 'portfolio' ? <PortfolioPanel accessToken={session?.access_token} /> : null}
```

Add after it:
```jsx
        {activeTab === 'trading' ? <BrokerPanel accessToken={session?.access_token} defaultSymbol={symbol} /> : null}
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd frontend && npm run build 2>&1 | grep -E "^.*error" | head -10
# Expected: no output (clean build)
```

- [ ] **Step 5: Manual end-to-end test**

```
1. Start: cd frontend && npm run dev  (in one terminal)
          cd backend && node index.js  (in another terminal)
2. Open http://localhost:5173
3. Sign in with Google
4. Click "Trading" tab
5. You should see the connect form with Alpaca setup instructions
6. Get a free Alpaca paper account at app.alpaca.markets
7. Generate paper API keys, enter them in the form, click Connect
8. You should see: account summary (portfolio value, buying power, cash, today's P&L)
9. In Quick Paper Trade: enter "AAPL", qty "1", Buy — click "Buy at Market"
10. You should see: "Order submitted: BUY 1 AAPL @ market (pending_new)"
11. After ~2 seconds the panel refreshes — the order should appear in Recent Orders
12. Click "Disconnect" — you should return to the connect form
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Dashboard.jsx
git commit -m "feat: add Trading tab wired to BrokerPanel"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ broker_connections table (Task 1 Step 1)
- ✅ PUT /api/broker/connect with credential verification (Task 1 Step 2)
- ✅ GET /api/broker/portfolio (Task 1 Step 2)
- ✅ POST /api/broker/order, paper-only guard (Task 1 Step 2)
- ✅ DELETE /api/broker/connect (Task 1 Step 2)
- ✅ Route registered in index.js (Task 1 Step 3)
- ✅ All four frontend API functions (Task 2)
- ✅ Connect form with step-by-step key instructions (Task 3)
- ✅ Account summary (portfolio_value, buying_power, cash, today's P&L) (Task 3)
- ✅ Open positions table (Task 3)
- ✅ Recent orders list with status badges (Task 3)
- ✅ Quick trade form pre-filled with active symbol (Task 3)
- ✅ Trading tab in Dashboard (Task 4)
- ✅ Disconnect flow (Task 3)

**2. Placeholder scan:** No TBD, no "add error handling", all code blocks complete.

**3. Type consistency:**
- `connectBroker({ keyId, secretKey, isPaper }, token)` defined in Task 2, consumed in Task 3 — match ✅
- `getBrokerPortfolio(token)` → `{ account, positions, orders, isPaper }` defined in Task 1, consumed in Task 3 — match ✅
- `placeBrokerOrder({ symbol, side, qty }, token)` → `{ order }` defined in Tasks 1+2, consumed in Task 3 — match ✅
- `disconnectBroker(token)` defined in Task 2, consumed in Task 3 — match ✅

---

## What comes next (not in this plan)

- **Polygon.io data source swap** — replace Yahoo Finance scraping with a commercial data provider before launching publicly. $29/mo individual plan is sufficient for 5 users, $199/mo for commercial use.
- **Stripe billing** — add subscription tiers (free: 1 ticker, $10/mo: unlimited + broker + alerts).
- **Signal → trade attribution** — log which dashboard signal prompted each trade so the accountability table can track "did this signal make money when I actually traded it?"
- **IBKR Client Portal API** — premium tier for users who already use IBKR, via their OAuth flow.
- **Email alerts** — fire a Resend/SendGrid email when an alert triggers so users don't have to be on-platform to know.
