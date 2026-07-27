import express from 'express';
import { requireAuth } from '../utils/authMiddleware.js';
import { directionalForecast } from '../utils/classifier.js';
import { computeConvictionScore } from '../utils/computeSignals.js';
import { fetchYahooHistory } from '../utils/marketData.js';
import { scanLimiter } from '../utils/rateLimits.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();

router.use(requireAuth);

const SCAN_SYMBOL_CAP = 20;

router.get('/scan', scanLimiter, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('watchlists')
      .select('symbol')
      .eq('user_id', req.user.id);
    if (error) throw error;

    const symbols = [...new Set((data ?? []).map((row) => row.symbol))].slice(0, SCAN_SYMBOL_CAP);
    if (!symbols.length) return res.json({ rows: [], scannedAt: new Date().toISOString() });

    const rows = await Promise.all(symbols.map(async (symbol) => {
      try {
        const history = await fetchYahooHistory(symbol, '6mo', '1d');
        if (!history.length) return null;
        const conviction = computeConvictionScore(history);
        let directional = null;
        try {
          directional = directionalForecast(history, { horizon: 5 });
        } catch {
          directional = null;
        }
        const latest = history.at(-1);
        const previous = history.at(-2);
        return {
          symbol,
          close: latest?.close ?? null,
          changePercent: latest?.close && previous?.close
            ? ((latest.close - previous.close) / previous.close) * 100
            : null,
          conviction: { score: conviction.score, label: conviction.label },
          probUp: directional?.probUp ?? null,
          accuracy: directional?.accuracy ?? null,
        };
      } catch (err) {
        console.warn('Scan failed for', symbol, err.message);
        return null;
      }
    }));

    const ranked = rows.filter(Boolean).sort((a, b) => b.conviction.score - a.conviction.score);
    res.json({ rows: ranked, scannedAt: new Date().toISOString(), skipped: symbols.length - ranked.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('watchlists')
      .select('id, symbol, inserted_at')
      .eq('user_id', req.user.id)
      .order('inserted_at', { ascending: false });

    if (error) throw error;
    res.json({ rows: data ?? [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const symbolRaw = req.body?.symbol;
    if (typeof symbolRaw !== 'string' || !symbolRaw.trim()) {
      return res.status(400).json({ error: 'Symbol is required.' });
    }
    const symbol = symbolRaw.trim().toUpperCase();
    const { data, error } = await supabaseAdmin
      .from('watchlists')
      .insert({ symbol, user_id: req.user.id })
      .select('id, symbol, inserted_at')
      .single();

    if (error) throw error;
    res.status(201).json({ row: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Watchlist id required.' });
    }
    const { error } = await supabaseAdmin
      .from('watchlists')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
