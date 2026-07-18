// Backtesting utilities ported from the Streamlit version.

import {
  calculateADX,
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateStochasticOscillator,
  ema,
} from './indicators.js';

const getClose = (row) => Number(row.close);

export const DEFAULT_ENSEMBLE_WEIGHTS = { sma: 0.2, rsi: 0.2, macd: 0.2, bollinger: 0.15, stochastic: 0.15, adx: 0.1 };

export function normalizeEnsembleWeights(weights) {
  if (!weights || typeof weights !== 'object') return { ...DEFAULT_ENSEMBLE_WEIGHTS };
  const merged = {};
  let sum = 0;
  for (const key of Object.keys(DEFAULT_ENSEMBLE_WEIGHTS)) {
    const value = Number(weights[key]);
    merged[key] = Number.isFinite(value) && value >= 0 ? value : 0;
    sum += merged[key];
  }
  if (sum <= 0) return { ...DEFAULT_ENSEMBLE_WEIGHTS };
  Object.keys(merged).forEach((key) => {
    merged[key] /= sum;
  });
  return merged;
}

// Per-bar weighted vote in [-1, 1] across the six indicators — the same votes
// computeConvictionScore uses for the latest bar, computed over the whole series.
export function computeEnsembleScoreSeries(points, weights) {
  const w = normalizeEnsembleWeights(weights);
  const closes = points.map(getClose);
  const sma = calculateSMA(points);
  const rsiSmoothed = ema(calculateRSI(points), 3);
  const { macd, signal } = calculateMACD(points);
  const bands = calculateBollingerBands(points);
  const { percentK } = calculateStochasticOscillator(points);
  const { adx, plusDI, minusDI } = calculateADX(points);

  return points.map((_, i) => {
    const close = closes[i];
    const votes = {
      sma: sma[i] != null && Number.isFinite(close) ? (close > sma[i] ? 1 : -1) : 0,
      rsi: rsiSmoothed[i] == null ? 0 : rsiSmoothed[i] < 30 ? 1 : rsiSmoothed[i] > 70 ? -1 : 0,
      macd: macd[i] == null || signal[i] == null ? 0 : macd[i] - signal[i] > 0 ? 1 : -1,
      bollinger: bands.upper[i] == null || !Number.isFinite(close) ? 0
        : close < bands.lower[i] ? 1 : close > bands.upper[i] ? -1 : 0,
      stochastic: percentK[i] == null ? 0 : percentK[i] < 20 ? 1 : percentK[i] > 80 ? -1 : 0,
      adx: adx[i] == null || adx[i] < 25 ? 0 : (plusDI[i] ?? 0) > (minusDI[i] ?? 0) ? 1 : -1,
    };
    return Object.entries(votes).reduce((acc, [key, vote]) => acc + w[key] * vote, 0);
  });
}

