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
