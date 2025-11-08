import { backtestStrategy, runTradingSimulation } from './backtesting.js';
import {
  calculateADX,
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateStochasticOscillator,
  calculateVWAP,
} from './indicators.js';
import { predictFuturePrices } from './predictions.js';
import { fetchNews, fetchQuote, fetchYahooHistory, generateMockHistory } from './marketData.js';

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

function summariseSignals(signals) {
  return signals.reduce(
    (acc, entry) => {
      if (entry.numericSignal > 0) acc.buy += 1;
      if (entry.numericSignal < 0) acc.sell += 1;
      return acc;
    },
    { buy: 0, sell: 0 },
  );
}

function calculateMomentumSnapshot(history) {
  if (!history.length) return null;
  const closes = history.map((row) => Number(row.close) || 0);
  if (closes.length < 2) return null;
  const latest = closes.at(-1);
  const previous = closes.at(-2);
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return null;
  return {
    change: latest - previous,
    changePercent: previous ? ((latest - previous) / previous) * 100 : null,
  };
}

function buildIndicatorSnapshots(history) {
  return {
    sma: calculateSMA(history).at(-1) ?? null,
    rsi: calculateRSI(history).at(-1) ?? null,
    macd: (() => {
      const { macd, signal } = calculateMACD(history);
      return {
        macd: macd.at(-1) ?? null,
        signal: signal.at(-1) ?? null,
        divergence:
          macd.at(-1) != null && signal.at(-1) != null
            ? (macd.at(-1) ?? 0) - (signal.at(-1) ?? 0)
            : null,
      };
    })(),
    bollinger: (() => {
      const bands = calculateBollingerBands(history);
      return {
        upper: bands.upper.at(-1) ?? null,
        lower: bands.lower.at(-1) ?? null,
        middle: bands.middle.at(-1) ?? null,
      };
    })(),
    stochastic: (() => {
      const { percentK, percentD } = calculateStochasticOscillator(history);
      return {
        percentK: percentK.at(-1) ?? null,
        percentD: percentD.at(-1) ?? null,
      };
    })(),
    vwap: calculateVWAP(history).at(-1) ?? null,
    adx: (() => {
      const { adx, plusDI, minusDI } = calculateADX(history);
      return {
        adx: adx.at(-1) ?? null,
        plusDI: plusDI.at(-1) ?? null,
        minusDI: minusDI.at(-1) ?? null,
      };
    })(),
  };
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  return Number(value).toFixed(digits);
}

function buildTechnicalSummary({ indicatorSnapshots, momentum, signalSummary, priceTargets }) {
  const parts = [];

  if (momentum) {
    if (momentum.changePercent != null) {
      const direction = momentum.changePercent >= 0 ? 'up' : 'down';
      parts.push(`Price momentum is ${direction} ${Math.abs(momentum.changePercent).toFixed(2)}% on the latest bar.`);
    }
  }

  const rsi = indicatorSnapshots?.rsi;
  if (rsi != null) {
    if (rsi >= 70) parts.push(`RSI sits at ${formatNumber(rsi)} → overbought territory.`);
    else if (rsi <= 30) parts.push(`RSI sits at ${formatNumber(rsi)} → oversold territory.`);
    else parts.push(`RSI is neutral at ${formatNumber(rsi)}.`);
  }

  const macdDiv = indicatorSnapshots?.macd?.divergence;
  if (macdDiv != null) {
    const bias = macdDiv >= 0 ? 'bullish' : 'bearish';
    parts.push(`MACD divergence is ${formatNumber(macdDiv)} (${bias}).`);
  }

  const adxBlock = indicatorSnapshots?.adx;
  const adxValue = adxBlock?.adx ?? null;
  if (adxValue != null) {
    if (adxValue >= 25) parts.push(`ADX ${formatNumber(adxValue)} indicates a trending market.`);
    else parts.push(`ADX ${formatNumber(adxValue)} suggests weak trend strength.`);
    if (adxBlock.plusDI != null && adxBlock.minusDI != null) {
      const dominance = adxBlock.plusDI > adxBlock.minusDI ? 'buyers' : 'sellers';
      parts.push(`Directional movement favours ${dominance} (+DI ${formatNumber(adxBlock.plusDI)} vs −DI ${formatNumber(adxBlock.minusDI)}).`);
    }
  }

  if (indicatorSnapshots?.bollinger?.upper && indicatorSnapshots?.bollinger?.lower) {
    parts.push('Bollinger bands are in play — watch for pierces of the envelope for mean-reversion setups.');
  }

  const netBias =
    (signalSummary?.buy ?? 0) === (signalSummary?.sell ?? 0)
      ? 'balanced'
      : (signalSummary?.buy ?? 0) > (signalSummary?.sell ?? 0)
        ? 'bullish'
        : 'bearish';
  parts.push(`Backtest bias: ${netBias} (${signalSummary?.buy ?? 0} buy vs ${signalSummary?.sell ?? 0} sell signals).`);

  if (priceTargets?.base != null) {
    parts.push(
      `Model targets → base ${priceTargets.base.toFixed(2)}, conservative ${priceTargets.conservative?.toFixed(2)}, optimistic ${priceTargets.optimistic?.toFixed(2)}.`,
    );
  }

  return parts.join(' ');
}

