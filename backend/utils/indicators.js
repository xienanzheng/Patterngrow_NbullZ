// Technical indicator helpers translated from the Python implementation.

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getClose = (row) => toNumber(row.close);
const getHigh = (row) => toNumber(row.high);
const getLow = (row) => toNumber(row.low);
const getVolume = (row) => toNumber(row.volume);

const ema = (values, period) => {
  const multiplier = 2 / (period + 1);
  const result = new Array(values.length).fill(null);
  let previous = null;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) {
      result[i] = previous;
      continue;
    }
    if (previous == null) {
      previous = value;
    } else {
      previous = (value - previous) * multiplier + previous;
    }
    result[i] = previous;
  }

  return result;
};

const rolling = (values, window, reducer) => {
  const result = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < window) continue;
    const slice = values.slice(i + 1 - window, i + 1);
    result[i] = reducer(slice, i);
  }
  return result;
};

export const calculateSMA = (points, window = 20) => {
  const closes = points.map(getClose);
  return rolling(closes, window, (slice) => slice.reduce((acc, value) => acc + value, 0) / slice.length);
};

export const calculateRSI = (points, window = 14) => {
  const closes = points.map(getClose);
  const result = new Array(points.length).fill(null);
  let gainAvg = 0;
  let lossAvg = 0;

  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i <= window) {
      gainAvg += gain;
      lossAvg += loss;
      if (i === window) {
        gainAvg /= window;
        lossAvg /= window;
        const rs = lossAvg === 0 ? 100 : gainAvg / lossAvg;
        result[i] = 100 - 100 / (1 + rs);
      }
      continue;
    }

    gainAvg = (gainAvg * (window - 1) + gain) / window;
    lossAvg = (lossAvg * (window - 1) + loss) / window;
    const rs = lossAvg === 0 ? 100 : gainAvg / lossAvg;
    result[i] = 100 - 100 / (1 + rs);
  }

  return result;
};

export const calculateMACD = (points, shortWindow = 12, longWindow = 26, signalWindow = 9) => {
  const closes = points.map(getClose);
  const expShort = ema(closes, shortWindow);
  const expLong = ema(closes, longWindow);
  const macd = expShort.map((value, index) => {
    if (value == null || expLong[index] == null) return null;
    return value - expLong[index];
  });
  const signal = ema(macd, signalWindow);
  return { macd, signal };
};

