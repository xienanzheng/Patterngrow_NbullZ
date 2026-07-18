# Analytics Core Rebuild + Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the live auth/rate-limit holes, then replace the cosmetic analytics core with a measured one: walk-forward evaluation harness, cost-aware simulation, stable (non-flip-flopping) signal narrative, ensemble conviction score, honest forecast models (drift/AR/Holt) with volatility bands, and a directional classifier that always ships with its measured accuracy.

**Architecture:** Express (ESM) backend on Vercel serverless + React/Vite frontend. All analytics stay dependency-light plain JS in `backend/utils/`. New pure modules (`evaluation.js`, `classifier.js`) are unit-tested with vitest; route protection reuses the Supabase bearer-token pattern already proven in `watchlist.js`.

**Tech Stack:** Node ≥18, Express 4, @supabase/supabase-js 2, express-rate-limit 7, vitest 2 + supertest 7 (dev), React 18 + recharts (frontend).

## Global Constraints

- Backend is ESM (`"type": "module"`); all imports use `.js` extensions.
- No heavyweight ML/stats dependencies; implement AR/Holt/logistic regression in plain JS.
- `runTradingSimulation(points, signals, initialCapital)` must keep returning `[{date, value}]` — `Dashboard.jsx` depends on that shape.
- Legacy forecast model names `simple|arima|prophet` must keep working (mapped to `drift|ar|holt`) so old clients don't break.
- Insights/quote/history/news/metadata GET stay public (rate-limited); metadata writes + chat require Supabase auth.
- Tests must not hit real Supabase/Yahoo/OpenAI — mock at module boundary; `tests/setup.js` sets fake env + `VERCEL='1'` so `app.listen` never runs.
- Defaults: transaction cost 0.1%/trade (`0.001`), slippage 0.05% (`0.0005`), chat limit 20 req/user/hour, public limit 60 req/IP/min.
- Commit after every task (conventional prefix: `feat:`/`fix:`/`test:`/`docs:`).

---

### Task 1: Backend test scaffolding (vitest + supertest)

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.js`
- Create: `backend/tests/setup.js`
- Create: `backend/tests/smoke.test.js`

**Interfaces:**
- Produces: `npm test` (vitest run) working in `backend/`; `tests/setup.js` guarantees `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `VERCEL=1` are set before any module import.

- [ ] **Step 1: Add dev deps and script**

Run in `backend/`: `npm install -D vitest@^2 supertest@^7 && npm install express-rate-limit@^7`

Edit `backend/package.json` scripts:

```json
"scripts": {
  "start": "node index.js",
  "dev": "nodemon index.js",
  "test": "vitest run"
}
```

- [ ] **Step 2: Create vitest config + setup**

`backend/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
    environment: 'node',
  },
});
```

`backend/tests/setup.js`:

```js
// Fake credentials so supabaseClient.js module-level guard passes,
// and VERCEL=1 so importing index.js never calls app.listen in tests.
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'test-service-key';
process.env.VERCEL = '1';
```

- [ ] **Step 3: Smoke test**

`backend/tests/smoke.test.js`:

```js
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../index.js';

describe('api smoke', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
```

- [ ] **Step 4: Run `npm test` in backend/ — expect 1 passing**
- [ ] **Step 5: Commit** `test: add vitest+supertest scaffolding for backend`

---

### Task 2: Shared auth middleware + protect metadata writes and chat

**Files:**
- Create: `backend/utils/authMiddleware.js`
- Modify: `backend/routes/watchlist.js` (use shared middleware)
- Modify: `backend/routes/analytics.js` (protect the three POST routes)
- Test: `backend/tests/auth.test.js`

**Interfaces:**
- Consumes: `getUserFromRequest(req)` from `backend/utils/supabaseClient.js`.
- Produces: `requireAuth(req, res, next)` — Express middleware; on success sets `req.user` (Supabase user) and `req.token`, on failure responds `401 {error}`. Later tasks (rate limiting) rely on `req.user.id` being set for authenticated routes.

- [ ] **Step 1: Write failing tests**

`backend/tests/auth.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import { supabaseAdmin } from '../utils/supabaseClient.js';

describe('route protection', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    ['post', '/api/analytics/metadata/manual'],
    ['post', '/api/analytics/metadata/csv'],
    ['post', '/api/analytics/chat'],
  ])('%s %s returns 401 without a bearer token', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it('chat with valid token but no key configured returns 400 (auth passed)', async () => {
    vi.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const res = await request(app)
      .post('/api/analytics/chat')
      .set('Authorization', 'Bearer fake-token')
      .send({ prompt: 'hello', provider: 'openai' });
    if (prevKey) process.env.OPENAI_API_KEY = prevKey;
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect 401 cases to FAIL (currently 400/500), confirming the hole**
- [ ] **Step 3: Implement middleware**

`backend/utils/authMiddleware.js`:

```js
import { getUserFromRequest } from './supabaseClient.js';

export async function requireAuth(req, res, next) {
  const { user, token, error } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: error ?? 'Unauthorized' });
  }
  req.user = user;
  req.token = token;
  return next();
}
```

In `backend/routes/watchlist.js`, replace the inline `router.use(async (req, res, next) => {...})` block with:

```js
import { requireAuth } from '../utils/authMiddleware.js';
// ...
router.use(requireAuth);
```

In `backend/routes/analytics.js`, import and apply per-route:

```js
import { requireAuth } from '../utils/authMiddleware.js';
// ...
router.post('/metadata/manual', requireAuth, async (req, res) => { /* existing body */ });
router.post('/metadata/csv', requireAuth, async (req, res) => { /* existing body */ });
router.post('/chat', requireAuth, async (req, res) => { /* existing body */ });
```

- [ ] **Step 4: Run tests — all pass**
- [ ] **Step 5: Commit** `fix: require Supabase auth on metadata writes and chat endpoint`

---

### Task 3: Rate limiting

**Files:**
- Create: `backend/utils/rateLimits.js`
- Modify: `backend/index.js` (trust proxy)
- Modify: `backend/routes/analytics.js` (mount limiters)

**Interfaces:**
- Consumes: `req.user.id` set by `requireAuth` (Task 2).
- Produces: `publicLimiter` (60 req/min/IP, applied router-wide on analytics) and `chatLimiter` (20 req/hour keyed by `req.user.id`, mounted after `requireAuth` on `/chat`).

- [ ] **Step 1: Implement limiters**

`backend/utils/rateLimits.js`:

```js
import { rateLimit } from 'express-rate-limit';

