// Pure alert-rule evaluation. Callers supply the market context; this module
// decides whether a rule fires and what state to remember for next run.

import { confirmedState, computeConvictionScore } from './computeSignals.js';
import { calculateRSI, ema } from './indicators.js';

export const RULE_TYPES = ['price_above', 'price_below', 'rsi_overbought', 'rsi_oversold', 'conviction_flip'];

export function buildAlertContext(history) {
  const closes = history.map((r) => Number(r.close)).filter((v) => Number.isFinite(v) && v > 0);
  return {
    close: closes.at(-1) ?? null,
    rsiSeries: ema(calculateRSI(history), 3),
    conviction: computeConvictionScore(history),
  };
}

// Returns { triggered, message, newState } — newState persists as alerts.last_state.
// Level rules are edge-triggered against last_state: a standing condition fires
// once on entry, not one event per cron run forever.
export function evaluateAlertRule(alert, context) {
  const { close, rsiSeries, conviction } = context;
  const threshold = alert.threshold != null ? Number(alert.threshold) : null;
  const lastState = alert.last_state ?? null;

  const edge = (met, onState, offState, message) => ({
    triggered: met && lastState !== onState,
    newState: met ? onState : offState,
    message,
  });

  switch (alert.rule_type) {
    case 'price_above': {
      if (close == null || threshold == null) return { triggered: false };
      return edge(
        close > threshold, 'above', 'below',
        `${alert.symbol} closed at ${close.toFixed(2)}, above your ${threshold.toFixed(2)} level.`,
      );
    }
    case 'price_below': {
      if (close == null || threshold == null) return { triggered: false };
      return edge(
        close < threshold, 'below', 'above',
        `${alert.symbol} closed at ${close.toFixed(2)}, below your ${threshold.toFixed(2)} level.`,
      );
    }
    case 'rsi_overbought': {
      return edge(
        confirmedState(rsiSeries, (v) => v >= 70), 'overbought', 'normal',
        `${alert.symbol} RSI has held overbought (≥70) for 2+ sessions.`,
      );
    }
    case 'rsi_oversold': {
      return edge(
        confirmedState(rsiSeries, (v) => v <= 30), 'oversold', 'normal',
        `${alert.symbol} RSI has held oversold (≤30) for 2+ sessions.`,
      );
    }
    case 'conviction_flip': {
      if (!conviction || conviction.insufficientData) return { triggered: false };
      const previous = alert.last_state ?? null;
      const flipped = previous != null && previous !== conviction.label;
      return {
        triggered: flipped,
        message: `${alert.symbol} ensemble conviction flipped ${previous} → ${conviction.label} (score ${conviction.score}).`,
        newState: conviction.label,
      };
    }
    default:
      return { triggered: false };
  }
}
