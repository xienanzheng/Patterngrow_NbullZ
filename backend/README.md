# StockDashboard Backend (Streamlit has been deprecated.)

Express-based API that mirrors the analytics previously implemented in Streamlit. The server exposes two route groups:

- `GET /api/analytics/*` – market data, signal generation, forecasting, and sentiment (see `routes/analytics.js`).
- `POST /api/analytics/chat` – lightweight proxy for OpenAI / Gemini used by the Mini NZ Assistant tab.
- `GET|POST|DELETE /api/watchlist` – authenticated watchlist CRUD via Supabase service role (`routes/watchlist.js`).

## Scripts

```
npm install   # install dependencies
npm run dev   # start in watch mode on http://localhost:4000
npm start     # production mode
```

Use Node.js 24 LTS. Public research and the MCP server work without Supabase. Set optional environment variables via `backend/.env` (see `.env.example`). Account features require:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_ANON_KEY` (optional fallback)
- `ALLOWED_ORIGINS` (comma separated list of allowed origins)
- API keys for optional providers such as `ALPHA_VANTAGE_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`.

Historical data defaults to Yahoo Finance. Set `MARKET_DATA_PROVIDER=twelvedata` and `TWELVE_DATA_API_KEY` to select Twelve Data, with an isolated Yahoo fallback. The returned source always identifies the actual provider. Currency, feed latency, missingness and session completeness are not inferred from configuration.

`METADATA_ADMIN_USER_IDS` is a comma-separated allowlist of verified user IDs allowed to edit shared ticker metadata. Trusted `app_metadata.role=admin` also grants this specific permission. Without either, metadata writes are denied even to signed-in users.

Research endpoints: `GET /api/analytics/research` (symbol/range/interval), `GET /api/analytics/providers`, `GET /api/analytics/comparison` (symbol/benchmark/range; daily-only), and `GET /api/analytics/overview` (no arguments; fixed six-fund universe). All use public request rate limits. Research uses a bounded 60-second process-local cache; provider status reports configuration only, never keys or verified health. Comparison shares the research cache and limits each input to 520 daily observations and two years. Overview coalesces requests into one 60-second summary and caps concurrent history loads at three; individual failures are returned as unavailable rows. See [MCP setup](mcp/README.md) for the five read-only stdio tools.

When deployed on Vercel, the default export in `index.js` is used to mount the serverless function under `/api/*`.

## Classification history

`GET /api/analytics/recorded-history?symbol=AAPL` requires a verified bearer token and returns `Cache-Control: private, no-store`. It reads only existing `decision_log` and `forecast_log` rows, with at most 60 records per archive and independent five-second deadlines. Each archive reports `available`, `unavailable` or `not_configured`; an empty available archive is distinct from a failed read. The response exposes shared symbol observations, not account data, and performs no writes or recomputation.

The legacy daily-summary logger retains the first rating per symbol and UTC date. Forecast logging replaces the row for the same symbol, UTC date and model; `created_at` is not a last-replacement timestamp. Neither schema retains all calculation settings, source bars or methodology versions. These records cannot establish the exact cause of every past change. The chart's recomputed historical markers are a different dataset from recorded observations.

`/api/analytics/insights` now reports forecast save status separately from daily-rating recording. Its `conviction` includes calculation version, measurements, normalized weights, signed contributions and the score actually used for thresholds. This calculation is stateless with respect to earlier labels. See the [audit and remaining work](../docs/market-research-roadmap.md#classification-consistency-and-recording-audit).