// Vercel serverless note: stores are per-instance memory, so these are
// best-effort cost bounds, not hard global guarantees. Acceptable at this scale.
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Mounted after requireAuth, so req.user is always present — no IP fallback needed.
export const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: 'Chat rate limit reached (20/hour). Try again later.' },
});
```

`backend/index.js` — after `const app = express();` add:

```js
app.set('trust proxy', 1); // Vercel terminates TLS in front of the function
```

`backend/routes/analytics.js`:

```js
import { chatLimiter, publicLimiter } from '../utils/rateLimits.js';
// ...
router.use(publicLimiter);
// ...
router.post('/chat', requireAuth, chatLimiter, async (req, res) => { /* existing body */ });
```

- [ ] **Step 2: Run `npm test` — existing tests still pass (limits far above test volume)**
- [ ] **Step 3: Commit** `feat: add per-IP and per-user rate limiting to analytics API`

---

### Task 4: Remove supabaseAnon footgun + fix PKCE cleanup

**Files:**
- Modify: `backend/utils/supabaseClient.js`
- Modify: `frontend/src/hooks/useSupabaseAuth.js`

**Interfaces:**
- Produces: `supabaseClient.js` exports only `supabaseAdmin`, `extractBearerToken`, `getUserFromRequest`.

- [ ] **Step 1: Delete the `supabaseAnon` export and the `anonKey` fallback lines from `backend/utils/supabaseClient.js`** (grep confirms zero imports anywhere).
- [ ] **Step 2: Fix sign-out cleanup**

In `frontend/src/hooks/useSupabaseAuth.js`, replace:

```js
window.localStorage.removeItem(`${supabase.storageKey ?? 'supabase.auth'}-code-verifier`);
```

with:

```js
window.localStorage.removeItem('stock-dashboard-auth-code-verifier');
```

(matches `storageKey: 'stock-dashboard-auth'` in `frontend/src/lib/supabaseClient.js`; supabase-js stores the PKCE verifier under `<storageKey>-code-verifier`).

- [ ] **Step 3: `npm test` (backend) + `npm run lint` (frontend) — pass**
- [ ] **Step 4: Commit** `fix: drop service-key fallback anon client; correct PKCE verifier cleanup key`

---

### Task 5: Frontend sends auth token on protected calls

**Files:**
- Modify: `frontend/src/services/api.js`
- Modify: `frontend/src/components/Dashboard.jsx`
- Modify: `frontend/src/components/MiniAssistant.jsx`

**Interfaces:**
- Produces: `upsertMetadataRow(row, token)`, `uploadMetadataCsv(csv, token)`, `postChatMessage(payload, token)`; `MiniAssistant` accepts `accessToken` prop.

- [ ] **Step 1: api.js**

```js
export function upsertMetadataRow(row, token) {
  return request('/api/analytics/metadata/manual', { method: 'POST', body: row, token });
}

export function uploadMetadataCsv(csv, token) {
  return request('/api/analytics/metadata/csv', { method: 'POST', body: { csv }, token });
}

export function postChatMessage({ prompt, provider, model, apiKey, temperature }, token) {
  return request('/api/analytics/chat', {
    method: 'POST',
    body: { prompt, provider, model, apiKey, temperature },
    token,
  });
}
```

- [ ] **Step 2: Dashboard.jsx** — in the Add Ticker onClick, call `upsertMetadataRow({...}, session?.access_token)`; in the CSV upload onClick, `uploadMetadataCsv(csvText, session?.access_token)`; render `<MiniAssistant accessToken={session?.access_token} />`.
- [ ] **Step 3: MiniAssistant.jsx** — `export default function MiniAssistant({ accessToken })` and `postChatMessage({...}, accessToken)`.
- [ ] **Step 4: `npm run lint` + `npm run build` in frontend/ — pass**
- [ ] **Step 5: Commit** `fix: forward Supabase session token on metadata writes and chat`

---

### Task 6: Simulation realism — costs, slippage, stop-loss

**Files:**
- Modify: `backend/utils/backtesting.js`
- Test: `backend/tests/backtesting.test.js`

**Interfaces:**
- Produces:
  - `runTradingSimulationDetailed(points, signals, initialCapital, options?) -> { portfolio: [{date, value}], trades: [{type: 'buy'|'sell'|'stop', date, price, pnlPct?}], costsPaid: number }`
  - options: `{ transactionCostPct = 0.001, slippagePct = 0.0005, stopLossPct = null }` (stopLossPct as fraction, e.g. `0.05`)
  - `runTradingSimulation(...)` unchanged signature, now delegates: returns `.portfolio`.

- [ ] **Step 1: Failing tests**

`backend/tests/backtesting.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { runTradingSimulation, runTradingSimulationDetailed } from '../utils/backtesting.js';

const day = (i, close) => ({ date: `2025-01-${String(i + 1).padStart(2, '0')}`, close });
const buy = { signal: 'buy_strong', numericSignal: 1 };
const sell = { signal: 'sell_strong', numericSignal: -1 };
const hold = { signal: 'hold', numericSignal: 0 };

describe('runTradingSimulationDetailed', () => {
  it('costs and slippage reduce final value vs frictionless run', () => {
    const points = [100, 100, 110, 120, 130].map((c, i) => day(i, c));
    const signals = [hold, buy, hold, hold, sell];
    const friction = runTradingSimulationDetailed(points, signals, 10000, {});
    const free = runTradingSimulationDetailed(points, signals, 10000, {
      transactionCostPct: 0, slippagePct: 0,
    });
    expect(friction.portfolio.at(-1).value).toBeLessThan(free.portfolio.at(-1).value);
    expect(friction.costsPaid).toBeGreaterThan(0);
  });

  it('stop-loss liquidates the position on breach', () => {
    const points = [100, 100, 89, 88, 87].map((c, i) => day(i, c));
    const signals = [hold, buy, hold, hold, hold];
    const { trades } = runTradingSimulationDetailed(points, signals, 10000, { stopLossPct: 0.05 });
    expect(trades.some((t) => t.type === 'stop')).toBe(true);
  });

  it('portfolio has one row per input bar and legacy wrapper matches', () => {
    const points = [100, 101, 102].map((c, i) => day(i, c));
    const signals = [hold, hold, hold];
    const detailed = runTradingSimulationDetailed(points, signals, 5000, {});
    expect(detailed.portfolio).toHaveLength(3);
    expect(runTradingSimulation(points, signals, 5000)).toEqual(detailed.portfolio);
  });
});
```

- [ ] **Step 2: Run — FAIL (`runTradingSimulationDetailed` not exported)**
- [ ] **Step 3: Implement**

Replace `runTradingSimulation` in `backend/utils/backtesting.js` with:

```js
function signalWeight(signal) {
  if (signal.endsWith('strong')) return 0.5;
  if (signal.endsWith('medium')) return 0.3;
  if (signal.endsWith('weak')) return 0.1;
  return 1;
}

export function runTradingSimulationDetailed(points, signals, initialCapital, options = {}) {
  const { transactionCostPct = 0.001, slippagePct = 0.0005, stopLossPct = null } = options;
  const portfolio = [];
  const trades = [];
  let cash = initialCapital;
  let shares = 0;
  let position = 0;
  let entryPrice = null;
  let costsPaid = 0;

  points.forEach((row, index) => {
    const price = getClose(row);
    if (index === 0 || !Number.isFinite(price) || price <= 0) {
      portfolio.push({ date: row.date, value: cash + shares * (Number.isFinite(price) ? price : 0) });
      return;
    }

    // Stop-loss exits before any new signal is considered on the same bar.
    if (stopLossPct != null && position === 1 && entryPrice != null
        && price <= entryPrice * (1 - stopLossPct)) {
      const execPrice = price * (1 - slippagePct);
      const proceeds = shares * execPrice;
      const fee = proceeds * transactionCostPct;
      cash += proceeds - fee;
      costsPaid += fee;
      trades.push({ type: 'stop', date: row.date, price: execPrice, pnlPct: ((execPrice - entryPrice) / entryPrice) * 100 });
      shares = 0;
      position = 0;
      entryPrice = null;
    }

    const signal = signals[index]?.signal ?? 'hold';
    if (signal.startsWith('buy') && position === 0) {
      const toInvest = cash * signalWeight(signal);
      const execPrice = price * (1 + slippagePct);
      const fee = toInvest * transactionCostPct;
      const purchased = (toInvest - fee) / execPrice;
      if (purchased > 0) {
        shares += purchased;
        cash -= toInvest;
        costsPaid += fee;
        entryPrice = execPrice;
        position = 1;
        trades.push({ type: 'buy', date: row.date, price: execPrice });
      }
    } else if (signal.startsWith('sell') && position === 1) {
      const toSell = shares * signalWeight(signal);
      const execPrice = price * (1 - slippagePct);
      const proceeds = toSell * execPrice;
      const fee = proceeds * transactionCostPct;
      cash += proceeds - fee;
      costsPaid += fee;
      trades.push({
        type: 'sell', date: row.date, price: execPrice,
        pnlPct: entryPrice ? ((execPrice - entryPrice) / entryPrice) * 100 : null,
      });
      shares -= toSell;
      if (shares <= 1e-6) {
        shares = 0;
        position = 0;
        entryPrice = null;
      }
    }

    portfolio.push({ date: row.date, value: cash + shares * price });
  });

  return { portfolio, trades, costsPaid };
}

