-- Persistent signal log for daily watchlist summary.
-- Signals are written on first observation and never overwritten (ON CONFLICT DO NOTHING),
-- so the "last signal" shown in Telegram is stable even as the live backtest window slides.

CREATE TABLE IF NOT EXISTS watchlist_signals (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol      text NOT NULL,
  signal_date date NOT NULL,
  signal      text NOT NULL,   -- buy_strong | buy_medium | buy_weak | sell_strong | sell_medium | sell_weak
  price       numeric(12, 4),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (symbol, signal_date)
);

CREATE INDEX IF NOT EXISTS watchlist_signals_symbol_date ON watchlist_signals (symbol, signal_date DESC);

ALTER TABLE watchlist_signals ENABLE ROW LEVEL SECURITY;

-- Service role (backend) has full access; no user-facing RLS needed.
