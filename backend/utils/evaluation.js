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
  // Report only folds that actually contributed metrics, so the payload
  // never claims more out-of-sample coverage than was used.
  const contributing = perFold.filter((f) => f.mae != null).length;
  return { model, folds: contributing, horizon, ...averageMetrics(perFold) };
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
  const contributing = perFold.filter((f) => f.mae != null).length;
  return { model: 'naive', folds: contributing, horizon, ...averageMetrics(perFold) };
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
    testHistory,
    testSignals,
    initialCapital,
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