export function runTradingSimulation(points, signals, initialCapital, options = {}) {
  return runTradingSimulationDetailed(points, signals, initialCapital, options).portfolio;
}
```

- [ ] **Step 4: Run tests — pass**
- [ ] **Step 5: Commit** `feat: transaction costs, slippage and stop-loss in trading simulation`

---

### Task 7: Honest forecast models — drift / AR / Holt + volatility bands

**Files:**
- Rewrite: `backend/utils/predictions.js`
- Test: `backend/tests/predictions.test.js`

**Interfaces:**
- Produces:
  - `predictFuturePrices(points, indicator, model = 'drift', days = 60) -> [{date, value, lower, upper}]` (same call signature as today; legacy names `simple|arima|prophet` map to `drift|ar|holt`; returns `[]` for <10 valid closes or unknown model)
  - `FORECAST_MODEL_IDS = ['drift', 'ar', 'holt']`
  - `fitAR(series, p) -> { intercept, coefficients } | null`
  - `fitHolt(closes) -> { alpha, beta, level, trend, sse }`
  - `solveLinearSystem(A, b) -> number[] | null`
- Bands: 80% interval, `value * exp(±1.2816 * σ_dailyLogReturn * √h)`.

- [ ] **Step 1: Failing tests**

`backend/tests/predictions.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { fitAR, fitHolt, predictFuturePrices, solveLinearSystem } from '../utils/predictions.js';

const seeded = (seed) => {
  let v = seed;
  return () => {
    v = (v * 16807) % 2147483647;
    return (v - 1) / 2147483646;
  };
};

describe('solveLinearSystem', () => {
  it('solves a 2x2 system', () => {
    const x = solveLinearSystem([[2, 1], [1, 3]], [5, 10]);
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBeCloseTo(3, 6);
  });
});

describe('fitAR', () => {
  it('recovers phi≈0.5 from a synthetic AR(1) series', () => {
    const rand = seeded(42);
    const series = [0];
    for (let i = 1; i < 300; i += 1) {
      series.push(0.5 * series[i - 1] + (rand() - 0.5) * 0.02);
    }
    const fit = fitAR(series, 1);
    expect(fit.coefficients[0]).toBeGreaterThan(0.35);
    expect(fit.coefficients[0]).toBeLessThan(0.65);
  });
});

describe('fitHolt', () => {
  it('extrapolates a linear series', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const { level, trend } = fitHolt(closes);
    expect(level + trend).toBeCloseTo(160, 0);
  });
});

