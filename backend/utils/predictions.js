import { addDays, formatISO } from 'date-fns';

const getClose = (row) => Number(row.close);

function computeHistoricalVol(closes) {
  if (closes.length < 2) return { dailyVol: 0, meanReturn: 0 };
  const logReturns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
  return { dailyVol: Math.sqrt(variance), meanReturn: mean };
}

function addBands(value, dailyVol, t) {
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

const linearRegression = (points) => {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += points[i]; sumXY += i * points[i]; sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
};

const smoothSeries = (values, window = 5) =>
  values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

function buildDates(lastDate, days) {
  return Array.from({ length: days }, (_, i) =>
    formatISO(addDays(lastDate, i + 1), { representation: 'date' })
  );
}

function percentileAt(sorted, p) {
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function predictFuturePrices(points, indicator = 'sma', model = 'simple', days = 60) {
  const closes = points.map(getClose).filter(Number.isFinite);
  if (closes.length === 0) return { forecast: [], forecastCloud: null, forecastVol: null };

  const lastDate = points.length > 0 ? new Date(points[points.length - 1].date) : new Date();
  const dates = buildDates(lastDate, days);
  const { dailyVol, meanReturn } = computeHistoricalVol(closes);

  if (model === 'simple') {
    const trend = (closes[closes.length - 1] - closes[0]) / closes.length;
    const lastPrice = closes[closes.length - 1];
    const forecast = dates.map((date, i) => {
      const value = lastPrice + trend * (i + 1);
      return { date, value, ...addBands(value, dailyVol, i + 1) };
    });
    return { forecast, forecastCloud: null, forecastVol: dailyVol };
  }

  if (model === 'arima') {
    const { slope, intercept } = linearRegression(closes);
    const forecast = dates.map((date, i) => {
      const value = slope * (closes.length + i + 1) + intercept;
      return { date, value, ...addBands(value, dailyVol, i + 1) };
    });
    return { forecast, forecastCloud: null, forecastVol: dailyVol };
  }

  if (model === 'prophet') {
    const smoothed = smoothSeries(closes, 7);
    const { slope, intercept } = linearRegression(smoothed);
    const forecast = dates.map((date, i) => {
      const value = slope * (smoothed.length + i + 1) + intercept;
      return { date, value, ...addBands(value, dailyVol, i + 1) };
    });
    return { forecast, forecastCloud: null, forecastVol: dailyVol };
  }

  if (model === 'montecarlo') {
    const N_PATHS = 300;
    const lastPrice = closes[closes.length - 1];
    const drift = meanReturn - 0.5 * dailyVol ** 2;

    // Simulate N_PATHS paths of length `days`
    const allPaths = Array.from({ length: N_PATHS }, () => {
      const path = [];
      let price = lastPrice;
      for (let d = 0; d < days; d++) {
        price *= Math.exp(drift + dailyVol * boxMullerNormal());
        path.push(price);
      }
      return path;
    });

    // Extract percentiles at each day
    const p5 = [], p25 = [], p50 = [], p75 = [], p95 = [];
    for (let d = 0; d < days; d++) {
      const dayVals = allPaths.map((p) => p[d]).sort((a, b) => a - b);
      p5.push(percentileAt(dayVals, 0.05));
      p25.push(percentileAt(dayVals, 0.25));
      p50.push(percentileAt(dayVals, 0.50));
      p75.push(percentileAt(dayVals, 0.75));
      p95.push(percentileAt(dayVals, 0.95));
    }

    const forecastCloud = { dates, p5, p25, p50, p75, p95 };

    // Median path as primary forecast (with vol bands)
    const forecast = dates.map((date, i) => ({
      date,
      value: p50[i],
      lower68: p25[i],
      upper68: p75[i],
      lower95: p5[i],
      upper95: p95[i],
    }));

    return { forecast, forecastCloud, forecastVol: dailyVol };
  }

  return { forecast: [], forecastCloud: null, forecastVol: null };
}
