# PatternGrow

Modernised full-stack workspace for the StockDashboard project. The legacy Streamlit app has been replaced with a React + Vite frontend and a Node.js + Express analytics API that integrate with Supabase for authentication, database, and storage. The repository matches Vercel's hybrid deployment model so the same codebase can be deployed locally or on Vercel with minimal configuration changes.

## Research workspace

Production: **https://trading.night-zone.com/research**. Cloudflare provides domain DNS; the frontend and API deploy through Vercel.

The public `/research` workspace combines historical prices, a volume histogram with a preceding-20-bar average, relative volume and volume percentile, approximate turnover, OBV change, historical returns, realized daily volatility, ATR and drawdown. CSV exports use the same normalized observations as the calculations. Source attribution, missing fields, timestamps, session-date precision and limitations are visible in the data-quality panel. Fundamentals explicitly identify chart-only fallback data.

The terminal workspace adds a fixed six-fund market overview, indexed benchmark comparisons, rolling correlation, historical beta and tracking error. Comparisons align exchange session dates and never bridge an intervening missing or unmatched observation when calculating daily return pairs. At least 20 pairs are required for relationship statistics. All returns are native-currency price returns; fund proxies are not spot markets or total-return indexes.

Use `/` to focus symbol search. Save up to 12 research views in the current browser, or copy a URL that preserves the symbol, benchmark, period and active view. JSON research/comparison snapshots retain the actual returned data, source metadata, definitions and retrieval times; CSV exports retain currency and session-date provenance. Saved views are navigation presets, not frozen datasets or synced account data.

Provider outages return an unavailable state; generated sample prices are never silently substituted. Yahoo and Twelve Data failures are isolated, with `MARKET_DATA_PROVIDER` selecting the primary historical source. Public research runs without Supabase; authentication and account features remain unavailable until configured.

Use **Node.js 24 LTS** (`.nvmrc`), or a Node version accepted by `backend/package.json`. The upgraded test runner requires Node 22.12+ on its supported release lines.

```sh
# Terminal 1
cd backend
npm ci
npm run dev

# Terminal 2, from the repository root
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173/research**. Vite proxies `/api` to port 4000. Optional configuration templates are [backend/.env.example](backend/.env.example) and [frontend/.env.example](frontend/.env.example); copy them to `.env` in the corresponding directory when needed. Provider keys belong only on the backend.

The research read endpoints are `GET /api/analytics/research?symbol=AAPL&range=1y&interval=1d`, `GET /api/analytics/providers`, `GET /api/analytics/comparison?symbol=AAPL&benchmark=SPY&range=1y`, and `GET /api/analytics/overview`. Research responses use a bounded in-process 60-second cache with simultaneous-request deduplication; this is not a distributed provider quota system. Research contains at most 5,000 bars; comparison is daily-only, up to two years and 520 bars per input, with truncation disclosed. Overview is a fixed universe with at most three concurrent history fetches and an independent 60-second summary cache.

A local **read-only MCP server** provides historical observations, descriptive analytics, comparisons, market overview and provider configuration through the same service layer. See [MCP setup](backend/mcp/README.md) and the [product review, provider comparison and next milestones](docs/market-research-roadmap.md). No remote MCP endpoint or global client configuration is installed automatically.

## Project Layout

```
stock_dashboard/
├── frontend/              # React (Vite + Tailwind) SPA
│   ├── src/
│   │   ├── components/    # Auth, dashboard, watchlist, chart views
│   │   ├── hooks/         # Supabase auth, PKCE helpers
│   │   ├── lib/           # Shared client-only utilities
│   │   └── services/      # REST client for /api endpoints
│   └── package.json
├── backend/               # Node.js + Express server
│   ├── routes/            # /api/analytics and /api/watchlist routers
│   ├── utils/             # Supabase admin client & analytics helpers
│   ├── index.js           # Express entry (exported for Vercel)
│   └── package.json
├── vercel.json            # Combined frontend + backend deployment config
└── .env.example           # Shared environment variable template
```

## Getting Started (local development)

### 1. Environment variables

For account features, copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`, then fill in the corresponding values:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=anon-public-key
SUPABASE_SERVICE_KEY=service-role-key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=anon-public-key
VITE_API_BASE_URL=http://localhost:4000
ALLOWED_ORIGINS=http://localhost:5173
```

- `SUPABASE_SERVICE_KEY` is required only by the backend for authenticated account features.
- `VITE_*` variables are consumed by the Vite dev server.
- Optional keys: `ALPHA_VANTAGE_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` if you want the backend to call external news feeds or LLM providers. Add them to `backend/.env` (server only). If you proxy LLM calls back to the browser, expose the proxy URL via `VITE_OPENAI_PROXY_URL`.

### 2. Install dependencies

```
cd frontend
npm install
cd ../backend
npm install
```

### 3. Run the stack locally

```
# Backend (port 4000)
cd backend
npm run dev

