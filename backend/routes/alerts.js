import crypto from 'crypto';
import express from 'express';
import { buildAlertContext, evaluateAlertRule, RULE_TYPES } from '../utils/alertRules.js';
import { requireAuth } from '../utils/authMiddleware.js';
import { fetchYahooHistory } from '../utils/marketData.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();

const RUN_SYMBOL_CAP = 40;

// Cron entrypoint — authenticated by CRON_SECRET, not a user token.
// Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
// and invokes with GET; POST kept for manual triggering.
const runAlerts = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization ?? '';
  const expected = `Bearer ${secret}`;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (!secret || headerBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(headerBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: alerts, error } = await supabaseAdmin
      .from('alerts')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!alerts?.length) return res.json({ evaluated: 0, triggered: 0 });

    const bySymbol = new Map();
    alerts.forEach((alert) => {
      const key = alert.symbol.toUpperCase();
      if (!bySymbol.has(key)) bySymbol.set(key, []);
      bySymbol.get(key).push(alert);
    });

    const symbols = [...bySymbol.keys()].slice(0, RUN_SYMBOL_CAP);
    let evaluated = 0;
    let triggered = 0;

    for (const symbol of symbols) {
      let context;
      try {
        const history = await fetchYahooHistory(symbol, '6mo', '1d');
        if (!history.length) continue;
        context = buildAlertContext(history);
      } catch (err) {
        console.warn('Alert run: no data for', symbol, err.message);
        continue;
      }

      for (const alert of bySymbol.get(symbol)) {
        evaluated += 1;
        const outcome = evaluateAlertRule(alert, context);
        const updates = {};
        if (outcome.newState !== undefined) updates.last_state = outcome.newState;

        if (outcome.triggered) {
          triggered += 1;
          updates.last_triggered_at = new Date().toISOString();
          const { error: eventError } = await supabaseAdmin.from('alert_events').insert({
            alert_id: alert.id,
            user_id: alert.user_id,
            symbol: alert.symbol,
            rule_type: alert.rule_type,
            message: outcome.message,
          });
          if (eventError) console.warn('alert_events insert failed:', eventError.message);
        }

        if (Object.keys(updates).length) {
          const { error: updateError } = await supabaseAdmin.from('alerts').update(updates).eq('id', alert.id);
          if (updateError) console.warn('alerts update failed:', updateError.message);
        }
      }
    }

    res.json({
      evaluated,
      triggered,
      symbols: symbols.length,
      skippedSymbols: Math.max(0, bySymbol.size - symbols.length),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

router.get('/run', runAlerts);
router.post('/run', runAlerts);

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const [alertsResult, eventsResult] = await Promise.all([
      supabaseAdmin.from('alerts').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('alert_events').select('*').eq('user_id', req.user.id).order('triggered_at', { ascending: false }).limit(30),
    ]);
    if (alertsResult.error) throw alertsResult.error;
    if (eventsResult.error) throw eventsResult.error;
    res.json({ alerts: alertsResult.data ?? [], events: eventsResult.data ?? [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { symbol, ruleType, threshold } = req.body ?? {};
    if (typeof symbol !== 'string' || !symbol.trim()) {
      return res.status(400).json({ error: 'Symbol is required.' });
    }
    if (!RULE_TYPES.includes(ruleType)) {
      return res.status(400).json({ error: `ruleType must be one of: ${RULE_TYPES.join(', ')}` });
    }
    const needsThreshold = ruleType === 'price_above' || ruleType === 'price_below';
    const parsedThreshold = threshold != null ? Number(threshold) : null;
    if (needsThreshold && (!Number.isFinite(parsedThreshold) || parsedThreshold <= 0)) {
      return res.status(400).json({ error: 'A positive numeric threshold is required for price rules.' });
    }

    const { data, error } = await supabaseAdmin
      .from('alerts')
      .insert({
        user_id: req.user.id,
        symbol: symbol.trim().toUpperCase(),
        rule_type: ruleType,
        threshold: needsThreshold ? parsedThreshold : null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ alert: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('alerts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/events/seen', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('alert_events')
      .update({ seen: true })
      .eq('user_id', req.user.id)
      .eq('seen', false);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
