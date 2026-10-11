import { backtestStrategy, normalizeEnsembleWeights, runTradingSimulationDetailed, CONVICTION_THRESHOLDS } from './backtesting.js';
import {
  calculateADX,
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateStochasticOscillator,
  calculateVWAP,
  ema,
} from './indicators.js';
import { directionalForecast } from './classifier.js';
import { predictFuturePrices } from './predictions.js';
import { fetchNews, fetchQuote, fetchYahooHistory, generateMockHistory } from './marketData.js';

// A qualitative state only flips after the indicator confirms it for the
// `n` most recent consecutive sessions — one noisy bar (or a data gap)
// can't rewrite the narrative.
export function confirmedState(series, predicate, n = 2) {
  const tail = series.slice(-n);
  return tail.length === n && tail.every((v) => v != null && predicate(v));
}

const NEUTRAL_CONVICTION = {
  score: 0,
  label: 'Neutral',
  votes: { sma: 0, rsi: 0, macd: 0, bollinger: 0, stochastic: 0, adx: 0 },
  insufficientData: true,
};

export function computeConvictionScore(history, customWeights) {
  // Indicator warm-up needs real history; EMA-based votes on a handful of
  // bars would produce confident garbage.
  const validCloses = history.filter((r) => Number.isFinite(Number(r.close)) && Number(r.close) > 0).length;
  if (validCloses < 30) return NEUTRAL_CONVICTION;
  const close = Number(history.at(-1)?.close);
  const sma = calculateSMA(history).at(-1);
  const rsiSmoothed = ema(calculateRSI(history), 3).at(-1);
  const { macd, signal } = calculateMACD(history);
  const macdDiv = macd.at(-1) != null && signal.at(-1) != null ? macd.at(-1) - signal.at(-1) : null;
  const bands = calculateBollingerBands(history);
  const { percentK } = calculateStochasticOscillator(history);
  const { adx, plusDI, minusDI } = calculateADX(history);
  const k = percentK.at(-1);

  const validClose = Number.isFinite(close) && close > 0;
  const votes = {
    sma: sma != null && validClose ? (close > sma ? 1 : -1) : 0,
    rsi: rsiSmoothed == null ? 0 : rsiSmoothed < 30 ? 1 : rsiSmoothed > 70 ? -1 : 0,
    macd: macdDiv == null || macdDiv === 0 ? 0 : macdDiv > 0 ? 1 : -1,
    bollinger: bands.upper.at(-1) == null || !validClose ? 0
      : close < bands.lower.at(-1) ? 1 : close > bands.upper.at(-1) ? -1 : 0,
    stochastic: k == null ? 0 : k < 20 ? 1 : k > 80 ? -1 : 0,
    adx: adx.at(-1) == null || adx.at(-1) < 25 ? 0
      : (plusDI.at(-1) ?? 0) > (minusDI.at(-1) ?? 0) ? 1 : -1,
  };
  const weights = normalizeEnsembleWeights(customWeights);
  const score = Object.entries(votes).reduce((acc, [key, vote]) => acc + weights[key] * vote, 0);
  const { STRONG_BUY, MEDIUM_BUY, BUY, NEUTRAL_LOW, SELL, MEDIUM_SELL } = CONVICTION_THRESHOLDS;
  const label = score >= STRONG_BUY  ? 'Strong Buy'
    : score >= MEDIUM_BUY  ? 'Medium Buy'
    : score >= BUY         ? 'Buy'
    : score >= NEUTRAL_LOW ? 'Neutral'
    : score > SELL         ? 'Sell'
    : score > MEDIUM_SELL  ? 'Medium Sell'
    : 'Strong Sell';
  return { score: Number(score.toFixed(3)), label, votes };
}

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

function buildTechnicalSummary({ history, indicatorSnapshots, momentum, signalSummary, priceTargets, conviction }) {
  const parts = [];

  if (momentum) {
    if (momentum.changePercent != null) {
      const direction = momentum.changePercent >= 0 ? 'up' : 'down';
      parts.push(`Price momentum is ${direction} ${Math.abs(momentum.changePercent).toFixed(2)}% on the latest bar.`);
    }
  }

  const rsi = indicatorSnapshots?.rsi;
  if (rsi != null) {
    const rsiSeries = ema(calculateRSI(history), 3);
    if (confirmedState(rsiSeries, (v) => v >= 70)) {
      parts.push(`RSI has held overbought for 2+ sessions (now ${formatNumber(rsi)}).`);
    } else if (confirmedState(rsiSeries, (v) => v <= 30)) {
      parts.push(`RSI has held oversold for 2+ sessions (now ${formatNumber(rsi)}).`);
    } else {
      parts.push(`RSI is neutral/unconfirmed at ${formatNumber(rsi)}.`);
    }
  }

  const macdDiv = indicatorSnapshots?.macd?.divergence;
  if (macdDiv != null) {
    const bias = macdDiv >= 0 ? 'bullish' : 'bearish';
    parts.push(`MACD divergence is ${formatNumber(macdDiv)} (${bias}).`);
  }

  const adxBlock = indicatorSnapshots?.adx;
  const adxValue = adxBlock?.adx ?? null;
  if (adxValue != null) {
    const adxSeries = calculateADX(history).adx;
    if (confirmedState(adxSeries, (v) => v >= 25)) {
      parts.push(`ADX ${formatNumber(adxValue)} confirms a trending market (2+ sessions).`);
    } else {
      parts.push(`ADX ${formatNumber(adxValue)} — trend not yet confirmed.`);
    }
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
      `Model targets (80% volatility band) → base ${priceTargets.base.toFixed(2)}, lower ${priceTargets.conservative?.toFixed(2)}, upper ${priceTargets.optimistic?.toFixed(2)}.`,
    );
  }

  if (conviction) {
    parts.push(`Ensemble conviction: ${conviction.label} (score ${conviction.score >= 0 ? '+' : ''}${conviction.score}).`);
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
    weights = null,
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

  const { signals } = backtestStrategy(history, indicator, { weights });
  const { portfolio: simulation, trades, costsPaid } = runTradingSimulationDetailed(
    history, signals, initialCapital, {},
  );
  const prediction = predictFuturePrices(history, indicator, forecastModel, forecastHorizon);
  const forecastCloud = prediction.forecastCloud ?? null;
  const forecastVol = prediction.forecastVol ?? null;

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
        optimistic: prediction.at(-1).upper,
        base: prediction.at(-1).value,
        conservative: prediction.at(-1).lower,
      }
    : null;
  const conviction = computeConvictionScore(history, weights);
  let directional = null;
  try {
    directional = directionalForecast(history, { horizon: 5 });
  } catch {
    directional = null;
  }
  const technicalSummary = buildTechnicalSummary({
    history,
    indicatorSnapshots,
    momentum,
    signalSummary: summary,
    priceTargets,
    conviction,
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
      trades: trades.length,
      costsPaid,
    },
    forecastModel,
    forecast: prediction,
    forecastCloud: forecastCloud ?? null,
    forecastVol: forecastVol ?? null,
    priceTargets,
    conviction,
    directional,
    technicalSummary,
    dataSource,
  };
}
