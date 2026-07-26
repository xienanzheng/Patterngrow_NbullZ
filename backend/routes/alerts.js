import crypto from 'crypto';
import express from 'express';
import { buildAlertContext, evaluateAlertRule, RULE_TYPES } from '../utils/alertRules.js';
import { requireAuth } from '../utils/authMiddleware.js';
import { backtestStrategy } from '../utils/backtesting.js';
import { fetchYahooHistory } from '../utils/marketData.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();

const RUN_SYMBOL_CAP = 40;

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.warn('Telegram notification failed:', err.message);
  }
}

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
          await sendTelegram(`<b>${alert.symbol} Alert</b>\n${outcome.message}`);
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

const SUMMARY_SYMBOL_CAP = 20;

function formatSignalLabel(signal) {
  const map = {
    buy_strong: 'Strong Buy', buy_medium: 'Medium Buy', buy_weak: 'Weak Buy',
    sell_strong: 'Strong Sell', sell_medium: 'Medium Sell', sell_weak: 'Weak Sell',
    hold: 'Hold',
  };
  return map[signal] ?? signal;
}

function convictionEmoji(label) {
  if (!label) return '⚪';
  const l = label.toLowerCase();
  if (l === 'strong buy') return '🟢🟢';
  if (l === 'buy') return '🟢';
  if (l === 'sell') return '🔴';
  if (l === 'strong sell') return '🔴🔴';
  return '⚪';
}

function lastSignalFromHistory(history, signals) {
  for (let i = history.length - 1; i >= 0; i--) {
    const s = signals[i];
    if (s && s.numericSignal !== 0) {
      const dateStr = history[i].date ?? history[i].t ?? null;
      const price = history[i].close;
      const action = s.numericSignal > 0 ? 'Buy' : 'Sell';
      const strength = formatSignalLabel(s.signal);
      const date = dateStr ? new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
      return `${action} (${strength}) @ $${Number(price).toFixed(2)} on ${date}`;
    }
  }
  return null;
}

const runDailySummary = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization ?? '';
  const expected = `Bearer ${secret}`;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (!secret || headerBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(headerBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: wl, error: wlError } = await supabaseAdmin.from('watchlists').select('symbol');
    if (wlError) throw wlError;

    const symbols = [...new Set((wl ?? []).map((r) => r.symbol.toUpperCase()))].slice(0, SUMMARY_SYMBOL_CAP);
    if (!symbols.length) return res.json({ sent: false, reason: 'watchlist is empty' });

    const rows = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          // 3mo gives 60+ bars — enough for conviction indicators to warm up (need 30+)
          const history = await fetchYahooHistory(symbol, '3mo', '1d');
          if (!history.length) return null;
          const context = buildAlertContext(history);
          const { signals } = backtestStrategy(history, 'sma');
          const latest = history.at(-1);
          const previous = history.at(-2);
          const changePercent =
            latest?.close && previous?.close
              ? ((latest.close - previous.close) / previous.close) * 100
              : null;
          const lastSignal = lastSignalFromHistory(history, signals);
          return {
            symbol,
            close: latest?.close ?? null,
            changePercent,
            conviction: context.conviction,
            lastSignal,
          };
        } catch {
          return null;
        }
      }),
    );

    const valid = rows.filter(Boolean).sort((a, b) => (b.conviction?.score ?? 0) - (a.conviction?.score ?? 0));
    if (!valid.length) return res.json({ sent: false, reason: 'no data returned for any symbol' });

    const date = new Date().toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York',
    });

    const lines = valid.map((r) => {
      const price = r.close != null ? `$${r.close.toFixed(2)}` : '—';
      const chg = r.changePercent != null
        ? `${r.changePercent >= 0 ? '+' : ''}${r.changePercent.toFixed(2)}%`
        : '—';
      const convLabel = r.conviction?.label ?? 'Neutral';
      const score = r.conviction?.score != null
        ? ` (${r.conviction.score >= 0 ? '+' : ''}${r.conviction.score})`
        : '';
      const dot = convictionEmoji(convLabel);
      const lastSig = r.lastSignal ? `\n    ↳ Last signal: ${r.lastSignal}` : '';
      return `${dot} <b>${r.symbol}</b>  ${price}  ${chg}\n    Rating: <b>${convLabel}</b>${score}${lastSig}`;
    });

    const text = `<b>📊 Daily Watchlist — ${date}</b>\n\n${lines.join('\n\n')}`;
    await sendTelegram(text);

    res.json({ sent: true, symbols: valid.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

router.get('/daily-summary', runDailySummary);
router.post('/daily-summary', runDailySummary);

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
