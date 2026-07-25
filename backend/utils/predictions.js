// Forecast models operating on daily closes. No model here sees future data;
// bands are volatility-derived, not fixed percentages.

import { addDays, formatISO } from 'date-fns';

const LEGACY_MODEL_MAP = { simple: 'drift', arima: 'ar', prophet: 'holt' };
// Deterministic models used for walk-forward evaluation / accountability.
export const FORECAST_MODEL_IDS = ['drift', 'ar', 'holt'];
// All models predictFuturePrices can produce, including the stochastic
// Monte Carlo GBM forecast (which isn't part of walk-forward evaluation).
const SUPPORTED_MODEL_IDS = [...FORECAST_MODEL_IDS, 'montecarlo'];
const Z80 = 1.2816; // 80% two-sided confidence

const getClose = (row) => Number(row.close);

// ---------------------------------------------------------------------------
// Shared statistical helpers (from remote's real model implementations)
// ---------------------------------------------------------------------------
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

// Fit AR(p) via OLS on the normal equations: x_t = c + φ1·x_{t-1} + … + φp·x_{t-p}.
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

// Holt's linear exponential smoothing; α/β chosen by grid search on
// one-step-ahead MSE over the training series.
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

// ---------------------------------------------------------------------------
// Monte Carlo helpers (from HEAD — GBM forecast with confidence bands)
// ---------------------------------------------------------------------------
function computeHistoricalVol(closes) {
  if (closes.length < 2) return { dailyVol: 0, meanReturn: 0 };
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - m) ** 2, 0) / returns.length;
  return { dailyVol: Math.sqrt(variance), meanReturn: m };
}

function addBands(value, dailyVol, t) {
  // Math.abs(value) guards against inverted bands when a forecast dips negative.
  const spread = dailyVol * Math.sqrt(t) * Math.abs(value);
  return {
    lower68: Math.max(0, value - spread),
    upper68: value + spread,
    lower95: Math.max(0, value - 2 * spread),
    upper95: value + 2 * spread,
  };
}

function boxMullerNormal() {
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function buildDates(lastDate, days) {
  return Array.from({ length: days }, (_, i) =>
    formatISO(addDays(lastDate, i + 1), { representation: 'date' })
  );
}

function percentileAt(sorted, p) {
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[Math.min(idx, sorted.length - 1)];
}

// Return the forecast as a bare array (the public contract the test suite and
// route handlers depend on) while attaching the Monte Carlo `forecastCloud`
// and `forecastVol` as non-enumerable metadata. This keeps `toEqual([...])`
// deep-equality clean while letting computeSignals read `forecast.forecastCloud`.
function withMeta(forecast, forecastCloud = null, forecastVol = null) {
  Object.defineProperty(forecast, 'forecastCloud', { value: forecastCloud, enumerable: false });
  Object.defineProperty(forecast, 'forecastVol', { value: forecastVol, enumerable: false });
  return forecast;
}

// ---------------------------------------------------------------------------
// Forecast entry point. Returns an array of forecast points, with
// `.forecastCloud` / `.forecastVol` attached as non-enumerable metadata.
// ---------------------------------------------------------------------------
export function predictFuturePrices(points, _indicator = 'sma', model = 'drift', days = 60) {
  const resolved = LEGACY_MODEL_MAP[model] ?? model;

  const closes = points.map(getClose).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length < 10 || !SUPPORTED_MODEL_IDS.includes(resolved)) return [];

  const horizon = Math.max(1, Math.min(365, Number(days) || 60));

  // Anchor the forecast dates at the last bar with a valid close so the
  // series doesn't jump when trailing bars carry null/zero closes.
  let lastDate = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const c = Number(points[i].close);
    if (Number.isFinite(c) && c > 0) {
      lastDate = new Date(points[i].date);
      break;
    }
  }
  if (!lastDate) return [];

  const { dailyVol, meanReturn } = computeHistoricalVol(closes);

  // Monte Carlo GBM forecast with percentile confidence cloud.
  if (resolved === 'montecarlo') {
    const N_PATHS = 300;
    const lastPrice = closes[closes.length - 1];
    const drift = meanReturn - 0.5 * dailyVol ** 2;
    const dates = buildDates(lastDate, horizon);

    const allPaths = Array.from({ length: N_PATHS }, () => {
      const path = [];
      let price = lastPrice;
      for (let d = 0; d < horizon; d += 1) {
        price *= Math.exp(drift + dailyVol * boxMullerNormal());
        path.push(price);
      }
      return path;
    });

    const p5 = [], p25 = [], p50 = [], p75 = [], p95 = [];
    for (let d = 0; d < horizon; d += 1) {
      const dayVals = allPaths.map((p) => p[d]).sort((a, b) => a - b);
      p5.push(percentileAt(dayVals, 0.05));
      p25.push(percentileAt(dayVals, 0.25));
      p50.push(percentileAt(dayVals, 0.50));
      p75.push(percentileAt(dayVals, 0.75));
      p95.push(percentileAt(dayVals, 0.95));
    }

    const forecastCloud = { dates, p5, p25, p50, p75, p95 };
    const forecast = dates.map((date, i) => ({
      date,
      value: p50[i],
      lower: p25[i],
      upper: p75[i],
      lower68: p25[i],
      upper68: p75[i],
      lower95: p5[i],
      upper95: p95[i],
    }));

    return withMeta(forecast, forecastCloud, dailyVol);
  }

  // Real statistical models: drift / ar / holt (from remote).
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

  const forecast = values.map((value, idx) => {
    const h = idx + 1;
    const band = Math.exp(Z80 * sigma * Math.sqrt(h));
    return {
      date: formatISO(addDays(lastDate, h), { representation: 'date' }),
      value,
      lower: value / band,
      upper: value * band,
      ...addBands(value, dailyVol, h),
    };
  });

  return withMeta(forecast, null, dailyVol);
}
