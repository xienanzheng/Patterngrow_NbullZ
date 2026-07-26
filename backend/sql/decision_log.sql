-- Immutable daily rating log. One row per (symbol × date) written by the
-- daily cron. Rows are never updated — the log is an append-only audit trail.

CREATE TABLE IF NOT EXISTS decision_log (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol           text NOT NULL,
  decision_date    date NOT NULL,
  conviction_label text NOT NULL,  -- Strong Buy | Medium Buy | Buy | Neutral | Sell | Medium Sell | Strong Sell
  conviction_score numeric(6, 3),
  votes            jsonb,          -- { sma, rsi, macd, bollinger, stochastic, adx } each -1|0|1
  last_signal      text,           -- e.g. 'buy_medium' — the committed state at time of decision
  last_signal_date date,
  last_signal_price numeric(12, 4),
  recommended_action text,         -- 'BUY' | 'HOLD' | 'SELL'
  created_at       timestamptz DEFAULT now(),
  UNIQUE (symbol, decision_date)
);

CREATE INDEX IF NOT EXISTS decision_log_symbol_date ON decision_log (symbol, decision_date DESC);

ALTER TABLE decision_log ENABLE ROW LEVEL SECURITY;
-- Service role has full access; no user-facing RLS needed.
