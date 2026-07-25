# User Personalization — Preference Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each authenticated user's last-used symbol, date range, indicator selections, forecast model, and initial capital in Supabase so the dashboard restores exactly where they left off on every login.

**Architecture:** A new `user_preferences` Supabase table (one row per user, upsert on change) is exposed through a new Express route at `/api/user/preferences` using the same JWT-verify + service-role pattern as the existing watchlist route. The frontend gets two new API functions in the existing `api.js` and a lightweight `useUserPreferences` hook that loads prefs once on mount, applies them to Dashboard state, and debounces saves (1.5 s) on every subsequent state change.

**Tech Stack:** Node.js/Express backend, Supabase (SQL + service role key), React hooks, existing `frontend/src/services/api.js` request helper.

## Global Constraints

- No new npm packages — use only what is already installed
- Follow the exact auth pattern of `backend/routes/watchlist.js`: `getUserFromRequest` middleware, `supabaseAdmin` for all DB operations
- API functions go in the existing `frontend/src/services/api.js` — do NOT create a separate service file
- The hook file is `frontend/src/hooks/useUserPreferences.js` (new file)
- Debounce delay is exactly **1500 ms**
- Preferences are best-effort: network failures on load or save must never throw or break the dashboard — degrade silently
- The Supabase schema SQL must be run manually in the Supabase dashboard SQL editor; the plan provides the exact SQL

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| Supabase SQL editor | Manual step | Create `user_preferences` table + RLS policies |
| `backend/routes/preferences.js` | Create | GET + PUT `/api/user/preferences` with JWT auth |
| `backend/index.js` | Modify | Mount preferences router at `/api/user` |
| `frontend/src/services/api.js` | Modify | Add `getPreferences(token)` and `updatePreferences(prefs, token)` |
| `frontend/src/hooks/useUserPreferences.js` | Create | Load prefs on mount, expose debounced `save` function |
| `frontend/src/components/Dashboard.jsx` | Modify | Call hook, apply loaded prefs once, auto-save on state changes |

---

## Task 1: Supabase Schema + Backend Preferences Route

**Files:**
- Manual: Supabase SQL editor
- Create: `backend/routes/preferences.js`
- Modify: `backend/index.js`

**Interfaces:**
- Produces: `GET /api/user/preferences` → `{ preferences: PrefsRow | null }`
- Produces: `PUT /api/user/preferences` with body `{ lastSymbol?, lastRange?, selectedIndicators?, forecastModel?, initialCapital? }` → `{ preferences: PrefsRow }`
- Where `PrefsRow = { last_symbol: string, last_range: string, selected_indicators: string[], forecast_model: string, initial_capital: number }`

- [ ] **Step 1: Run the Supabase schema SQL**

Open your Supabase project → SQL Editor → New query. Paste and run:

```sql
create table public.user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  last_symbol text not null default 'AAPL',
  last_range text not null default '1y',
  selected_indicators jsonb not null default '["sma","bollinger"]'::jsonb,
  forecast_model text not null default 'simple',
  initial_capital numeric not null default 10000,
  updated_at timestamptz default timezone('utc', now()),
  primary key (user_id)
);

alter table public.user_preferences enable row level security;

create policy "Users read own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users insert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);
```

Expected: "Success. No rows returned."

- [ ] **Step 2: Create `backend/routes/preferences.js`**

```js
import express from 'express';
import { getUserFromRequest, supabaseAdmin } from '../utils/supabaseClient.js';

const router = express.Router();

router.use(async (req, res, next) => {
  const { user, error } = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: error ?? 'Unauthorized' });
  req.user = user;
  next();
});

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .select('last_symbol, last_range, selected_indicators, forecast_model, initial_capital')
      .eq('user_id', req.user.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({ preferences: data ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const { lastSymbol, lastRange, selectedIndicators, forecastModel, initialCapital } = req.body ?? {};

    const payload = {
      user_id: req.user.id,
      updated_at: new Date().toISOString(),
    };

    if (typeof lastSymbol === 'string' && lastSymbol.trim()) {
      payload.last_symbol = lastSymbol.trim().toUpperCase().slice(0, 10);
    }
    if (typeof lastRange === 'string' && lastRange.trim()) {
      payload.last_range = lastRange.trim();
    }
    if (Array.isArray(selectedIndicators)) {
      payload.selected_indicators = selectedIndicators;
    }
    if (typeof forecastModel === 'string' && forecastModel.trim()) {
      payload.forecast_model = forecastModel.trim();
    }
    if (typeof initialCapital === 'number' && initialCapital > 0) {
      payload.initial_capital = initialCapital;
    }

    const { data, error } = await supabaseAdmin
      .from('user_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select('last_symbol, last_range, selected_indicators, forecast_model, initial_capital')
      .single();

    if (error) throw error;
    res.json({ preferences: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 3: Mount the preferences router in `backend/index.js`**

Find the existing import block in `backend/index.js`:
```js
import analyticsRouter from './routes/analytics.js';
import watchlistRouter from './routes/watchlist.js';
```

Add after:
```js
import preferencesRouter from './routes/preferences.js';
```

Find:
```js
app.use('/api/analytics', analyticsRouter);
app.use('/api/watchlist', watchlistRouter);
```

Add after:
```js
app.use('/api/user', preferencesRouter);
```

- [ ] **Step 4: Smoke-test the backend route**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/backend
npm run dev &
sleep 3
# GET without auth should return 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/user/preferences
```