export function backtestStrategy(points, indicator, options = {}) {
  const signals = points.map(() => ({ signal: 'hold', numericSignal: 0 }));
  const closes = points.map(getClose);

  if (indicator === 'ensemble') {
    const score = computeEnsembleScoreSeries(points, options.weights);
    for (let i = 1; i < points.length; i += 1) {
      const prev = score[i - 1];
      const curr = score[i];
      if (prev < 0.3 && curr >= 0.3) {
        const label = curr >= 0.6 ? 'buy_strong' : curr >= 0.45 ? 'buy_medium' : 'buy_weak';
        signals[i] = { signal: label, numericSignal: 1 };
      } else if (prev > -0.3 && curr <= -0.3) {
        const label = curr <= -0.6 ? 'sell_strong' : curr <= -0.45 ? 'sell_medium' : 'sell_weak';
        signals[i] = { signal: label, numericSignal: -1 };
      }
    }
    return { signals, context: { score } };
  }

  if (indicator === 'sma') {
    const sma = calculateSMA(points);
    for (let i = 1; i < points.length; i += 1) {
      if (sma[i - 1] == null || sma[i] == null) continue;
      if (sma[i - 1] < closes[i - 1] && sma[i] >= closes[i]) {
        const diff = sma[i] - closes[i];
        let label = 'sell_weak';
        if (diff > closes[i] * 0.02) label = 'sell_strong';
        else if (diff > closes[i] * 0.005) label = 'sell_medium';
        signals[i] = { signal: label, numericSignal: -1 };
      } else if (sma[i - 1] > closes[i - 1] && sma[i] <= closes[i]) {
        const diff = closes[i] - sma[i];
        let label = 'buy_weak';
        if (diff > closes[i] * 0.02) label = 'buy_strong';
        else if (diff > closes[i] * 0.005) label = 'buy_medium';
        signals[i] = { signal: label, numericSignal: 1 };
      }
    }
    return { signals, context: { sma } };
  }

  if (indicator === 'rsi') {
    const rsi = calculateRSI(points);
    for (let i = 0; i < points.length; i += 1) {
      const value = rsi[i];
      if (value == null) continue;
      if (value < 30) {
        const diff = 30 - value;
        let label = 'buy_weak';
        if (diff > 10) label = 'buy_strong';
        else if (diff > 5) label = 'buy_medium';
        signals[i] = { signal: label, numericSignal: 1 };
      } else if (value > 70) {
        const diff = value - 70;
        let label = 'sell_weak';
        if (diff > 10) label = 'sell_strong';
        else if (diff > 5) label = 'sell_medium';
        signals[i] = { signal: label, numericSignal: -1 };
      }
    }
    return { signals, context: { rsi } };
  }

  if (indicator === 'macd') {
    const { macd, signal } = calculateMACD(points);
    for (let i = 1; i < points.length; i += 1) {
      if (macd[i - 1] == null || signal[i - 1] == null || macd[i] == null || signal[i] == null) continue;

      if (macd[i - 1] < signal[i - 1] && macd[i] >= signal[i]) {
        const diff = macd[i] - signal[i];
        let label = 'buy_weak';
        if (diff > 0.5) label = 'buy_strong';
        else if (diff > 0.1) label = 'buy_medium';
        signals[i] = { signal: label, numericSignal: 1 };
      } else if (macd[i - 1] > signal[i - 1] && macd[i] <= signal[i]) {
        const diff = signal[i] - macd[i];
        let label = 'sell_weak';
        if (diff > 0.5) label = 'sell_strong';
        else if (diff > 0.1) label = 'sell_medium';
        signals[i] = { signal: label, numericSignal: -1 };
      }
    }
    return { signals, context: { macd, signal } };
  }

  if (indicator === 'bollinger') {
    const bands = calculateBollingerBands(points);
    for (let i = 0; i < points.length; i += 1) {
      const upper = bands.upper[i];
      const lower = bands.lower[i];
      const close = closes[i];
      if (upper == null || lower == null) continue;
      if (close < lower) {
        const diff = lower - close;
        let label = 'buy_weak';
        if (diff > close * 0.01) label = 'buy_strong';
        else if (diff > close * 0.002) label = 'buy_medium';
        signals[i] = { signal: label, numericSignal: 1 };
      } else if (close > upper) {
        const diff = close - upper;
        let label = 'sell_weak';
        if (diff > close * 0.01) label = 'sell_strong';
        else if (diff > close * 0.002) label = 'sell_medium';
        signals[i] = { signal: label, numericSignal: -1 };
      }
    }
    return { signals, context: bands };
  }

  if (indicator === 'stochastic') {
    const { percentK, percentD } = calculateStochasticOscillator(points);
    for (let i = 1; i < points.length; i += 1) {
      const prevK = percentK[i - 1];
      const prevD = percentD[i - 1];
      const currK = percentK[i];
      const currD = percentD[i];
      if (prevK == null || prevD == null || currK == null || currD == null) continue;

      if (prevK < prevD && currK >= currD && currK < 20) {
        const diff = 20 - currK;
        let label = 'buy_weak';
        if (diff > 10) label = 'buy_strong';
        else if (diff > 5) label = 'buy_medium';
        signals[i] = { signal: label, numericSignal: 1 };
      } else if (prevK > prevD && currK <= currD && currK > 80) {
        const diff = currK - 80;
        let label = 'sell_weak';
        if (diff > 10) label = 'sell_strong';
        else if (diff > 5) label = 'sell_medium';
        signals[i] = { signal: label, numericSignal: -1 };
      }
    }
    return { signals, context: { percentK, percentD } };
  }

  return { signals, context: {} };
}

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
  let lastValidPrice = null;

  // Round-trip P&L net of commissions: cost basis includes the buy fee,
  // proceeds are net of the sell fee — so winRate can't count fee-losing trades as wins.
  const netPnlPct = (sellExecPrice) => {
    if (entryPrice == null) return null;
    const costBasis = entryPrice / (1 - transactionCostPct);
    const sellNet = sellExecPrice * (1 - transactionCostPct);
    return ((sellNet - costBasis) / costBasis) * 100;
  };

  points.forEach((row, index) => {
    const price = getClose(row);
    const validPrice = Number.isFinite(price) && price > 0;
    if (validPrice) lastValidPrice = price;
    if (index === 0 || !validPrice) {
      // Mark open positions at the last valid price so one bad data bar
      // doesn't fabricate a crash in the equity curve.
      portfolio.push({ date: row.date, value: cash + shares * (lastValidPrice ?? 0) });
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
      trades.push({ type: 'stop', date: row.date, price: execPrice, pnlPct: netPnlPct(execPrice) });
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
        type: 'sell',
        date: row.date,
        price: execPrice,
        pnlPct: netPnlPct(execPrice),
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
