// Backtesting utilities ported from the Streamlit version.

import {
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateStochasticOscillator,
} from './indicators.js';

const getClose = (row) => Number(row.close);

export function backtestStrategy(points, indicator) {
  const signals = points.map(() => ({ signal: 'hold', numericSignal: 0 }));
  const closes = points.map(getClose);

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

export function runTradingSimulation(points, signals, initialCapital) {
  const portfolio = [];
  let cash = initialCapital;
  let shares = 0;
  let position = 0;

  points.forEach((row, index) => {
    if (index === 0) {
      portfolio.push({ date: row.date, value: initialCapital });
      return;
    }
    const price = getClose(row);
    const signal = signals[index]?.signal ?? 'hold';

    if (signal.startsWith('buy') && position === 0) {
      let weight = 1;
      if (signal.endsWith('strong')) weight = 0.5;
      else if (signal.endsWith('medium')) weight = 0.3;
      else if (signal.endsWith('weak')) weight = 0.1;

      const toInvest = cash * weight;
      const purchased = toInvest / price;
      shares += purchased;
      cash -= toInvest;
      if (shares > 0) position = 1;
    } else if (signal.startsWith('sell') && position === 1) {
      let weight = 1;
      if (signal.endsWith('strong')) weight = 0.5;
      else if (signal.endsWith('medium')) weight = 0.3;
      else if (signal.endsWith('weak')) weight = 0.1;

      const toSell = shares * weight;
      cash += toSell * price;
      shares -= toSell;
      if (shares <= 1e-6) {
        shares = 0;
        position = 0;
      }
    }

    const value = cash + shares * price;
    portfolio.push({ date: row.date, value });
  });

  return portfolio;
}
