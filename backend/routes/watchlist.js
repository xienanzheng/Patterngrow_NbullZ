import express from 'express';
import { requireAuth } from '../utils/authMiddleware.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();

router.use(requireAuth);

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
