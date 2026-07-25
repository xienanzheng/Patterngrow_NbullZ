import express from 'express';
import { getUserFromRequest, supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();

router.use(async (req, res, next) => {
  const { user, error } = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: error ?? 'Unauthorized' });
  req.user = user;
  next();
});

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .select('last_symbol, last_range, selected_indicators, forecast_model, initial_capital')
      .eq('user_id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({ preferences: data ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const { lastSymbol, lastRange, selectedIndicators, forecastModel, initialCapital } = req.body ?? {};

    const payload = {
      user_id: req.user.id,
      updated_at: new Date().toISOString(),
    };

    if (typeof lastSymbol === 'string' && lastSymbol.trim()) {
      payload.last_symbol = lastSymbol.trim().toUpperCase().slice(0, 10);
    }
    if (typeof lastRange === 'string' && lastRange.trim()) {
      payload.last_range = lastRange.trim();
    }
    if (Array.isArray(selectedIndicators)) {
      payload.selected_indicators = selectedIndicators;
    }
    const VALID_MODELS = ['drift', 'ar', 'holt', 'montecarlo'];
    if (typeof forecastModel === 'string' && VALID_MODELS.includes(forecastModel.trim())) {
      payload.forecast_model = forecastModel.trim();
    }
    if (typeof initialCapital === 'number' && initialCapital > 0) {
      payload.initial_capital = initialCapital;
    }

    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select('last_symbol, last_range, selected_indicators, forecast_model, initial_capital')
      .single();

    if (error) throw error;
    res.json({ preferences: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