export const calculateBollingerBands = (points, window = 20, numStdDev = 2) => {
  const closes = points.map(getClose);
  const sma = calculateSMA(points, window);
  const upper = new Array(points.length).fill(null);
  const lower = new Array(points.length).fill(null);

  for (let i = 0; i < closes.length; i += 1) {
    if (i + 1 < window || sma[i] == null) continue;
    const slice = closes.slice(i + 1 - window, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((acc, close) => acc + (close - mean) ** 2, 0) / slice.length;
    const stdDev = Math.sqrt(variance);
    upper[i] = mean + stdDev * numStdDev;
    lower[i] = mean - stdDev * numStdDev;
  }

  return { middle: sma, upper, lower };
};

export const calculateStochasticOscillator = (points, kWindow = 14, dWindow = 3) => {
  const highs = points.map(getHigh);
  const lows = points.map(getLow);
  const closes = points.map(getClose);

  const percentK = new Array(points.length).fill(null);
  for (let i = 0; i < points.length; i += 1) {
    if (i + 1 < kWindow) continue;
    const rangeHigh = Math.max(...highs.slice(i + 1 - kWindow, i + 1));
    const rangeLow = Math.min(...lows.slice(i + 1 - kWindow, i + 1));
    const close = closes[i];
    if (rangeHigh === rangeLow) {
      percentK[i] = 0;
    } else {
      percentK[i] = ((close - rangeLow) / (rangeHigh - rangeLow)) * 100;
    }
  }

  const percentD = rolling(percentK, dWindow, (slice) => slice.reduce((acc, value) => acc + value, 0) / slice.length);
  return { percentK, percentD };
};

export const calculateVWAP = (points) => {
  const result = new Array(points.length).fill(null);
  let cumulativeVolume = 0;
  let cumulativeTpv = 0;

  points.forEach((row, index) => {
    const volume = getVolume(row);
    if (!volume) return;
    const typicalPrice = (getHigh(row) + getLow(row) + getClose(row)) / 3;
    cumulativeVolume += volume;
    cumulativeTpv += typicalPrice * volume;
    result[index] = cumulativeVolume > 0 ? cumulativeTpv / cumulativeVolume : null;
  });

  return result;
};

export const calculateADX = (points, period = 14) => {
  const length = points.length;
  const dx = new Array(length).fill(null);
  const plusDI = new Array(length).fill(null);
  const minusDI = new Array(length).fill(null);
  const adx = new Array(length).fill(null);

  const trList = new Array(length).fill(null);
  const plusDMList = new Array(length).fill(null);
  const minusDMList = new Array(length).fill(null);

  for (let i = 1; i < length; i += 1) {
    const high = getHigh(points[i]);
    const low = getLow(points[i]);
    const prevClose = getClose(points[i - 1]);
    const prevHigh = getHigh(points[i - 1]);
    const prevLow = getLow(points[i - 1]);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    const trueRange = Math.max(tr1, tr2, tr3);

    plusDMList[i] = plusDM;
    minusDMList[i] = minusDM;
    trList[i] = trueRange;
  }

  const smoothedTR = ema(trList, period);
  const smoothedPlusDM = ema(plusDMList, period);
  const smoothedMinusDM = ema(minusDMList, period);

  for (let i = 0; i < length; i += 1) {
    const trueRange = smoothedTR[i];
    if (!trueRange) continue;
    const pDI = (smoothedPlusDM[i] / trueRange) * 100;
    const mDI = (smoothedMinusDM[i] / trueRange) * 100;
    plusDI[i] = pDI;
    minusDI[i] = mDI;
    const directionalIndex = Math.abs(pDI - mDI) / (pDI + mDI || 1) * 100;
    dx[i] = directionalIndex;
  }

  const adxValues = ema(dx, period);
  adxValues.forEach((value, index) => {
    adx[index] = value;
  });

  return { adx, plusDI, minusDI };
};

export const calculateBollingerBandwidth = (points, window = 20, numStdDev = 2) => {
  const { upper, lower, middle } = calculateBollingerBands(points, window, numStdDev);
  return upper.map((upperBand, index) => {
    if (upperBand == null || lower[index] == null || middle[index] == null) return null;
    const bandwidth = ((upperBand - lower[index]) / middle[index]) * 100;
    return Number.isFinite(bandwidth) ? bandwidth : null;
  });
};

export const calculateIchimoku = (points) => {
  const highs = points.map(getHigh);
  const lows = points.map(getLow);
  const closes = points.map(getClose);

  const conversionLine = rolling(closes, 9, (_slice, index) => {
    const high = Math.max(...highs.slice(index - 8, index + 1));
    const low = Math.min(...lows.slice(index - 8, index + 1));
    return (high + low) / 2;
  });

  const baseLine = rolling(closes, 26, (_slice, index) => {
    const high = Math.max(...highs.slice(index - 25, index + 1));
    const low = Math.min(...lows.slice(index - 25, index + 1));
    return (high + low) / 2;
  });

  const leadingSpanA = conversionLine.map((value, index) => {
    if (value == null || baseLine[index] == null) return null;
    return { index: index + 26, value: (value + baseLine[index]) / 2 };
  });

  const leadingSpanB = rolling(closes, 52, (_slice, index) => {
    const high = Math.max(...highs.slice(index - 51, index + 1));
    const low = Math.min(...lows.slice(index - 51, index + 1));
    return (high + low) / 2;
  }).map((value, index) => ({ index: index + 26, value }));

  const laggingSpan = closes.map((close, index) => ({ index: index - 26, value: close }));

  return {
    conversionLine,
    baseLine,
    leadingSpanA,
    leadingSpanB,
    laggingSpan,
  };
};
