// Lightweight heuristics that mirror the Streamlit forecasting options.

import { addDays, formatISO } from 'date-fns';

const getClose = (row) => Number(row.close);

const linearRegression = (points) => {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = points[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
};

const smoothSeries = (values, window = 5) => {
  const result = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const mean = slice.reduce((acc, value) => acc + value, 0) / slice.length;
    result[i] = mean;
  }
  return result;
};

export function predictFuturePrices(points, indicator = 'sma', model = 'simple', days = 60) {
  const closes = points.map(getClose).filter((value) => Number.isFinite(value));
  if (closes.length === 0) return [];

  const lastDate = points.length > 0 ? new Date(points[points.length - 1].date) : new Date();
  const predictions = [];

  if (model === 'simple') {
    const trend = (closes[closes.length - 1] - closes[0]) / closes.length;
    const lastPrice = closes[closes.length - 1];

    for (let i = 1; i <= days; i += 1) {
      const projected = lastPrice + trend * i;
      predictions.push({
        date: formatISO(addDays(lastDate, i), { representation: 'date' }),
        value: projected,
      });
    }
    return predictions;
  }

  if (model === 'arima') {
    const { slope, intercept } = linearRegression(closes);
    for (let i = 1; i <= days; i += 1) {
      const x = closes.length + i;
      const projected = slope * x + intercept;
      predictions.push({
        date: formatISO(addDays(lastDate, i), { representation: 'date' }),
        value: projected,
      });
    }
    return predictions;
  }

  if (model === 'prophet') {
    const smoothed = smoothSeries(closes, 7);
    const { slope, intercept } = linearRegression(smoothed);
    for (let i = 1; i <= days; i += 1) {
      const x = smoothed.length + i;
      const projected = slope * x + intercept;
      predictions.push({
        date: formatISO(addDays(lastDate, i), { representation: 'date' }),
        value: projected,
      });
    }
    return predictions;
  }

  return [];
}