export async function computeSignals(symbol, options = {}) {
  const {
    range = '1y',
    interval = '1d',
    indicator = 'sma',
    forecastModel = 'simple',
    forecastHorizon = 60,
    initialCapital = 10000,
    includeNews = true,
  } = options;

  let history = [];
  let quote = null;
  let news = [];

  try {
    history = await fetchYahooHistory(symbol, range, interval);
  } catch (error) {
    history = [];
  }

  if (!history.length) {
    history = generateMockHistory(symbol);
  }

  try {
    quote = await fetchQuote(symbol);
  } catch (error) {
    quote = null;
  }

  if (!quote && history.length) {
    const latest = history.at(-1);
    const previous = history.at(-2);
    quote = {
      symbol,
      regularMarketPrice: latest?.close ?? null,
      regularMarketPreviousClose: previous?.close ?? null,
      regularMarketChangePercent:
        latest?.close && previous?.close ? ((latest.close - previous.close) / previous.close) * 100 : null,
      marketCap: null,
      averageDailyVolume10Day:
        history.slice(-10).reduce((acc, row) => acc + (row.volume ?? 0), 0) / Math.max(history.slice(-10).length, 1),
    };
  }

  if (includeNews) {
    try {
      news = await fetchNews(symbol);
    } catch (error) {
      news = [];
    }
  }

  if (!history.length) {
    throw new Error('No historical data available for the requested symbol.');
  }

  const { signals } = backtestStrategy(history, indicator);
  const simulation = runTradingSimulation(history, signals, initialCapital);
  const prediction = predictFuturePrices(history, indicator, forecastModel, forecastHorizon);

  const summary = summariseSignals(signals);
  const finalValue = simulation.at(-1)?.value ?? null;
  const totalReturn =
    finalValue != null
      ? ((finalValue - initialCapital) / initialCapital) * 100
      : null;

  const indicatorSnapshotsRaw = buildIndicatorSnapshots(history);
  const adxBlock = indicatorSnapshotsRaw?.adx ?? { adx: null, plusDI: null, minusDI: null };
  const indicatorSnapshots = {
    ...indicatorSnapshotsRaw,
    adx: adxBlock,
  };
  const momentum = calculateMomentumSnapshot(history);
  const latestClose = history.at(-1)?.close ?? null;
  const priceTargets = prediction.length
    ? {
        optimistic: clamp(prediction.at(-1).value * 1.08, 0, Number.POSITIVE_INFINITY),
        base: prediction.at(-1).value,
        conservative: clamp(prediction.at(-1).value * 0.92, 0, Number.POSITIVE_INFINITY),
      }
    : null;
  const technicalSummary = buildTechnicalSummary({
    indicatorSnapshots,
    momentum,
    signalSummary: summary,
    priceTargets,
  });

  const dataSource = history[0]?.source ?? 'unknown';

  return {
    symbol,
    generatedAt: new Date().toISOString(),
    range,
    interval,
    quote,
    latestClose,
    history,
    news,
    indicator,
    indicatorSnapshots,
    momentum,
    signals,
    signalSummary: summary,
    simulation,
    simulationSummary: {
      initialCapital,
      finalValue,
      totalReturn,
    },
    forecastModel,
    forecast: prediction,
    priceTargets,
    technicalSummary,
    dataSource,
  };
}