Expected output: `401`

Kill the dev server: `kill %1`

- [ ] **Step 5: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add backend/routes/preferences.js backend/index.js
git commit -m "feat: user preferences backend route

GET /api/user/preferences returns saved prefs or null for new users.
PUT /api/user/preferences upserts by user_id. Same JWT auth pattern
as watchlist. Supabase table: user_preferences (user_id PK, 5 pref
columns, updated_at)."
```

---

## Task 2: Frontend API Functions + Preferences Hook

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/hooks/useUserPreferences.js`

**Interfaces:**
- Consumes: existing `request(path, options)` internal function in `api.js`
- Produces: `getPreferences(token: string) → Promise<{ preferences: PrefsRow | null }>`
- Produces: `updatePreferences(prefs: PrefsBody, token: string) → Promise<{ preferences: PrefsRow }>`
- Produces: `useUserPreferences(accessToken: string | undefined) → { preferences: PrefsRow | null, loading: boolean, save: (prefs: PrefsBody) => void }`
- Where `PrefsBody = { lastSymbol?: string, lastRange?: string, selectedIndicators?: string[], forecastModel?: string, initialCapital?: number }`

- [ ] **Step 1: Add `getPreferences` and `updatePreferences` to `frontend/src/services/api.js`**

At the end of `frontend/src/services/api.js`, after the last export (`postChatMessage`), append:

```js
export function getPreferences(token) {
  return request('/api/user/preferences', { token });
}

export function updatePreferences(prefs, token) {
  return request('/api/user/preferences', {
    method: 'PUT',
    body: prefs,
    token,
  });
}
```

- [ ] **Step 2: Create `frontend/src/hooks/useUserPreferences.js`**

```js
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreferences, updatePreferences } from '../services/api';

const SAVE_DELAY_MS = 1500;

export function useUserPreferences(accessToken) {
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getPreferences(accessToken)
      .then((data) => {
        if (!cancelled) setPreferences(data?.preferences ?? null);
      })
      .catch(() => {
        // preferences unavailable — dashboard uses defaults
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const save = useCallback(
    (prefs) => {
      if (!accessToken) return;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        updatePreferences(prefs, accessToken).catch(() => {
          // best-effort — silent failure
        });
      }, SAVE_DELAY_MS);
    },
    [accessToken],
  );

  return { preferences, loading, save };
}
```

- [ ] **Step 3: Verify the frontend builds**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend
npm run build
```

Expected: `✓ built in <N>s` with 0 errors. Module count may tick up by 1 (the new hook file).

- [ ] **Step 4: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add frontend/src/services/api.js frontend/src/hooks/useUserPreferences.js
git commit -m "feat: preferences API client + useUserPreferences hook

getPreferences / updatePreferences added to api.js (same request()
helper pattern as watchlist). useUserPreferences loads on mount,
debounces saves by 1500 ms, fails silently on network errors."
```

---

## Task 3: Dashboard.jsx — Apply Preferences on Load + Auto-Save on Change

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx`

**Interfaces:**
- Consumes: `useUserPreferences(accessToken)` from `../hooks/useUserPreferences`
- Consumes: `session?.access_token` — already available as a prop in Dashboard (`session` prop passed from App.jsx)
- The hook returns `{ preferences: PrefsRow | null, loading: boolean, save: (PrefsBody) => void }`

- [ ] **Step 1: Add the hook import to Dashboard.jsx**

Find the existing hook imports at the top of `frontend/src/components/Dashboard.jsx`:
```js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

After that line, add:
```js
import { useUserPreferences } from '../hooks/useUserPreferences';
```

- [ ] **Step 2: Call the hook inside the Dashboard component**

Find the line in Dashboard.jsx where the component state is declared — after the existing `useState` calls (around line 54–116), add the hook call. Place it after `const [activeTab, setActiveTab] = useState('overview');`:

```js
const { preferences, loading: prefsLoading, save: savePreferences } = useUserPreferences(
  session?.access_token,
);
```

- [ ] **Step 3: Add the one-time preferences-apply effect**

