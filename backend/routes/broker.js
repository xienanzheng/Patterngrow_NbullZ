import express from 'express';
import { requireAuth } from '../utils/authMiddleware.js';
import { orderLimiter } from '../utils/rateLimits.js';
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

// Lightweight connection status check — avoids the 404 + full portfolio fetch.
router.get('/connect', async (req, res) => {
  try {
    const conn = await getConnection(req.user.id);
    if (!conn) return res.json({ connected: false });
    res.json({ connected: true, isPaper: conn.is_paper });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
router.post('/order', orderLimiter, async (req, res) => {
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
