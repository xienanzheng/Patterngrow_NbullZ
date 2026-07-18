import express from 'express';
import { requireAuth } from '../utils/authMiddleware.js';
import { fetchQuote, fetchYahooHistory } from '../utils/marketData.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();

router.use(requireAuth);

const QUOTE_CAP = 30;

function pickSpyRange(earliestOpenedAt) {
  if (!earliestOpenedAt) return '1y';
  const ageDays = (Date.now() - new Date(earliestOpenedAt).getTime()) / 86_400_000;
  if (ageDays <= 35) return '1mo';
  if (ageDays <= 100) return '3mo';
  if (ageDays <= 200) return '6mo';
  if (ageDays <= 400) return '1y';
  if (ageDays <= 800) return '2y';
  return '5y';
}

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('positions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const positions = data ?? [];
    const symbols = [...new Set(positions.map((p) => p.symbol))].slice(0, QUOTE_CAP);
    const quotes = {};
    await Promise.all(symbols.map(async (symbol) => {
      try {
        quotes[symbol] = await fetchQuote(symbol);
      } catch (err) {
        console.warn('Quote unavailable for position', symbol, err.message);
        quotes[symbol] = null;
      }
    }));

    let totalCost = 0;
    let totalValue = 0;
    const rows = positions.map((p) => {
      const shares = Number(p.shares);
      const costBasis = Number(p.cost_basis);
      const price = quotes[p.symbol]?.regularMarketPrice ?? null;
      const cost = shares * costBasis;
      const value = price != null ? shares * price : null;
      totalCost += cost;
      if (value != null) totalValue += value;
      return {
        id: p.id,
        symbol: p.symbol,
        shares,
        costBasis,
        openedAt: p.opened_at,
        price,
        cost,
        value,
        pnl: value != null ? value - cost : null,
        pnlPct: value != null && cost > 0 ? ((value - cost) / cost) * 100 : null,
      };
    });

    // SPY over the same holding window, for context.
    let spyReturnPct = null;
    if (positions.length) {
      try {
        const earliest = positions.reduce((min, p) => (p.opened_at && (!min || p.opened_at < min) ? p.opened_at : min), null);
        const history = await fetchYahooHistory('SPY', pickSpyRange(earliest), '1d');
        const valid = history.filter((r) => Number.isFinite(Number(r.close)));
        const start = earliest
          ? valid.find((r) => r.date.slice(0, 10) >= earliest) ?? valid[0]
          : valid[0];
        const end = valid.at(-1);
        if (start?.close && end?.close) {
          spyReturnPct = ((end.close - start.close) / start.close) * 100;
        }
      } catch (err) {
        console.warn('SPY benchmark unavailable:', err.message);
      }
    }

    res.json({
      rows,
      summary: {
        totalCost,
        totalValue: rows.some((r) => r.value != null) ? totalValue : null,
        totalPnl: rows.some((r) => r.value != null) ? totalValue - totalCost : null,
        totalPnlPct: totalCost > 0 && rows.some((r) => r.value != null) ? ((totalValue - totalCost) / totalCost) * 100 : null,
        spyReturnPct,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { symbol, shares, costBasis, openedAt } = req.body ?? {};
    if (typeof symbol !== 'string' || !symbol.trim()) {
      return res.status(400).json({ error: 'Symbol is required.' });
    }
    const parsedShares = Number(shares);
    const parsedCost = Number(costBasis);
    if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
      return res.status(400).json({ error: 'Shares must be a positive number.' });
    }
    if (!Number.isFinite(parsedCost) || parsedCost <= 0) {
      return res.status(400).json({ error: 'Cost basis must be a positive price per share.' });
    }

    const row = {
      user_id: req.user.id,
      symbol: symbol.trim().toUpperCase(),
      shares: parsedShares,
      cost_basis: parsedCost,
    };
    if (openedAt && /^\d{4}-\d{2}-\d{2}$/.test(openedAt)) row.opened_at = openedAt;

    const { data, error } = await supabaseAdmin.from('positions').insert(row).select().single();
    if (error) throw error;
    res.status(201).json({ position: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('positions')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
