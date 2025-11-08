# StockDashboard Frontend

This directory hosts the React (Vite + Tailwind) single-page app for StockDashboard. It consumes the Supabase-authenticated REST API served from `../backend` and focuses on:

- Google OAuth via Supabase (PKCE redirect handled client-side).
- AI-enhanced dashboard components backed by `/api/analytics/*` routes.
- Watchlist management through `/api/watchlist` using the user's Supabase access token.

## Available Scripts

```
npm install          # install dependencies
npm run dev          # start Vite on http://localhost:5173
npm run build        # production build (Vercel uses this)
npm run preview      # preview production build locally
```

Environment variables are defined in `.env.example` and loaded by Vite. Ensure the backend is running on `VITE_API_BASE_URL` (defaults to `http://localhost:4000`).

Refer to the repository root `README.md` for full-stack setup and deployment instructions.
