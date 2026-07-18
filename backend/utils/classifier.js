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
    const labelClose = ctx.closes[t + horizon];
    // A NaN label close would silently coerce to y=0; drop the row instead.
    if (!Number.isFinite(labelClose)) continue;
    const row = featureRowAt(t, ctx);
    if (!row) continue;
    X.push(row);
    y.push(labelClose > ctx.closes[t] ? 1 : 0);
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
