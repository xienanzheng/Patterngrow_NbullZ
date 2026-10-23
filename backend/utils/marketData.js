const yahooBase = (process.env.YAHOO_FINANCE_API_BASE ?? 'https://query1.finance.yahoo.com').replace(/\/$/, '');
const alphaVantageKey = process.env.ALPHA_VANTAGE_KEY;

const finiteNumber = (value) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const safeDate = (timestamp) => {
  const seconds = finiteNumber(timestamp);
  if (seconds == null) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

async function fetchJson(url, params) {
  const target = new URL(url);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value == null) return;
      target.searchParams.set(key, value);
    });
  }
  let response;
  try {
    response = await fetch(target, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    // Fetch errors can contain the request URL, including provider API keys.
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new Error(timedOut ? 'Market data request timed out.' : 'Market data provider is unavailable.');
  }
  if (!response.ok) {
    // Never forward upstream response bodies or status text to public routes.
    throw new Error(`Market data request failed (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error('Market data provider returned invalid JSON.');
  }
}

export async function fetchYahooHistory(symbol, range = '1y', interval = '1d') {
  // Keep the historical export name for callers while allowing a documented
  // provider as the primary source. A response always comes from one provider.
  const providers = process.env.MARKET_DATA_PROVIDER === 'twelvedata'
    ? [fetchTwelveData, fetchYahooChartHistory]
    : [fetchYahooChartHistory, fetchTwelveData];
  let firstError;
  for (const provider of providers) {
    try {
      const history = await provider(symbol, range, interval);
      if (history.some((row) => row.close != null)) return history;
      firstError ??= new Error('Market data history is unavailable.');
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}

async function fetchYahooChartHistory(symbol, range, interval) {
  const data = await fetchJson(`${yahooBase}/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    range,
    interval,
    events: 'div,split',
  });
  const result = data?.chart?.result?.[0];
  if (!Array.isArray(result?.timestamp) || !result?.indicators?.quote?.[0]) {
    throw new Error('Yahoo Finance history unavailable.');
  }
  const quote = result.indicators.quote[0];
  return result.timestamp
    .map((time, index) => ({
      date: safeDate(time),
      open: finiteNumber(quote.open?.[index]),
      high: finiteNumber(quote.high?.[index]),
      low: finiteNumber(quote.low?.[index]),
      close: finiteNumber(quote.close?.[index]),
      volume: finiteNumber(quote.volume?.[index]),
      source: 'yahoo',
      currency: result.meta?.currency ?? null,
      exchangeTimezone: result.meta?.exchangeTimezoneName ?? null,
      datePrecision: 'timestamp',
    }))
    .filter((row) => row.date != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchYahooProfile(symbol) {
  const data = await fetchJson(`${yahooBase}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
    modules: 'price,summaryProfile',
  });
  const summary = data?.quoteSummary?.result?.[0];
  if (!summary) {
    throw new Error('Yahoo profile unavailable.');
  }
  return {
    price: summary.price ?? {},
    profile: summary.summaryProfile ?? {},
  };
}

export async function fetchQuote(symbol) {
  const providers = process.env.MARKET_DATA_PROVIDER === 'twelvedata'
    ? [fetchTwelveQuote, fetchYahooQuote]
    : [fetchYahooQuote, fetchTwelveQuote];
  for (const provider of providers) {
    try {
      const quote = await provider(symbol);
      if (quote) return quote;
    } catch {
      // Every quote provider fails independently; history remains a fallback.
    }
  }
  const history = await fetchYahooHistory(symbol, '1mo', '1d');
  const valid = history.filter((row) => row.close != null);
  if (!valid.length) throw new Error('Quote not available.');
  const latest = valid.at(-1);
  const latestIndex = history.indexOf(latest);
  const previous = history[latestIndex - 1];
  const volumes = history.slice(0, latestIndex + 1).slice(-10)
    .map((row) => finiteNumber(row.volume)).filter((value) => value != null);
  return {
    symbol,
    regularMarketPrice: latest.close,
    regularMarketPreviousClose: previous?.close ?? null,
    regularMarketChangePercent:
      previous?.close != null && previous.close !== 0 ? ((latest.close - previous.close) / previous.close) * 100 : null,
    regularMarketVolume: latest.volume,
    marketCap: null,
    averageDailyVolume10Day: volumes.length ? volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length : null,
    source: latest.source,
    asOf: latest.date,
    asOfPrecision: latest.datePrecision,
    currency: latest.currency ?? null,
    exchangeTimezoneName: latest.exchangeTimezone ?? null,
    partial: true,
  };
}

async function fetchYahooQuote(symbol) {
  const data = await fetchJson(`${yahooBase}/v7/finance/quote`, { symbols: symbol });
  const quote = data?.quoteResponse?.result?.[0];
  if (!quote || finiteNumber(quote.regularMarketPrice) == null) return null;
  return {
    ...quote,
    regularMarketPrice: finiteNumber(quote.regularMarketPrice),
    source: 'yahoo',
    asOf: safeDate(quote.regularMarketTime),
    asOfPrecision: 'timestamp',
    currency: quote.currency ?? null,
    partial: false,
  };
}

async function fetchTwelveQuote(symbol) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return null;
  const data = await fetchJson('https://api.twelvedata.com/quote', {
    symbol,
    apikey: key,
    interval: '1day',
    volume_time_period: 10,
  });
  if (data?.status === 'error' || finiteNumber(data?.close) == null) return null;
  return {
    symbol: data.symbol ?? symbol,
    shortName: data.name ?? null,
    fullExchangeName: data.exchange ?? null,
    regularMarketPrice: finiteNumber(data.close),
    regularMarketOpen: finiteNumber(data.open),
    regularMarketDayHigh: finiteNumber(data.high),
    regularMarketDayLow: finiteNumber(data.low),
    regularMarketPreviousClose: finiteNumber(data.previous_close),
    regularMarketChange: finiteNumber(data.change),
    regularMarketChangePercent: finiteNumber(data.percent_change),
    regularMarketVolume: finiteNumber(data.volume),
    averageDailyVolume10Day: finiteNumber(data.average_volume),
    fiftyTwoWeekHigh: finiteNumber(data.fifty_two_week?.high),
    fiftyTwoWeekLow: finiteNumber(data.fifty_two_week?.low),
    marketCap: null,
    source: 'twelvedata',
    // timestamp is the daily candle's opening time, not quote freshness.
    asOf: safeDate(data.last_quote_at),
    asOfPrecision: 'timestamp',
    currency: data.currency ?? null,
    partial: false,
  };
}

function chartDerivedFundamentals(history) {
  const valid = history.filter((row) => finiteNumber(row.close) != null);
  const latest = valid.at(-1);
  const recent = valid.slice(-30);
  const highs = valid.map((row) => finiteNumber(row.high)).filter((value) => value != null);
  const lows = valid.map((row) => finiteNumber(row.low)).filter((value) => value != null);
  const volumes = recent.map((row) => finiteNumber(row.volume)).filter((value) => value != null);
  const observedRangeHigh = highs.length ? Math.max(...highs) : null;
  const observedRangeLow = lows.length ? Math.min(...lows) : null;
  const spanDays = (Date.parse(latest?.date) - Date.parse(valid[0]?.date)) / 86_400_000;
  // A newly listed instrument or truncated provider response is not a 52-week
  // range. Allow for non-trading days at the year boundary, require daily coverage.
  const coversYear = spanDays >= 358 && valid.length >= 200
    && highs.length === valid.length && lows.length === valid.length;

  return {
    currency: latest?.currency ?? null,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    trailingEps: null,
    forwardEps: null,
    volume: finiteNumber(latest?.volume),
    averageVolume: volumes.length
      ? volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length
      : null,
    fiftyTwoWeekHigh: coversYear ? observedRangeHigh : null,
    fiftyTwoWeekLow: coversYear ? observedRangeLow : null,
    observedRangeHigh,
    observedRangeLow,
    beta: null,
    dividendYield: null,
    dividendRate: null,
    profitMargins: null,
    grossMargins: null,
    revenueGrowth: null,
    totalRevenue: null,
    totalDebt: null,
    targetMeanPrice: null,
    quarterlyResults: [],
    partial: true,
    dataSource: latest?.source ?? 'chart',
    asOf: latest?.date ?? null,
    asOfPrecision: latest?.datePrecision ?? null,
  };
}

export async function fetchNews(symbol) {
  if (!alphaVantageKey) return [];
  const data = await fetchJson('https://www.alphavantage.co/query', {
    function: 'NEWS_SENTIMENT',
    tickers: symbol,
    sort: 'LATEST',
    apikey: alphaVantageKey,
  });
  return (data?.feed ?? []).slice(0, 6).map((item) => ({
    title: item.title,
    summary: item.summary,
    url: item.url,
    timePublished: item.time_published,
    overallSentimentScore: item.overall_sentiment_score,
  }));
}

export async function fetchPolygonDetails(symbol) {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  try {
    const data = await fetchJson(
      `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol.toUpperCase())}`,
      { apiKey: key },
    );
    const r = data?.results;
    if (!r) return null;
    return {
      name:        r.name             ?? null,
      description: r.description      ?? null,
      exchange:    r.primary_exchange  ?? null,
      type:        r.type              ?? null,
      sic:         r.sic_description   ?? null,
      employees:   r.total_employees   ?? null,
      homepage:    r.homepage_url      ?? null,
      listDate:    r.list_date         ?? null,
    };
  } catch {
    return null;
  }
}

export async function fetchFundamentals(symbol) {
  let result;
  try {
    const data = await fetchJson(`${yahooBase}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
      modules: [
        'price',
        'summaryDetail',
        'defaultKeyStatistics',
        'financialData',
        'incomeStatementHistoryQuarterly',
        'cashflowStatementHistoryQuarterly',
        'balanceSheetHistoryQuarterly',
      ].join(','),
    });
    result = data?.quoteSummary?.result?.[0];
    if (!result) throw new Error('Fundamentals unavailable for this symbol.');
  } catch (error) {
    try {
      const history = await fetchYahooHistory(symbol, '1y', '1d');
      if (history.length) return chartDerivedFundamentals(history);
    } catch {
      // Preserve the more actionable quoteSummary error when both sources fail.
    }
    throw error;
  }

  const price = result.price ?? {};
  const sd = result.summaryDetail ?? {};
  const ks = result.defaultKeyStatistics ?? {};
  const fd = result.financialData ?? {};

  // Merge 3 quarterly statement arrays by endDate (most-recent 4 quarters)
  const incomeRows = result.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
  const cashRows   = result.cashflowStatementHistoryQuarterly?.cashflowStatements ?? [];
  const bsRows     = result.balanceSheetHistoryQuarterly?.balanceSheetStatements ?? [];

  const byDate = {};
  const addRow = (arr, pick) => {
    arr.slice(0, 4).forEach((row) => {
      const d = row.endDate?.fmt;
      if (!d) return;
      byDate[d] = { ...byDate[d], date: d, ...pick(row) };
    });
  };
  addRow(incomeRows, (r) => ({
    revenue:    r.totalRevenue?.raw ?? null,
    netIncome:  r.netIncome?.raw    ?? null,
    basicEps:   r.basicEPS?.raw     ?? null,
    grossProfit: r.grossProfit?.raw ?? null,
    ebit:       r.ebit?.raw         ?? null,
  }));
  addRow(cashRows, (r) => ({
    operatingCashFlow: r.totalCashFromOperatingActivities?.raw ?? null,
    capEx:             r.capitalExpenditures?.raw               ?? null,
    freeCashFlow:      r.freeCashflow?.raw                      ?? null,
  }));
  addRow(bsRows, (r) => ({
    cash:             r.cash?.raw                    ?? null,
    totalAssets:      r.totalAssets?.raw             ?? null,
    totalLiabilities: r.totalLiab?.raw               ?? null,
    longTermDebt:     r.longTermDebt?.raw            ?? null,
    shareholderEquity: r.totalStockholderEquity?.raw ?? null,
  }));

  // Sort by date descending (most recent first), take 4
  const quarterlyResults = Object.values(byDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 4);

  return {
    currency:        price.currency                  ?? null,
    marketCap:       price.marketCap?.raw            ?? null,
    trailingPE:      sd.trailingPE?.raw              ?? null,
    forwardPE:       sd.forwardPE?.raw               ?? null,
    trailingEps:     ks.trailingEps?.raw             ?? null,
    forwardEps:      ks.forwardEps?.raw              ?? null,
    volume:          price.regularMarketVolume?.raw  ?? null,
    averageVolume:   sd.averageVolume?.raw           ?? null,
    fiftyTwoWeekHigh: sd.fiftyTwoWeekHigh?.raw      ?? null,
    fiftyTwoWeekLow:  sd.fiftyTwoWeekLow?.raw       ?? null,
    beta:            sd.beta?.raw                    ?? null,
    dividendYield:   sd.dividendYield?.raw           ?? null,
    dividendRate:    sd.dividendRate?.raw            ?? null,
    profitMargins:   fd.profitMargins?.raw           ?? null,
    grossMargins:    fd.grossMargins?.raw            ?? null,
    revenueGrowth:   fd.revenueGrowth?.raw           ?? null,
    totalRevenue:    fd.totalRevenue?.raw            ?? null,
    totalDebt:       fd.totalDebt?.raw               ?? null,
    targetMeanPrice: fd.targetMeanPrice?.raw         ?? null,
    quarterlyResults,
    partial: false,
    dataSource: 'yahoo',
    asOf: safeDate(price.regularMarketTime?.raw),
    asOfPrecision: 'timestamp',
  };
}

