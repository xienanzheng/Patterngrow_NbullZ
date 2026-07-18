# StockDashboard (Made using contents and knowledge learnt from INFO253A, INFO202 and other coding classes)

Modernised full-stack workspace for the StockDashboard project. The legacy Streamlit app has been replaced with a React + Vite frontend and a Node.js + Express analytics API that integrate with Supabase for authentication, database, and storage. The repository matches Vercel's hybrid deployment model so the same codebase can be deployed locally or on Vercel with minimal configuration changes.

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

Duplicate `.env.example` to `.env` at the repository root and fill in the values:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=anon-public-key
SUPABASE_SERVICE_KEY=service-role-key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=anon-public-key
VITE_API_BASE_URL=http://localhost:4000
ALLOWED_ORIGINS=http://localhost:5173
```

- `SUPABASE_SERVICE_KEY` is required only by the backend for secure watchlist CRUD.
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

- `POST /api/analytics/metadata/manual`, `POST /api/analytics/metadata/csv`, and `POST /api/analytics/chat` require a Supabase bearer token (any signed-in Google OAuth user). The frontend forwards the session token automatically.
- All `/api/analytics/*` routes are rate-limited to 60 requests/min per IP; `/chat` is additionally capped at 20 requests/hour per user (limits are per serverless instance — best-effort cost bounds).
- Read endpoints (`quote`, `history`, `news`, `insights`, `metadata` GET, `evaluate`) stay public.

## Analytics & forecasting

- **Forecast models** (`backend/utils/predictions.js`): `drift` (mean log-return extrapolation), `ar` (autoregression on log returns, OLS-fit), `holt` (Holt linear exponential smoothing, grid-searched α/β). Legacy names `simple`/`arima`/`prophet` map onto these for backward compatibility. Every forecast point carries an 80% confidence band derived from historical volatility (`value·exp(±1.2816·σ·√h)`), which replaces the old fixed ±8% "targets".
- **Walk-forward evaluation** (`backend/utils/evaluation.js`, `GET /api/analytics/evaluate?symbol=&range=&indicator=&horizon=&folds=`): rolling-origin out-of-sample folds reporting MAE/RMSE/MAPE/directional accuracy per model plus a naive baseline, and out-of-sample strategy return vs. buy-and-hold (with 0.1% transaction costs + 0.05% slippage) including win rate and max drawdown. Surfaced in the Advanced Lab tab ("Evaluate Models").
- **Directional classifier** (`backend/utils/classifier.js`): plain-JS logistic regression over lagged returns, RSI, MACD divergence, volatility, and volume ratio → probability the price is higher in 5 days. Its embargoed-holdout accuracy is always reported next to the probability — treat sub-55% accuracy as noise.
- **Ensemble conviction** (`backend/utils/computeSignals.js`): weighted vote across SMA/RSI/MACD/Bollinger/Stochastic/ADX with a stability rule — qualitative labels (overbought/oversold/trending) only flip after 2+ consecutive confirming sessions, so the recommendation no longer whipsaws on a single noisy bar.
- **Simulation realism** (`backend/utils/backtesting.js`): transaction costs, slippage, and optional stop-loss are modeled; the insights payload reports trade count and total costs paid.
- Honest-by-design: none of this predicts the market reliably; the point of the evaluation harness is that every number ships with its out-of-sample track record instead of an in-sample illusion.

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