# Frontend (port 5173)
cd ../frontend
npm run dev
```

The React app proxies API requests to `http://localhost:4000/api/*` by default (configure via `VITE_API_BASE_URL`). Login with Supabase Google OAuth; the frontend forwards the Supabase session token to the backend for authenticated watchlist requests.

## Supabase configuration checklist

1. **Authentication** – enable Google OAuth and add local/Vercel redirect URLs.
2. **Watchlist table** – use the SQL below and keep RLS enabled:

   ```sql
   create table public.watchlists (
     id uuid default gen_random_uuid() primary key,
     user_id uuid not null references auth.users(id) on delete cascade,
     symbol text not null,
     inserted_at timestamptz default timezone('utc', now())
   );

   create index watchlists_user_symbol_idx on public.watchlists (user_id, symbol);

   alter table public.watchlists enable row level security;

   create policy "Users read their watchlist"
     on public.watchlists for select using (auth.uid() = user_id);

   create policy "Users manage their watchlist"
     on public.watchlists for insert with check (auth.uid() = user_id);

   create policy "Users remove their watchlist items"
     on public.watchlists for delete using (auth.uid() = user_id);
   ```

3. **Service key** – store the service-role key in Vercel / backend `.env` only.

## Deployment on Vercel

1. Connect the repository to Vercel.
2. Set the following environment variables in the project settings for all environments (Preview & Production):

   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY` (Server only – mark as encrypted)
- `ALPHA_VANTAGE_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` (optional)

3. Vercel detects `vercel.json` and builds the frontend via `frontend/package.json`. The backend is exposed as serverless functions mounted under `/api/*`.
4. Add OAuth redirect URLs to Supabase for the deployed domain (e.g., `https://your-vercel-app.vercel.app/*`).

## API security

- `POST /api/analytics/chat` requires a verified Supabase bearer token. Shared metadata writes (`metadata/manual`, `metadata/csv`) additionally require a user ID in `METADATA_ADMIN_USER_IDS` or a trusted `app_metadata.role=admin`; user-editable `user_metadata` never authorizes these writes.
- Assistant requests are limited to 8,000 prompt characters, 800 output tokens and a 25-second provider deadline. Summaries describe evidence and uncertainty rather than giving buy/sell instructions. Provider errors are sanitized.
- All `/api/analytics/*` routes are rate-limited to 60 requests/min per IP; `/chat` is additionally capped at 20 requests/hour per user (limits are per serverless instance — best-effort cost bounds).
- Read endpoints (`quote`, `history`, `news`, `insights`, `metadata` GET, `evaluate`) stay public.

## Analytics & forecasting

- **Forecast models** (`backend/utils/predictions.js`): `drift` (mean log-return extrapolation), `ar` (autoregression on log returns, OLS-fit), `holt` (Holt linear exponential smoothing, grid-searched α/β). Legacy names `simple`/`arima`/`prophet` map onto these for backward compatibility. Every forecast point carries an 80% confidence band derived from historical volatility (`value·exp(±1.2816·σ·√h)`), which replaces the old fixed ±8% "targets".
- **Walk-forward evaluation** (`backend/utils/evaluation.js`, `GET /api/analytics/evaluate?symbol=&range=&indicator=&horizon=&folds=`): rolling-origin out-of-sample folds reporting MAE/RMSE/MAPE/directional accuracy per model plus a naive baseline, and out-of-sample strategy return vs. buy-and-hold (with 0.1% transaction costs + 0.05% slippage) including win rate and max drawdown. Surfaced in the Advanced Lab tab ("Evaluate Models").
- **Directional classifier** (`backend/utils/classifier.js`): plain-JS logistic regression over lagged returns, RSI, MACD divergence, volatility, and volume ratio → probability the price is higher in 5 days. Its embargoed-holdout accuracy is always reported next to the probability — treat sub-55% accuracy as noise.
- **Ensemble classification** (`backend/utils/computeSignals.js`): a weighted vote across SMA/RSI/MACD/Bollinger/Stochastic/ADX, calculated independently from the supplied history and weights. Earlier labels are not inputs. Two-session confirmation applies to selected narrative conditions and RSI alerts, not to this classification. Version `ensemble-conviction.v2` normalizes omitted and explicit default weights identically and uses the same score, cleaned to 12 decimal places, for thresholds and display. The response includes measurements, votes, normalized weights and contributions.
- **Simulation realism** (`backend/utils/backtesting.js`): transaction costs, slippage, and optional stop-loss are modeled; the insights payload reports trade count and total costs paid.
- Honest-by-design: none of this predicts the market reliably; the point of the evaluation harness is that every number ships with its out-of-sample track record instead of an in-sample illusion.

## Product suite (setup required)

The alerts, portfolio, and accountability features need two one-time steps:

1. **Supabase tables** — run `backend/sql/features.sql` once in the Supabase SQL editor
   (creates `forecast_log`, `alerts`, `alert_events`, `positions`). The separate
   `backend/sql/decision_log.sql` defines the daily-rating archive. The archive
   reader reports missing or unreadable tables as unavailable, not empty history.
2. **`CRON_SECRET`** — set this env var in Vercel so the weekday alerts cron
   (`vercel.json` → `/api/alerts/run`, 20:30 UTC Mon–Fri) can authenticate. Without it
   the run endpoint rejects everything.

Feature map:
- **Grounded assistant** — `/api/analytics/chat` accepts a `symbol`; the server injects live quote/indicators/conviction/forecast/news into the prompt.
- **Watchlist scan** — `GET /api/watchlist/scan` ranks your watchlist by ensemble conviction (auth required).
- **Forecast accountability** — eligible daily Yahoo `/insights` calls with structurally valid observations attempt to save a forecast row. The response reports `saved`, `failed`, `not_configured` or `not_eligible`. A later request can replace the same symbol/UTC-date/model row. `GET /api/analytics/accountability?symbol=` grades stored forecasts against subsequent observations; these legacy records are not a complete request history.
- **Classification audit** — the dashboard's “Explain this state” panel shows current calculation inputs and recording status. Authenticated `GET /api/analytics/recorded-history?symbol=AAPL` reads up to 60 existing daily-summary and forecast records per archive, with separate availability states and retention limitations. Daily ratings keep the first observation per symbol/UTC date; they are not written by dashboard page requests. Legacy archives lack full settings and source snapshots, so an exact past reversal cannot always be reconstructed. See the [classification audit](docs/market-research-roadmap.md#classification-consistency-and-recording-audit).
- **Alerts** — CRUD under `/api/alerts` (auth), rules: price above/below, confirmed RSI overbought/oversold, conviction flip; events surface in the Alerts tab.
- **Ensemble weights** — `?weights={"sma":0.3,...}` on `/insights` and `/evaluate`; `indicator=ensemble` backtests the weighted vote as a strategy (±0.3 score crossings).
- **Portfolio** — `/api/positions` (auth) with live P&L and a same-period SPY benchmark.

## Backend tests

```
cd backend
npm test   # vitest: auth, rate-limited routes, simulation, models, evaluation, classifier
```

## Notes

- The Streamlit workspace has been removed. All analytics logic was translated to JavaScript (`backend/utils/computeSignals.js` and friends) and reused by the frontend through REST calls.
- The frontend retains client-side indicator overlays for responsive charting while the backend handles data retrieval, signal generation, forecasting, Supabase-authenticated watchlist CRUD, and a textual technical summary surfaced on the dashboard.
- The dashboard includes tabs for market overview, an advanced backtesting lab, and the "Mini NZ Assistant" AI chat (OpenAI/Gemini) powered by the `/api/analytics/chat` endpoint.
- `vercel.json` maps `/api/*` requests to the Express backend and serves the Vite build output from `frontend/dist`.
- **Metadata Explorer**: `/api/analytics/metadata` returns prototype/periphery scores, region rules, and facet tags (sector, region, market cap bucket, risk bucket, style factors). The Market Overview tab now includes a prototype slider, facet filters, and per-symbol evidence text that mirrors the course’s category focus. No extra env vars are required for this; data is bundled in `backend/utils/metadata.js`.

Have fun. :) 
