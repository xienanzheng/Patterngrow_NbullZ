# Product Suite — Design (6 features + design polish)

Date: 2026-07-18 · Branch: `feature/product-suite` (stacked on `feature/analytics-rebuild`)
Status: All six features approved by user ("do all").

## F1 — Grounded assistant
`backend/utils/assistantContext.js`: `buildAssistantContext(symbol)` runs `computeSignals`
(6mo range) + metadata and formats a ~250-word data block: quote, indicator snapshot,
conviction score/votes, directional prob **with holdout accuracy**, forecast base + 80%
band, top-3 news with sentiment, sector/region/risk. Chat route accepts optional `symbol`
in body; context is appended to the system directive server-side (compact, unspoofable).
MiniAssistant gets a `symbol` prop + "Ground with <symbol> data" toggle (default on).

## F2 — Watchlist conviction scan
`GET /api/watchlist/scan` (authed): user's symbols (cap 20), parallel 6mo history →
`computeConvictionScore` + `directionalForecast`; returns rows sorted by score desc;
per-symbol failures are skipped, not fatal. WatchlistTable gains a "Scan" button and a
compact ranked results table (symbol, last close, conviction label/score, P(up) + acc).

## F3 — Forecast accountability log
Supabase table `forecast_log` (unique symbol+snapshot_date; SQL in `backend/sql/features.sql`).
Opportunistic logging: every successful `/insights` call with real (yahoo) data upserts one
snapshot/day: last_close, model, horizon, base/lower/upper (last forecast point),
conviction score/label, prob_up. No cron needed — the log accretes with use; failures warn.
`GET /api/analytics/accountability?symbol=`: joins past snapshots (target date reached)
against actual closes → per-row in-band + direction verdicts + summary hit-rates
(`backend/utils/accountability.js`, pure + tested). Overview panel renders the table when
history exists.

## F4 — Alerts
Tables `alerts` + `alert_events` (SQL file). Rule types v1: `price_above`, `price_below`
(threshold), `rsi_overbought`, `rsi_oversold` (2-session confirmed), `conviction_flip`
(label vs stored last_state). Pure evaluator `backend/utils/alertRules.js` (tested).
Routes `backend/routes/alerts.js`: authed CRUD (GET list+events, POST create, DELETE,
POST events/seen) + `POST /api/alerts/run` guarded by `CRON_SECRET` bearer (Vercel cron
sends it automatically). `vercel.json` gains a weekday cron. New "Alerts" dashboard tab:
create form, rules list, event feed with unseen highlight. Delivery is in-app v1; email/
Telegram webhooks are a later increment.

## F5 — Custom ensemble weights + ensemble strategy
`computeConvictionScore(history, weights?)` — weights normalized (non-neg, sum→1,
default = current 0.2/0.2/0.2/0.15/0.15/0.1). New `indicator === 'ensemble'` in
`backtestStrategy(points, indicator, {weights})`: per-bar vote score series; buy on
upward cross of +0.3, sell on downward cross of −0.3 (weak/medium/strong at |0.3|/|0.45|/
|0.6|). `/insights` + `/evaluate` accept `weights` (JSON query param, validated) and
`indicator=ensemble`. Sidebar "Ensemble Weights" sliders drive the live conviction and
the ensemble strategy; 'ensemble' appears in both signal-engine dropdowns.

## F6 — Positions / P&L
Table `positions` (SQL file). `backend/routes/positions.js` (authed): GET enriches rows
with live quotes → market value, unrealized P&L $/%, portfolio totals, and SPY return
over the same period (from earliest opened_at) for context; POST {symbol, shares,
costBasis, openedAt}; DELETE /:id. New "Portfolio" dashboard tab: add form, positions
table with totals row, SPY comparison line.

## Design polish (approved "ok")
tabular-nums for all numerals (index.css); forecast band rendered as translucent Area
cone (range dataKey) instead of two dashed lines; inline Google "G" SVG in AuthForm
(drop svgrepo hotlink); keyboard access for clickable metadata rows; animations respect
prefers-reduced-motion.

## Constraints
- All new tables: code degrades gracefully (warn + empty) when a table hasn't been
  created yet; `backend/sql/features.sql` is the single migration the user runs once in
  the Supabase SQL editor.
- No new heavyweight deps. Same auth middleware + rate-limit patterns as the rebuild.
- Tests: pure logic (alert rules, accountability join, ensemble signals, weight
  normalization) unit-tested; routes tested for auth gating.