const TWELVE_INTERVALS = {
  '1m': ['1min', 60], '5m': ['5min', 300], '15m': ['15min', 900],
  '30m': ['30min', 1800], '60m': ['1h', 3600], '1h': ['1h', 3600],
  '1d': ['1day', 86_400], '1wk': ['1week', 604_800],
  // Using the shortest month safely overestimates monthly bar count.
  '1mo': ['1month', 2_419_200],
};

function twelveDateWindow(range, intervalSeconds) {
  const end = new Date();
  const start = new Date(end);
  if (range === 'max') return { outputsize: 5000 };
  if (range === 'ytd') {
    start.setUTCMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    const match = /^(\d+)(d|mo|y)$/.exec(range);
    if (!match) throw new Error('Unsupported market data range.');
    const amount = Number(match[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000) {
      throw new Error('Unsupported market data range.');
    }
    if (match[2] === 'd') {
      start.setUTCDate(start.getUTCDate() - amount);
    } else {
      // Clamp month ends (e.g. March 31 minus one month is February 28).
      const day = start.getUTCDate();
      start.setUTCDate(1);
      start.setUTCMonth(start.getUTCMonth() - amount * (match[2] === 'y' ? 12 : 1));
      const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
      start.setUTCDate(Math.min(day, lastDay));
    }
  }
  // Size by interval and calendar duration, not by assumed US trading days.
  // Date bounds prevent an oversized estimate from returning an older range.
  const outputsize = Math.min(5000, Math.ceil((end - start) / (intervalSeconds * 1000)) + 1);
  const precision = intervalSeconds < 86_400 ? 19 : 10;
  return {
    outputsize,
    start_date: start.toISOString().slice(0, precision),
    // Daily and longer bars use exchange dates. Let the provider choose "now"
    // so an exchange already on tomorrow's UTC date keeps its latest session.
    ...(intervalSeconds < 86_400 ? { end_date: end.toISOString().slice(0, precision) } : {}),
  };
}

function twelveBarDate(value, intraday) {
  if (typeof value !== 'string') return null;
  const pattern = intraday ? /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(value)) return null;
  // Intraday requests explicitly use UTC. Daily/weekly/monthly values are
  // exchange session dates; midnight UTC encodes the label, not an event time.
  const canonical = intraday ? value.replace(' ', 'T') : `${value}T00:00:00`;
  const date = new Date(`${canonical}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== canonical) return null;
  return date.toISOString();
}

async function fetchTwelveData(symbol, range, interval) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return [];

  const config = TWELVE_INTERVALS[interval];
  if (!config) throw new Error('Unsupported Twelve Data interval.');
  const [tdInterval, intervalSeconds] = config;
  const window = twelveDateWindow(range, intervalSeconds);
  const data = await fetchJson('https://api.twelvedata.com/time_series', {
    symbol,
    interval: tdInterval,
    ...window,
    apikey: key,
    order: 'asc',
    timezone: 'UTC',
  });
  if (data?.status === 'error' || !Array.isArray(data?.values)) return [];
  return data.values.map((bar) => ({
    date: twelveBarDate(bar?.datetime, intervalSeconds < 86_400),
    open: finiteNumber(bar?.open),
    high: finiteNumber(bar?.high),
    low: finiteNumber(bar?.low),
    close: finiteNumber(bar?.close),
    volume: finiteNumber(bar?.volume),
    source: 'twelvedata',
    currency: data.meta?.currency ?? null,
    exchangeTimezone: data.meta?.exchange_timezone ?? null,
    datePrecision: intervalSeconds < 86_400 ? 'timestamp' : 'date',
    // A capped result may not cover the full requested range; disclose it.
    historyMayBeTruncated: data.values.length >= 5000,
  }))
    .filter((row) => row.date != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function generateMockHistory(symbol, periods = 200) {
  const seed = Array.from(symbol)
    .reduce((acc, char) => acc + char.charCodeAt(0), 0) % 2147483647;
  const rand = (() => {
    let value = seed || 1;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  })();

  const endDate = new Date();
  const history = [];
  let price = 100 + rand() * 20;

  for (let i = periods - 1; i >= 0; i -= 1) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) {
      continue; // skip weekends
    }
    const change = (rand() - 0.5) * 2; // [-1,1]
    price = Math.max(5, price * (1 + change * 0.01));
    const high = price * (1 + rand() * 0.01);
    const low = price * (1 - rand() * 0.01);
    const open = price * (1 + (rand() - 0.5) * 0.01);
    const volume = Math.round(2_000_000 + rand() * 4_000_000);
    history.push({
      date: date.toISOString(),
      open,
      high: Math.max(open, high, price),
      low: Math.min(open, low, price),
      close: price,
      volume,
      source: 'synthetic',
    });
  }

  return history;
}