Add this effect immediately after the hook call from Step 2. It uses a ref so it fires exactly once (when prefs finish loading) without triggering the auto-save:

```js
const prefsApplied = useRef(false);

useEffect(() => {
  if (prefsLoading || prefsApplied.current) return;
  prefsApplied.current = true;
  if (!preferences) return;
  if (preferences.last_symbol) setSymbol(preferences.last_symbol);
  if (preferences.last_range) setRange(preferences.last_range);
  if (Array.isArray(preferences.selected_indicators) && preferences.selected_indicators.length > 0) {
    setSelectedIndicators(preferences.selected_indicators);
  }
  if (preferences.forecast_model) setForecastModel(preferences.forecast_model);
  if (preferences.initial_capital) setInitialCapital(Number(preferences.initial_capital));
}, [preferences, prefsLoading]);
```

- [ ] **Step 4: Add the debounced auto-save effect**

Add this effect immediately after the one from Step 3. The guard `prefsApplied.current` ensures saves only fire after the initial load is done — not during the apply pass:

```js
useEffect(() => {
  if (!prefsApplied.current) return;
  savePreferences({
    lastSymbol: symbol,
    lastRange: range,
    selectedIndicators,
    forecastModel,
    initialCapital,
  });
}, [symbol, range, selectedIndicators, forecastModel, initialCapital, savePreferences]);
```

- [ ] **Step 5: Verify the build still passes**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/frontend
npm run build
```

Expected: `✓ built in <N>s`, 0 errors.

- [ ] **Step 6: Manual end-to-end verification**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ/backend
npm run dev &
cd ../frontend
npm run dev
```

Open `http://localhost:5173`, sign in with Google. Then:

1. Change the ticker to `TSLA`, range to `3mo`, add RSI to indicators
2. Wait 2 seconds (debounce fires)
3. Open DevTools → Network → filter `/api/user/preferences` → confirm a PUT request was made with `lastSymbol: "TSLA"`, `lastRange: "3mo"`
4. Reload the page (hard refresh)
5. Confirm the dashboard loads with `TSLA`, `3mo`, and RSI selected — not the defaults

Expected: ticker, range, indicators, model, and capital all restored from the previous session.

- [ ] **Step 7: Commit**

```bash
cd /Users/xienanzheng/Desktop/Berkeley/Startup_Ideas/NBullZ/Patterngrow_NbullZ
git add frontend/src/components/Dashboard.jsx
git commit -m "feat: restore user preferences on login + auto-save on change

Dashboard calls useUserPreferences on mount. Saved prefs (symbol,
range, indicators, model, capital) are applied once after loading.
Any subsequent change is debounced 1.5s and persisted per user."
```

---

## Self-Review

**Spec coverage:**
- [x] Per-user last-symbol persisted → `last_symbol` column, applied in Task 3 Step 3
- [x] Range persisted → `last_range` column
- [x] Indicator selections persisted → `selected_indicators` jsonb column
- [x] Forecast model persisted → `forecast_model` column
- [x] Initial capital persisted → `initial_capital` column
- [x] Restores on login → Task 3 Step 3 apply effect fires once after load
- [x] Auto-saves on change → Task 3 Step 4 debounced effect
- [x] No crash if preferences unavailable → hook catches all errors silently
- [x] New user (no row yet) → GET returns null → apply effect guards with `if (!preferences) return` → dashboard uses defaults → first change creates a row via upsert

**Placeholder scan:** Clean — all steps have real code.

**Type consistency:**
- `getPreferences(token)` defined in Task 2 Step 1 → called in `useUserPreferences` as `getPreferences(accessToken)` ✓
- `updatePreferences(prefs, token)` defined in Task 2 Step 1 → called in `save` callback as `updatePreferences(prefs, accessToken)` ✓
- `save` is called in Dashboard as `savePreferences({ lastSymbol, lastRange, selectedIndicators, forecastModel, initialCapital })` — matches `updatePreferences` body field names ✓
- `preferences.last_symbol` / `preferences.last_range` etc. — snake_case from the DB, accessed consistently in Task 3 Step 3 ✓
- `prefsLoading` and `prefsApplied` ref used consistently across Task 3 Steps 3 and 4 ✓

**Edge case — first save race:** When `prefsApplied.current` becomes true, the apply effect sets state (symbol, range, etc.). Those state changes trigger the auto-save effect. But since `prefsApplied.current` is a ref (not state), the auto-save effect doesn't re-run on that mutation alone — it only runs when the listed deps (`symbol`, `range`, etc.) actually change. The first auto-save call therefore fires with the just-applied values (idempotent with what was loaded) and is debounced 1.5 s — meaning a real user change will reset the timer before the initial write even lands. Net effect: one extra PUT on login at worst, perfectly idempotent.

*Plan saved. 3 tasks, 7 steps total, across 5 files.*
