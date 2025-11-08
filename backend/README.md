# StockDashboard Backend

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

Set environment variables via `.env` (see `.env.example`). The backend expects:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SUPABASE_ANON_KEY` (optional fallback)
- `ALLOWED_ORIGINS` (comma separated list of allowed origins)
- API keys for optional providers such as `ALPHA_VANTAGE_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`.

When deployed on Vercel, the default export in `index.js` is used to mount the serverless function under `/api/*`.
