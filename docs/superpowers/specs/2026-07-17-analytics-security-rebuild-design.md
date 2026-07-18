# Analytics Core Rebuild + Security Hardening — Design

Date: 2026-07-17
Status: Approved by user

## Context

StockDashboard (React/Vite frontend + Express backend on Vercel, Supabase auth/DB,
Google OAuth via Supabase PKCE). Review found live security holes and an analytics
core whose "forecast models" are cosmetic (all three are linear extrapolation) with
no accuracy measurement anywhere. User also reported recommendation flip-flopping:
the Technical Snapshot and price targets change materially day-to-day because they
are computed from the single latest bar against hard thresholds.

User decisions:
- Metadata write endpoints: any signed-in user (reuse watchlist auth middleware).
- Chat endpoint: require sign-in, keep server-key fallback, add per-user rate limit.
- Scope: full rebuild — security → evaluation harness → signal quality → forecasting.
- Keys stay in Vercel env vars (correct as-is; the bug is missing authorization).

## Phase 0 — Security patch

1. Extract the bearer-token middleware pattern from `backend/routes/watchlist.js`
   into a shared `requireAuth` in `backend/utils/supabaseClient.js` (or new
   `backend/utils/authMiddleware.js`). Apply to:
   - `POST /api/analytics/metadata/manual`
   - `POST /api/analytics/metadata/csv`
   - `POST /api/analytics/chat`
2. Add `express-rate-limit`:
   - `/api/analytics/chat`: 20 req/hour keyed by authenticated user id.
   - Public read endpoints (`quote`, `history`, `news`, `insights`, `metadata` GET):
     per-IP limit (60 req/min) to bound third-party API abuse.
   - Note: Vercel serverless = per-instance memory stores; acceptable for this
     scale — limits are best-effort cost bounding, not hard guarantees.
3. Remove unused `supabaseAnon` export and the `SUPABASE_ANON_KEY ?? serviceKey`
   fallback in `backend/utils/supabaseClient.js`.
4. Fix PKCE code-verifier cleanup in `frontend/src/hooks/useSupabaseAuth.js` —
   `supabase.storageKey` is not a real client property; use the configured
   `stock-dashboard-auth` key.
5. Frontend: send the Supabase access token on metadata writes and chat calls
   (`frontend/src/services/api.js`, `Dashboard.jsx`, `MiniAssistant.jsx`).

## Phase 1 — Evaluation harness

New `backend/utils/evaluation.js`:
- **Walk-forward forecast evaluation**: split history into train/test windows;
  for each fold, fit forecast model on train only, predict the test horizon,
  compare with actuals. Metrics: MAE, RMSE, MAPE, directional accuracy
  (% of horizon days where predicted direction == actual direction).
- **Strategy evaluation**: run signals+simulation on train, apply out-of-sample;
  report total return vs buy-and-hold benchmark, win rate, max drawdown, number
  of trades, all with transaction costs (default 0.1%/trade) and slippage
  (default 0.05%) added to `runTradingSimulation`.
- Endpoint: `GET /api/analytics/evaluate?symbol&range&indicator&forecastModel`
  (rate-limited, cacheable). Returns per-model/per-indicator metric table.
- Frontend: "Model Evaluation" panel in Advanced Lab tab rendering the metric
  comparison table (which indicator/model actually performs on this symbol).

## Phase 2 — Signal quality (fixes flip-flopping)

In `backend/utils/computeSignals.js`:
- **Hysteresis/confirmation for narrative labels**: qualitative states (overbought/
  oversold/trending) require the condition to hold for N=2 consecutive sessions,
  or use a 3-day EMA of the indicator value, before the label flips. The summary
  reports both the smoothed state and the raw latest value.
- **Ensemble conviction score**: weighted vote across SMA/RSI/MACD/Bollinger/
  Stochastic/ADX signals → single score in [-1, +1] with a stability-aware label
  (Strong/Moderate/Weak Buy/Sell/Neutral). Exposed in the insights payload and
  displayed on the dashboard alongside the per-indicator view.
- **Risk management in simulation**: optional stop-loss (default 5%) and
  max-position sizing in `runTradingSimulation`; parameters surfaced in the UI.

## Phase 3 — Honest forecasting

In `backend/utils/predictions.js`:
- Rename/replace models honestly:
  - `drift` (rename of `simple`): last price + mean daily return drift.
  - `ar` : autoregression on differenced log-returns (real AR(p), p≤5, OLS fit).
  - `holt`: Holt's linear exponential smoothing (level+trend, optimized α/β via
    grid search on training MSE).
- Volatility-derived confidence bands: ±z·σ·√h from historical daily-return σ,
  widening with horizon h — replaces the arbitrary ±8% price targets.
- **Directional classifier**: logistic regression (plain JS, gradient descent)
  on engineered features (lagged returns, RSI, MACD divergence, volatility,
  volume ratio) → P(up over next N days). Reported with its walk-forward
  accuracy from the Phase 1 harness next to it — never shown without its
  measured accuracy.
- Frontend: forecast panel shows confidence bands and the model's measured
  directional accuracy; model dropdown renamed (no more "ARIMA/Prophet
  Inspired" mislabels).

## Non-goals / honesty constraints

- No promise of profitable prediction; success = beating naive baseline
  (yesterday's direction / buy-and-hold) on walk-forward metrics.
- No new heavyweight ML dependencies; plain JS implementations consistent with
  the existing dependency-light codebase.
- No RLS redesign (service-role + explicit user_id filtering stays; noted as a
  future hardening item).

## Testing

- Unit tests (vitest) for: indicators edge cases, AR/Holt fitting on synthetic
  series with known parameters, walk-forward splitter correctness (no lookahead),
  simulation cost accounting, ensemble scoring, hysteresis behavior.
- Auth tests: 401 on unauthenticated metadata/chat calls; 200 with valid token.
- Manual QA: dashboard flows against local backend before push.

## Delivery

- Work happens on branch `feature/analytics-rebuild` in a dedicated git worktree.
- One commit per phase minimum so changes are trackable.
- QA review (code-reviewer agents) runs before any push.