describe('predictFuturePrices', () => {
  const points = Array.from({ length: 120 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    close: 100 * Math.exp(0.001 * i),
  }));

  it.each(['drift', 'ar', 'holt'])('%s returns bands with lower<value<upper', (model) => {
    const out = predictFuturePrices(points, 'sma', model, 20);
    expect(out).toHaveLength(20);
    out.forEach((p) => {
      expect(p.lower).toBeLessThan(p.value);
      expect(p.upper).toBeGreaterThan(p.value);
    });
  });

  it('maps legacy model names', () => {
    expect(predictFuturePrices(points, 'sma', 'arima', 5)).toEqual(
      predictFuturePrices(points, 'sma', 'ar', 5),
    );
  });

  it('returns [] on insufficient data', () => {
    expect(predictFuturePrices(points.slice(0, 5), 'sma', 'drift', 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — FAIL (exports missing)**
- [ ] **Step 3: Implement** — full replacement of `backend/utils/predictions.js`:

```js
// Forecast models operating on daily closes. No model here sees future data;
// bands are volatility-derived, not fixed percentages.

import { addDays, formatISO } from 'date-fns';

const LEGACY_MODEL_MAP = { simple: 'drift', arima: 'ar', prophet: 'holt' };
export const FORECAST_MODEL_IDS = ['drift', 'ar', 'holt'];
const Z80 = 1.2816; // 80% two-sided confidence

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const stdDev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
};

const logReturns = (closes) => {
  const out = [];
  for (let i = 1; i < closes.length; i += 1) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
};

export function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

export function fitAR(series, p) {
  const n = series.length;
  if (p < 1 || n <= p + 2) return null;
  const k = p + 1;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let t = p; t < n; t += 1) {
    const x = [1];
    for (let j = 1; j <= p; j += 1) x.push(series[t - j]);
    for (let a = 0; a < k; a += 1) {
      Xty[a] += x[a] * series[t];
      for (let b = 0; b < k; b += 1) XtX[a][b] += x[a] * x[b];
    }
  }
  const beta = solveLinearSystem(XtX, Xty);
  if (!beta) return null;
  return { intercept: beta[0], coefficients: beta.slice(1) };
}

export function fitHolt(closes) {
  let best = null;
  for (let a = 1; a <= 9; a += 1) {
    for (let b = 1; b <= 9; b += 1) {
      const alpha = a / 10;
      const beta = b / 10;
      let level = closes[0];
      let trend = closes.length > 1 ? closes[1] - closes[0] : 0;
      let sse = 0;
      for (let i = 1; i < closes.length; i += 1) {
        sse += (closes[i] - (level + trend)) ** 2;
        const prevLevel = level;
        level = alpha * closes[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
      }
      if (!best || sse < best.sse) best = { alpha, beta, level, trend, sse };
    }
  }
  return best;
}

export function predictFuturePrices(points, _indicator = 'sma', model = 'drift', days = 60) {
  const resolved = LEGACY_MODEL_MAP[model] ?? model;
  const closes = points.map((row) => Number(row.close)).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length < 10 || !FORECAST_MODEL_IDS.includes(resolved)) return [];

  const horizon = Math.max(1, Math.min(365, Number(days) || 60));
  const lastDate = new Date(points[points.length - 1].date);
  const last = closes[closes.length - 1];
  const returns = logReturns(closes);
  const sigma = stdDev(returns);

  const values = [];
  if (resolved === 'holt') {
    const { level, trend } = fitHolt(closes);
    for (let h = 1; h <= horizon; h += 1) values.push(Math.max(0.01, level + h * trend));
  } else {
    let forecastReturns = null;
    if (resolved === 'ar') {
      const p = Math.min(5, Math.floor(returns.length / 20) || 1);
      const fit = fitAR(returns, p);
      if (fit) {
        const buf = returns.slice(-p);
        forecastReturns = [];
        for (let h = 1; h <= horizon; h += 1) {
          let r = fit.intercept;
          for (let j = 0; j < p; j += 1) r += fit.coefficients[j] * buf[buf.length - 1 - j];
          buf.push(r);
          forecastReturns.push(r);
        }
      }
    }
    if (!forecastReturns) {
      const mu = mean(returns);
      forecastReturns = Array.from({ length: horizon }, () => mu);
    }
    let price = last;
    forecastReturns.forEach((r) => {
      price *= Math.exp(r);
      values.push(price);
    });
  }

  return values.map((value, idx) => {
    const h = idx + 1;
    const band = Math.exp(Z80 * sigma * Math.sqrt(h));
    return {
      date: formatISO(addDays(lastDate, h), { representation: 'date' }),
      value,
      lower: value / band,
      upper: value * band,
    };
  });
}
```

- [ ] **Step 4: Run tests — pass**
- [ ] **Step 5: Commit** `feat: replace fake ARIMA/Prophet with real drift/AR/Holt models and volatility bands`

---

### Task 8: Walk-forward evaluation harness

**Files:**
- Create: `backend/utils/evaluation.js`
- Test: `backend/tests/evaluation.test.js`

**Interfaces:**
- Consumes: `predictFuturePrices`, `FORECAST_MODEL_IDS` (Task 7); `backtestStrategy`, `runTradingSimulationDetailed` (Task 6).
- Produces:
  - `walkForwardSplits(history, {folds=4, horizon=10, minTrain=60}) -> [{train, test}]` (rolling origin, chronological, non-overlapping test windows; throws if too short)
  - `forecastMetrics(predicted, actual, lastTrainClose) -> {mae, rmse, mape, directionalAccuracy}` (direction = sign of move from forecast origin)
  - `evaluateForecastModel(history, model, opts) -> {model, folds, horizon, mae, rmse, mape, directionalAccuracy}` (fold-averaged)
  - `evaluateNaiveBaseline(history, opts)` — flat last-close forecast; directionalAccuracy = share of "up" outcomes (always-up baseline)
  - `evaluateStrategy(history, indicator, {initialCapital=10000, trainFraction=0.7, transactionCostPct, slippagePct, stopLossPct}) -> {indicator, testBars, strategyReturn, buyHoldReturn, winRate, maxDrawdown, trades, costsPaid}`
  - `maxDrawdownPct(portfolio) -> number` (≤ 0, in %)

- [ ] **Step 1: Failing tests**

`backend/tests/evaluation.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  evaluateForecastModel,
  evaluateNaiveBaseline,
  evaluateStrategy,
  forecastMetrics,
  maxDrawdownPct,
  walkForwardSplits,
} from '../utils/evaluation.js';

const mkHistory = (n, fn) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
  close: fn(i),
  high: fn(i) * 1.01,
  low: fn(i) * 0.99,
  open: fn(i),
  volume: 1_000_000,
}));

describe('walkForwardSplits', () => {
  it('produces chronological non-overlapping test windows with no lookahead', () => {
    const history = mkHistory(120, (i) => 100 + i);
    const splits = walkForwardSplits(history, { folds: 3, horizon: 10, minTrain: 60 });
    expect(splits).toHaveLength(3);
    splits.forEach(({ train, test }) => {
      expect(test).toHaveLength(10);
      // no lookahead: last train row is strictly before first test row
      expect(new Date(train.at(-1).date) < new Date(test[0].date)).toBe(true);
    });
    // non-overlap: consecutive test windows are adjacent
    expect(splits[0].test.at(-1).date < splits[1].test[0].date).toBe(true);
  });

  it('throws when history is too short', () => {
    expect(() => walkForwardSplits(mkHistory(30, (i) => i), { folds: 4, horizon: 10 })).toThrow();
  });
});

describe('forecastMetrics', () => {
  it('computes mae/rmse/directional accuracy', () => {
    const m = forecastMetrics([11, 12], [10, 14], 10);
    expect(m.mae).toBeCloseTo(1.5, 6);
    expect(m.rmse).toBeCloseTo(Math.sqrt((1 + 4) / 2), 6);
    // day1 actual == origin (no direction, skipped); day2 both up → 1/1
    expect(m.directionalAccuracy).toBe(1);
  });
});

describe('evaluateForecastModel', () => {
  it('drift beats flat baseline on a pure exponential trend', () => {
    const history = mkHistory(200, (i) => 100 * Math.exp(0.002 * i));
    const drift = evaluateForecastModel(history, 'drift', { folds: 3, horizon: 10 });
    const naive = evaluateNaiveBaseline(history, { folds: 3, horizon: 10 });
    expect(drift.mae).toBeLessThan(naive.mae);
    expect(drift.directionalAccuracy).toBe(1);
  });
});

describe('evaluateStrategy', () => {
  it('reports strategy vs buy-and-hold on the held-out window', () => {
    const history = mkHistory(200, (i) => 100 + Math.sin(i / 6) * 12);
    const out = evaluateStrategy(history, 'rsi', {});
    expect(out.testBars).toBeGreaterThan(40);
    expect(typeof out.strategyReturn).toBe('number');
    expect(typeof out.buyHoldReturn).toBe('number');
    expect(out.maxDrawdown).toBeLessThanOrEqual(0);
  });
});

describe('maxDrawdownPct', () => {
  it('finds the deepest peak-to-trough drop', () => {
    const dd = maxDrawdownPct([{ value: 100 }, { value: 150 }, { value: 75 }, { value: 120 }]);
    expect(dd).toBeCloseTo(-50, 6);
  });
});
```

- [ ] **Step 2: Run — FAIL (module missing)**
- [ ] **Step 3: Implement** `backend/utils/evaluation.js`:

```js
// Walk-forward evaluation. Everything here is deliberately out-of-sample:
// a fold's model only ever sees that fold's train slice.

import { backtestStrategy, runTradingSimulationDetailed } from './backtesting.js';
import { predictFuturePrices } from './predictions.js';

export function walkForwardSplits(history, { folds = 4, horizon = 10, minTrain = 60 } = {}) {
  const n = history.length;
  const required = minTrain + folds * horizon;
  if (n < required) {
    throw new Error(`Need at least ${required} bars for ${folds} folds of horizon ${horizon}; got ${n}.`);
  }
  const splits = [];
  for (let k = folds; k >= 1; k -= 1) {
    const testEnd = n - (k - 1) * horizon;
    const testStart = testEnd - horizon;
    splits.push({ train: history.slice(0, testStart), test: history.slice(testStart, testEnd) });
  }
  return splits;
}

export function forecastMetrics(predicted, actual, lastTrainClose) {
  const n = Math.min(predicted.length, actual.length);
  if (n === 0 || !Number.isFinite(lastTrainClose)) {
    return { mae: null, rmse: null, mape: null, directionalAccuracy: null };
  }
  let absSum = 0;
  let sqSum = 0;
  let pctSum = 0;
  let pctCount = 0;
  let dirHits = 0;
  let dirCount = 0;
  for (let i = 0; i < n; i += 1) {
    const err = predicted[i] - actual[i];
    absSum += Math.abs(err);
    sqSum += err * err;
    if (actual[i] !== 0) {
      pctSum += Math.abs(err / actual[i]);
      pctCount += 1;
    }
    const actDir = Math.sign(actual[i] - lastTrainClose);
    if (actDir !== 0) {
      dirCount += 1;
      if (Math.sign(predicted[i] - lastTrainClose) === actDir) dirHits += 1;
    }
  }
  return {
    mae: absSum / n,
    rmse: Math.sqrt(sqSum / n),
    mape: pctCount ? (pctSum / pctCount) * 100 : null,
    directionalAccuracy: dirCount ? dirHits / dirCount : null,
  };
}

function averageMetrics(perFold) {
  const avg = (key) => {
    const vals = perFold.map((f) => f[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    mae: avg('mae'),
    rmse: avg('rmse'),
    mape: avg('mape'),
    directionalAccuracy: avg('directionalAccuracy'),
  };
}

export function evaluateForecastModel(history, model, { folds = 4, horizon = 10, minTrain = 60 } = {}) {
  const splits = walkForwardSplits(history, { folds, horizon, minTrain });
  const perFold = splits.map(({ train, test }) => {
    const lastTrainClose = Number(train.at(-1).close);
    const predicted = predictFuturePrices(train, 'sma', model, horizon).map((p) => p.value);
    const actual = test.map((r) => Number(r.close));
    return forecastMetrics(predicted, actual, lastTrainClose);
  });
  return { model, folds: perFold.length, horizon, ...averageMetrics(perFold) };
}

export function evaluateNaiveBaseline(history, { folds = 4, horizon = 10, minTrain = 60 } = {}) {
  const splits = walkForwardSplits(history, { folds, horizon, minTrain });
  const perFold = splits.map(({ train, test }) => {
    const last = Number(train.at(-1).close);
    const actual = test.map((r) => Number(r.close));
    const base = forecastMetrics(actual.map(() => last), actual, last);
    // Flat forecasts have no direction; report the always-up baseline instead.
    let up = 0;
    let count = 0;
    actual.forEach((a) => {
      if (a !== last) {
        count += 1;
        if (a > last) up += 1;
      }
    });
    return { ...base, directionalAccuracy: count ? up / count : null };
  });
  return { model: 'naive', folds: perFold.length, horizon, ...averageMetrics(perFold) };
}

export function maxDrawdownPct(portfolio) {
  let peak = -Infinity;
  let maxDd = 0;
  portfolio.forEach(({ value }) => {
    if (value > peak) peak = value;
    if (peak > 0) maxDd = Math.min(maxDd, (value - peak) / peak);
  });
  return maxDd * 100;
}

export function evaluateStrategy(history, indicator, {
  initialCapital = 10000,
  trainFraction = 0.7,
  transactionCostPct = 0.001,
  slippagePct = 0.0005,
  stopLossPct = null,
} = {}) {
  if (history.length < 40) throw new Error('Need at least 40 bars to evaluate a strategy.');
  const splitIdx = Math.floor(history.length * trainFraction);
  // Indicators in this codebase are strictly backward-looking, so computing
  // signals over the full series uses no future data at any bar; only the
  // held-out window is simulated.
  const { signals } = backtestStrategy(history, indicator);
  const testHistory = history.slice(splitIdx);
  const testSignals = signals.slice(splitIdx);
  const { portfolio, trades, costsPaid } = runTradingSimulationDetailed(
    testHistory, testSignals, initialCapital,
    { transactionCostPct, slippagePct, stopLossPct },
  );
  const finalValue = portfolio.at(-1)?.value ?? initialCapital;
  const firstClose = Number(testHistory[0].close);
  const lastClose = Number(testHistory.at(-1).close);
  const exits = trades.filter((t) => t.type === 'sell' || t.type === 'stop');
  const wins = exits.filter((t) => (t.pnlPct ?? 0) > 0).length;
  return {
    indicator,
    testBars: testHistory.length,
    strategyReturn: ((finalValue - initialCapital) / initialCapital) * 100,
    buyHoldReturn: firstClose ? ((lastClose - firstClose) / firstClose) * 100 : null,
    winRate: exits.length ? wins / exits.length : null,
    maxDrawdown: maxDrawdownPct(portfolio),
    trades: trades.length,
    costsPaid,
  };
}
```

- [ ] **Step 4: Run tests — pass**
- [ ] **Step 5: Commit** `feat: walk-forward evaluation harness (forecast metrics + strategy vs buy-and-hold)`

---

### Task 9: Directional classifier

**Files:**
- Create: `backend/utils/classifier.js`
- Test: `backend/tests/classifier.test.js`

**Interfaces:**
- Consumes: `calculateMACD`, `calculateRSI` from `indicators.js`.
- Produces:
  - `buildDataset(history, horizon=5) -> {X: number[][], y: (0|1)[]}` (features: ret1, ret5, rsi/100−0.5, macdDiv/close, vol10, volRatio; rows start at index 30)
  - `latestFeatureRow(history) -> number[] | null`
  - `trainLogistic(X, y, {epochs=300, learningRate=0.1, l2=0.001}) -> {weights, bias, means, stds}` (standardizes internally)
  - `predictProba(model, row) -> number` (0..1)
  - `directionalForecast(history, {horizon=5, testFraction=0.25}) -> {horizon, probUp, accuracy, testSamples, baselineUpShare} | null` (null when < 60 usable rows; train slice is embargoed `horizon` rows before the test slice to avoid label leakage)

- [ ] **Step 1: Failing tests**

`backend/tests/classifier.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildDataset, directionalForecast, predictProba, trainLogistic } from '../utils/classifier.js';

// Momentum regime series: 20 bars up 1%, then 20 bars down 1%, repeated.
// ret1/ret5 are strongly informative for the 5-day-ahead label.
const mkMomentumHistory = (n) => {
  let price = 100;
  return Array.from({ length: n }, (_, i) => {
    const up = Math.floor(i / 20) % 2 === 0;
    price *= up ? 1.01 : 0.99;
    return {
      date: new Date(Date.UTC(2023, 0, 1 + i)).toISOString(),
      close: price,
      high: price * 1.005,
      low: price * 0.995,
      open: price,
      volume: 1_000_000 + (i % 7) * 10_000,
    };
  });
};

describe('buildDataset', () => {
  it('builds finite feature rows with binary labels', () => {
    const { X, y } = buildDataset(mkMomentumHistory(300), 5);
    expect(X.length).toBeGreaterThan(200);
    expect(X.length).toBe(y.length);
    X.forEach((row) => {
      expect(row).toHaveLength(6);
      row.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    });
    y.forEach((label) => expect([0, 1]).toContain(label));
  });
});

describe('trainLogistic + predictProba', () => {
  it('learns a separable pattern', () => {
    const X = Array.from({ length: 200 }, (_, i) => [i < 100 ? -1 : 1, 0, 0, 0, 0, 0]);
    const y = Array.from({ length: 200 }, (_, i) => (i < 100 ? 0 : 1));
    const model = trainLogistic(X, y);
    expect(predictProba(model, [1, 0, 0, 0, 0, 0])).toBeGreaterThan(0.7);
    expect(predictProba(model, [-1, 0, 0, 0, 0, 0])).toBeLessThan(0.3);
  });
});

describe('directionalForecast', () => {
  it('beats coin-flip on a strong momentum series and reports accuracy', () => {
    const out = directionalForecast(mkMomentumHistory(400), { horizon: 5 });
    expect(out).not.toBeNull();
    expect(out.probUp).toBeGreaterThanOrEqual(0);
    expect(out.probUp).toBeLessThanOrEqual(1);
    expect(out.accuracy).toBeGreaterThan(0.55);
  });

  it('returns null on insufficient history', () => {
    expect(directionalForecast(mkMomentumHistory(50), { horizon: 5 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** `backend/utils/classifier.js`:

```js
// Logistic-regression direction classifier. Deliberately simple and honest:
// its walk-forward accuracy is computed on an embargoed held-out tail and is
// always returned alongside the probability.

import { calculateMACD, calculateRSI } from './indicators.js';

export const FEATURE_NAMES = ['ret1', 'ret5', 'rsi', 'macdDiv', 'vol10', 'volRatio'];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const stdDev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
};

function buildContext(history) {
  const closes = history.map((r) => Number(r.close));
  const volumes = history.map((r) => Number(r.volume) || 0);
  const rsi = calculateRSI(history);
  const { macd, signal } = calculateMACD(history);
  return { closes, volumes, rsi, macd, signal };
}

function featureRowAt(t, ctx) {
  const { closes, volumes, rsi, macd, signal } = ctx;
  if (t < 30 || !Number.isFinite(closes[t]) || closes[t] <= 0) return null;
  const ret1 = Math.log(closes[t] / closes[t - 1]);
  const ret5 = Math.log(closes[t] / closes[t - 5]);
  const rsiVal = rsi[t];
  const macdDiv = macd[t] != null && signal[t] != null ? macd[t] - signal[t] : null;
  if (rsiVal == null || macdDiv == null) return null;
  const rets10 = [];
  for (let j = t - 9; j <= t; j += 1) rets10.push(Math.log(closes[j] / closes[j - 1]));
  const vol10 = stdDev(rets10);
  const avgVol20 = mean(volumes.slice(t - 19, t + 1));
  const volRatio = avgVol20 > 0 ? volumes[t] / avgVol20 - 1 : 0;
  const row = [ret1, ret5, rsiVal / 100 - 0.5, macdDiv / closes[t], vol10, volRatio];
  return row.every(Number.isFinite) ? row : null;
}

export function buildDataset(history, horizon = 5) {
  const ctx = buildContext(history);
  const X = [];
  const y = [];
  for (let t = 30; t + horizon < history.length; t += 1) {
    const row = featureRowAt(t, ctx);
    if (!row) continue;
    X.push(row);
    y.push(ctx.closes[t + horizon] > ctx.closes[t] ? 1 : 0);
  }
  return { X, y };
}

export function latestFeatureRow(history) {
  return featureRowAt(history.length - 1, buildContext(history));
}

export function trainLogistic(X, y, { epochs = 300, learningRate = 0.1, l2 = 0.001 } = {}) {
  const dims = X[0].length;
  const means = Array.from({ length: dims }, (_, j) => mean(X.map((r) => r[j])));
  const stds = Array.from({ length: dims }, (_, j) => stdDev(X.map((r) => r[j])) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));
  const n = Z.length;
  const weights = new Array(dims).fill(0);
  let bias = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradW = new Array(dims).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      const s = bias + Z[i].reduce((acc, v, j) => acc + v * weights[j], 0);
      const p = 1 / (1 + Math.exp(-s));
      const err = p - y[i];
      for (let j = 0; j < dims; j += 1) gradW[j] += err * Z[i][j];
      gradB += err;
    }
    for (let j = 0; j < dims; j += 1) {
      weights[j] -= learningRate * (gradW[j] / n + l2 * weights[j]);
    }
    bias -= learningRate * (gradB / n);
  }
  return { weights, bias, means, stds };
}

export function predictProba(model, row) {
  const s = model.bias + row.reduce(
    (acc, v, j) => acc + ((v - model.means[j]) / model.stds[j]) * model.weights[j],
    0,
  );
  return 1 / (1 + Math.exp(-s));
}

export function directionalForecast(history, { horizon = 5, testFraction = 0.25 } = {}) {
  const { X, y } = buildDataset(history, horizon);
  if (X.length < 60) return null;
  const testStart = Math.floor(X.length * (1 - testFraction));
  // Embargo: drop the last `horizon` train rows, whose labels peek into the test window.
  const trainEnd = Math.max(1, testStart - horizon);
  const model = trainLogistic(X.slice(0, trainEnd), y.slice(0, trainEnd));
  let hits = 0;
  for (let i = testStart; i < X.length; i += 1) {
    if ((predictProba(model, X[i]) >= 0.5 ? 1 : 0) === y[i]) hits += 1;
  }
  const testSamples = X.length - testStart;
  const finalModel = trainLogistic(X, y);
  const latest = latestFeatureRow(history);
  return {
    horizon,
    probUp: latest ? predictProba(finalModel, latest) : null,
    accuracy: hits / testSamples,
    testSamples,
    baselineUpShare: mean(y.slice(testStart)),
  };
}
```

- [ ] **Step 4: Run tests — pass**
- [ ] **Step 5: Commit** `feat: logistic-regression directional classifier with embargoed holdout accuracy`

---

### Task 10: Stable narrative + ensemble conviction in computeSignals

**Files:**
- Modify: `backend/utils/indicators.js` (export `ema`)
- Modify: `backend/utils/computeSignals.js`
- Test: `backend/tests/computeSignals.test.js`

**Interfaces:**
- Consumes: `directionalForecast` (Task 9), `runTradingSimulationDetailed` (Task 6), band-shaped forecast (Task 7).
- Produces (added to the insights payload returned by `computeSignals`):
  - `conviction: {score: number(-1..1), label: 'Strong Buy'|'Buy'|'Neutral'|'Sell'|'Strong Sell', votes: {sma, rsi, macd, bollinger, stochastic, adx}}`
  - `directional: {...} | null` (from `directionalForecast`, horizon 5)
  - `priceTargets` now `{base, optimistic, conservative}` from the last forecast point's `{value, upper, lower}`
  - `simulationSummary` gains `trades` and `costsPaid`
  - Exported helpers for tests: `computeConvictionScore(history)`, `confirmedState(series, predicate, n=2)`
- `indicators.js` additionally exports `ema(values, period)`.

- [ ] **Step 1: Failing tests**

`backend/tests/computeSignals.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { computeConvictionScore, confirmedState } from '../utils/computeSignals.js';

const mk = (closes) => closes.map((c, i) => ({
  date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
  close: c, high: c * 1.01, low: c * 0.99, open: c, volume: 1_000_000,
}));

describe('confirmedState', () => {
  it('needs n consecutive confirmations', () => {
    expect(confirmedState([60, 65, 72], (v) => v >= 70, 2)).toBe(false); // one bar only
    expect(confirmedState([60, 71, 72], (v) => v >= 70, 2)).toBe(true);
    expect(confirmedState([72, null, 71], (v) => v >= 70, 2)).toBe(true); // nulls skipped
  });
});

describe('computeConvictionScore', () => {
  it('is bearish after a sustained selloff', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 200 - i * 1.5);
    const { score, label, votes } = computeConvictionScore(mk(closes));
    expect(score).toBeLessThan(0);
    expect(['Sell', 'Strong Sell', 'Neutral']).toContain(label);
    expect(votes.sma).toBe(-1);
  });

  it('score stays within [-1, 1] and exposes all six votes', () => {
    const { score, votes } = computeConvictionScore(mk(Array.from({ length: 80 }, (_, i) => 100 + i)));
    expect(score).toBeGreaterThanOrEqual(-1);
    expect(score).toBeLessThanOrEqual(1);
    expect(Object.keys(votes).sort()).toEqual(['adx', 'bollinger', 'macd', 'rsi', 'sma', 'stochastic']);
  });
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**

In `backend/utils/indicators.js`, change `const ema = (values, period) => {` to `export const ema = (values, period) => {`.

In `backend/utils/computeSignals.js`:

1. Import additions:

```js
import {
  calculateADX, calculateBollingerBands, calculateMACD, calculateRSI,
  calculateSMA, calculateStochasticOscillator, calculateVWAP, ema,
} from './indicators.js';
import { directionalForecast } from './classifier.js';
import { backtestStrategy, runTradingSimulationDetailed } from './backtesting.js';
```

2. New exported helpers:

```js
// A qualitative state only flips after the (smoothed) indicator confirms it
// for `n` consecutive sessions — one noisy bar can't rewrite the narrative.
export function confirmedState(series, predicate, n = 2) {
  const tail = series.filter((v) => v != null).slice(-n);
  return tail.length === n && tail.every(predicate);
}

export function computeConvictionScore(history) {
  const close = Number(history.at(-1)?.close);
  const sma = calculateSMA(history).at(-1);
  const rsiSmoothed = ema(calculateRSI(history), 3).at(-1);
  const { macd, signal } = calculateMACD(history);
  const macdDiv = macd.at(-1) != null && signal.at(-1) != null ? macd.at(-1) - signal.at(-1) : null;
  const bands = calculateBollingerBands(history);
  const { percentK } = calculateStochasticOscillator(history);
  const { adx, plusDI, minusDI } = calculateADX(history);
  const k = percentK.at(-1);

  const votes = {
    sma: sma != null && Number.isFinite(close) ? (close > sma ? 1 : -1) : 0,
    rsi: rsiSmoothed == null ? 0 : rsiSmoothed < 30 ? 1 : rsiSmoothed > 70 ? -1 : 0,
    macd: macdDiv == null ? 0 : macdDiv > 0 ? 1 : -1,
    bollinger: bands.upper.at(-1) == null || !Number.isFinite(close) ? 0
      : close < bands.lower.at(-1) ? 1 : close > bands.upper.at(-1) ? -1 : 0,
    stochastic: k == null ? 0 : k < 20 ? 1 : k > 80 ? -1 : 0,
    adx: adx.at(-1) == null || adx.at(-1) < 25 ? 0
      : (plusDI.at(-1) ?? 0) > (minusDI.at(-1) ?? 0) ? 1 : -1,
  };
  const weights = { sma: 0.2, rsi: 0.2, macd: 0.2, bollinger: 0.15, stochastic: 0.15, adx: 0.1 };
  const score = Object.entries(votes).reduce((acc, [key, vote]) => acc + weights[key] * vote, 0);
  const label = score >= 0.5 ? 'Strong Buy'
    : score >= 0.2 ? 'Buy'
      : score > -0.2 ? 'Neutral'
        : score > -0.5 ? 'Sell' : 'Strong Sell';
  return { score: Number(score.toFixed(3)), label, votes };
}
```

3. `buildTechnicalSummary` — change signature to `buildTechnicalSummary({ history, indicatorSnapshots, momentum, signalSummary, priceTargets, conviction })` and replace the RSI/ADX single-bar checks:

```js
const rsiSeries = ema(calculateRSI(history), 3);
const rsiLatest = indicatorSnapshots?.rsi;
if (rsiLatest != null) {
  if (confirmedState(rsiSeries, (v) => v >= 70)) {
    parts.push(`RSI has held overbought for 2+ sessions (now ${formatNumber(rsiLatest)}).`);
  } else if (confirmedState(rsiSeries, (v) => v <= 30)) {
    parts.push(`RSI has held oversold for 2+ sessions (now ${formatNumber(rsiLatest)}).`);
  } else {
    parts.push(`RSI is neutral/unconfirmed at ${formatNumber(rsiLatest)}.`);
  }
}
// ADX: replace `if (adxValue >= 25)` with a confirmed check
const adxSeries = calculateADX(history).adx;
if (adxValue != null) {
  if (confirmedState(adxSeries, (v) => v >= 25)) {
    parts.push(`ADX ${formatNumber(adxValue)} confirms a trending market (2+ sessions).`);
  } else {
    parts.push(`ADX ${formatNumber(adxValue)} — trend not yet confirmed.`);
  }
  // (+DI/−DI sentence unchanged)
}
// Append at the end:
if (conviction) {
  parts.push(`Ensemble conviction: ${conviction.label} (score ${conviction.score >= 0 ? '+' : ''}${conviction.score}).`);
}
```

4. In `computeSignals` main body:

```js
// replace: const simulation = runTradingSimulation(history, signals, initialCapital);
const { portfolio: simulation, trades, costsPaid } = runTradingSimulationDetailed(
  history, signals, initialCapital, {},
);
// ...
const conviction = computeConvictionScore(history);
let directional = null;
try {
  directional = directionalForecast(history, { horizon: 5 });
} catch {
  directional = null;
}
const priceTargets = prediction.length
  ? {
      base: prediction.at(-1).value,
      optimistic: prediction.at(-1).upper,
      conservative: prediction.at(-1).lower,
    }
  : null;
const technicalSummary = buildTechnicalSummary({
  history, indicatorSnapshots, momentum, signalSummary: summary, priceTargets, conviction,
});
```

and extend the returned object + summary:

```js
simulationSummary: { initialCapital, finalValue, totalReturn, trades: trades.length, costsPaid },
conviction,
directional,
```

(remove the old `clamp`-based `priceTargets` and the now-unused `clamp` helper).

- [ ] **Step 4: Run full backend test suite — pass**
- [ ] **Step 5: Commit** `feat: ensemble conviction score and 2-session confirmation for narrative labels`

---

### Task 11: /api/analytics/evaluate endpoint

**Files:**
- Modify: `backend/routes/analytics.js`
- Test: `backend/tests/evaluateRoute.test.js`

**Interfaces:**
- Consumes: `evaluateForecastModel`, `evaluateNaiveBaseline`, `evaluateStrategy` (Task 8), `FORECAST_MODEL_IDS` (Task 7), `directionalForecast` (Task 9), `fetchYahooHistory`.
- Produces: `GET /api/analytics/evaluate?symbol&range=2y&interval=1d&indicator=sma&horizon=10&folds=4` →
  `{symbol, range, horizon, folds, forecasts: [...], baseline: {...}, strategy: {...}, directional: {...}|null}` (horizon clamped 3–30, folds 2–8).

- [ ] **Step 1: Failing test** — `backend/tests/evaluateRoute.test.js` (mock market data so no network):

```js
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../utils/marketData.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    fetchYahooHistory: vi.fn(async () => Array.from({ length: 250 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      close: 100 * Math.exp(0.001 * i) * (1 + 0.01 * Math.sin(i / 5)),
      high: 101, low: 99, open: 100,
      volume: 1_000_000,
      source: 'yahoo',
    }))),
  };
});

const app = (await import('../index.js')).default;

describe('GET /api/analytics/evaluate', () => {
  it('400 without symbol', async () => {
    const res = await request(app).get('/api/analytics/evaluate');
    expect(res.status).toBe(400);
  });

  it('returns forecast table, baseline, strategy and directional block', async () => {
    const res = await request(app).get('/api/analytics/evaluate?symbol=TEST&horizon=10&folds=3');
    expect(res.status).toBe(200);
    expect(res.body.forecasts.map((f) => f.model).sort()).toEqual(['ar', 'drift', 'holt']);
    expect(res.body.baseline.model).toBe('naive');
    expect(res.body.strategy.indicator).toBe('sma');
    expect(res.body.forecasts[0].mae).toBeTypeOf('number');
  });
});
```

- [ ] **Step 2: Run — FAIL (404)**
- [ ] **Step 3: Implement** — in `backend/routes/analytics.js`:

```js
import { evaluateForecastModel, evaluateNaiveBaseline, evaluateStrategy } from '../utils/evaluation.js';
import { FORECAST_MODEL_IDS } from '../utils/predictions.js';
import { directionalForecast } from '../utils/classifier.js';
// ...
router.get('/evaluate', async (req, res) => {
  try {
    const { symbol, range = '2y', interval = '1d', indicator = 'sma' } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Query parameter "symbol" is required.' });
    }
    const horizon = Math.min(30, Math.max(3, Number(req.query.horizon) || 10));
    const folds = Math.min(8, Math.max(2, Number(req.query.folds) || 4));
    const history = await fetchYahooHistory(symbol, range, interval);

    const forecasts = FORECAST_MODEL_IDS.map((model) =>
      evaluateForecastModel(history, model, { folds, horizon }));
    const baseline = evaluateNaiveBaseline(history, { folds, horizon });
    const strategy = evaluateStrategy(history, indicator, {});
    let directional = null;
    try {
      directional = directionalForecast(history, { horizon: 5 });
    } catch {
      directional = null;
    }

    res.json({ symbol, range, horizon, folds, forecasts, baseline, strategy, directional });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

- [ ] **Step 4: Run tests — pass**
- [ ] **Step 5: Commit** `feat: walk-forward model evaluation endpoint`

---

### Task 12: Frontend — honest model names, conviction, bands, directional display

**Files:**
- Modify: `frontend/src/components/Dashboard.jsx`
- Modify: `frontend/src/components/StockChart.jsx`
- Modify: `frontend/src/services/api.js` (add `getEvaluation`)

**Interfaces:**
- Consumes: insights payload fields `conviction`, `directional`, `forecast[].lower/upper` (Tasks 10/7); evaluate endpoint (Task 11).
- Produces: `getEvaluation(symbol, {range, indicator, horizon, folds})` in api.js; chart rows carry `forecastLower`/`forecastUpper`.

- [ ] **Step 1: api.js**

```js
export function getEvaluation(symbol, options = {}) {
  const params = new URLSearchParams({ symbol });
  Object.entries(options).forEach(([key, value]) => {
    if (value == null || value === '') return;
    params.set(key, value);
  });
  return request(`/api/analytics/evaluate?${params.toString()}`);
}
```

- [ ] **Step 2: Dashboard.jsx**

1. Rename models:

```js
const FORECAST_MODELS = [
  { label: 'Drift (mean return)', value: 'drift' },
  { label: 'Autoregressive (AR)', value: 'ar' },
  { label: 'Holt Exp. Smoothing', value: 'holt' },
];
```

and `useState('drift')` for `forecastModel`.

2. New state + wiring in `applyInsights`:

```js
const [conviction, setConviction] = useState(null);
const [directional, setDirectional] = useState(null);
// in applyInsights(payload): setConviction(payload.conviction ?? null); setDirectional(payload.directional ?? null);
// in the null branch: setConviction(null); setDirectional(null);
```

3. `chartData` forecast rows gain bands:

```js
base.push({
  date: point.date,
  close: index === 0 && lastClose != null ? lastClose : null,
  high: null, low: null, open: null, volume: null,
  forecast: point.value,
  forecastLower: point.lower ?? null,
  forecastUpper: point.upper ?? null,
  isForecast: true,
});
```

4. Conviction/directional cards — insert directly under the Technical Snapshot section:

```jsx
{conviction ? (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <p className="text-xs uppercase tracking-wide text-slate-400">Ensemble Conviction</p>
      <p className={`mt-1 text-2xl font-semibold ${conviction.score >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
        {conviction.label}
      </p>
      <p className="text-xs text-slate-400">
        Score {conviction.score >= 0 ? '+' : ''}{conviction.score} · weighted vote across 6 indicators
      </p>
    </div>
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <p className="text-xs uppercase tracking-wide text-slate-400">5-Day Direction (model)</p>
      <p className="mt-1 text-2xl font-semibold text-white">
        {directional?.probUp != null ? `${(directional.probUp * 100).toFixed(0)}% up` : '--'}
      </p>
      <p className="text-xs text-slate-400">
        {directional
          ? `Holdout accuracy ${(directional.accuracy * 100).toFixed(0)}% on ${directional.testSamples} samples`
          : 'Insufficient history for the classifier.'}
      </p>
    </div>
  </div>
) : null}
```

5. Forecast Highlights: change copy to `Bands are an 80% confidence interval derived from historical volatility.` and relabel Optimistic/Conservative → `Upper band` / `Lower band` (values unchanged — they now come from `priceTargets.optimistic/conservative` which map to band edges).

- [ ] **Step 3: StockChart.jsx** — next to the existing forecast `<Line>`, add:

```jsx
{forecastStartIndex > -1 ? (
  <>
    <Line type="monotone" dataKey="forecastUpper" yAxisId="price" stroke="#94a3b8"
      strokeWidth={1} strokeDasharray="2 4" dot={false} name="Forecast Upper" />
    <Line type="monotone" dataKey="forecastLower" yAxisId="price" stroke="#94a3b8"
      strokeWidth={1} strokeDasharray="2 4" dot={false} name="Forecast Lower" />
  </>
) : null}
```

- [ ] **Step 4: `npm run lint` + `npm run build` — pass**
- [ ] **Step 5: Commit** `feat: conviction, directional probability and volatility bands in dashboard`

---

### Task 13: Frontend — Model Evaluation panel in Advanced Lab

**Files:**
- Modify: `frontend/src/components/AdvancedBacktest.jsx`

**Interfaces:**
- Consumes: `getEvaluation` (Task 12).

- [ ] **Step 1: Implement** — add state + handler + section inside `AdvancedBacktest`:

```jsx
import { getEvaluation, getHistory } from '../services/api';
// ...
const [evalLoading, setEvalLoading] = useState(false);
const [evalError, setEvalError] = useState(null);
const [evaluation, setEvaluation] = useState(null);

const handleEvaluate = async () => {
  setEvalLoading(true);
  setEvalError(null);
  try {
    setEvaluation(await getEvaluation(ticker, { range: period, indicator }));
  } catch (err) {
    setEvalError(err instanceof Error ? err.message : 'Evaluation failed.');
  } finally {
    setEvalLoading(false);
  }
};
```

Button next to "Run Advanced Backtest":

```jsx
<button type="button" onClick={handleEvaluate} disabled={evalLoading}
  className="w-full rounded-lg border border-blue-500/60 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60">
  {evalLoading ? 'Evaluating…' : 'Evaluate Models (walk-forward)'}
</button>
```

New section under the results section:

```jsx
{evalError ? <p className="text-sm text-red-400">{evalError}</p> : null}
{evaluation ? (
  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
    <h3 className="text-lg font-semibold text-white">Walk-Forward Model Evaluation</h3>
    <p className="mt-1 text-xs text-slate-400">
      {evaluation.folds} folds · {evaluation.horizon}-day horizon · out-of-sample. Lower MAE/RMSE/MAPE is better; directional accuracy above the naive row means the model adds signal.
    </p>
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
        <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-2 text-left">Model</th>
            <th className="px-4 py-2 text-right">MAE</th>
            <th className="px-4 py-2 text-right">RMSE</th>
            <th className="px-4 py-2 text-right">MAPE</th>
            <th className="px-4 py-2 text-right">Direction</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {[...evaluation.forecasts, evaluation.baseline].map((row) => (
            <tr key={row.model}>
              <td className="px-4 py-2 font-semibold text-white">{row.model}</td>
              <td className="px-4 py-2 text-right">{row.mae != null ? row.mae.toFixed(2) : '—'}</td>
              <td className="px-4 py-2 text-right">{row.rmse != null ? row.rmse.toFixed(2) : '—'}</td>
              <td className="px-4 py-2 text-right">{row.mape != null ? `${row.mape.toFixed(1)}%` : '—'}</td>
              <td className="px-4 py-2 text-right">
                {row.directionalAccuracy != null ? `${(row.directionalAccuracy * 100).toFixed(0)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mt-4 grid gap-4 md:grid-cols-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Strategy (OOS)</p>
        <p className="mt-1 text-lg font-semibold text-white">{evaluation.strategy.strategyReturn.toFixed(2)}%</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Buy & Hold (OOS)</p>
        <p className="mt-1 text-lg font-semibold text-white">
          {evaluation.strategy.buyHoldReturn != null ? `${evaluation.strategy.buyHoldReturn.toFixed(2)}%` : '—'}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Win Rate</p>
        <p className="mt-1 text-lg font-semibold text-white">
          {evaluation.strategy.winRate != null ? `${(evaluation.strategy.winRate * 100).toFixed(0)}%` : '—'}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Max Drawdown</p>
        <p className="mt-1 text-lg font-semibold text-red-400">{evaluation.strategy.maxDrawdown.toFixed(2)}%</p>
      </div>
    </div>
    {evaluation.directional ? (
      <p className="mt-4 text-xs text-slate-400">
        Direction classifier: {(evaluation.directional.probUp * 100).toFixed(0)}% up over next {evaluation.directional.horizon} days ·
        holdout accuracy {(evaluation.directional.accuracy * 100).toFixed(0)}% vs {(evaluation.directional.baselineUpShare * 100).toFixed(0)}% always-up baseline.
      </p>
    ) : null}
  </section>
) : null}
```

- [ ] **Step 2: `npm run lint` + `npm run build` — pass**
- [ ] **Step 3: Commit** `feat: walk-forward evaluation panel in Advanced Lab`

---

### Task 14: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Update README: auth requirements for metadata/chat endpoints, rate limits, new `/api/analytics/evaluate` endpoint, honest model names (drift/ar/holt + legacy aliases), conviction/directional payload fields, note that price targets are 80% volatility bands. Remove the claim that arima/prophet models exist.
- [ ] **Step 2: Commit** `docs: document auth, rate limits, evaluation endpoint and honest forecast models`

---

### Task 15: Final verification

- [ ] **Step 1:** `cd backend && npm test` — all suites pass.
- [ ] **Step 2:** `cd frontend && npm run lint && npm run build` — clean.
- [ ] **Step 3:** Manual smoke with dev servers: login flow untouched; `/api/analytics/metadata/manual` returns 401 via `curl -X POST` without token; insights payload contains `conviction`, `directional`, banded `forecast`.
- [ ] **Step 4:** QA review agents (code-reviewer) over the full branch diff; fix findings; re-run tests.
- [ ] **Step 5:** Push branch `feature/analytics-rebuild` for user review.
