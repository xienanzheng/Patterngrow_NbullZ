const yahooBase = (process.env.YAHOO_FINANCE_API_BASE ?? 'https://query1.finance.yahoo.com').replace(/\/$/, '');
const alphaVantageKey = process.env.ALPHA_VANTAGE_KEY;

const safeDate = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
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
  const response = await fetch(target, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
  }
  return response.json();
}

export async function fetchYahooHistory(symbol, range = '1y', interval = '1d') {
  try {
    const data = await fetchJson(`${yahooBase}/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      range,
      interval,
      events: 'div,split',
    });
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.quote?.[0]) {
      throw new Error('Yahoo Finance history unavailable.');
    }
    const quote = result.indicators.quote[0];
    return result.timestamp
      .map((time, index) => ({
        date: safeDate(time),
        open: quote.open?.[index] ?? null,
        high: quote.high?.[index] ?? null,
        low: quote.low?.[index] ?? null,
        close: quote.close?.[index] ?? null,
        volume: quote.volume?.[index] ?? null,
        source: 'yahoo',
      }))
      .filter((row) => row.date != null);
  } catch (error) {
    // Intraday intervals are not supported by Google Finance — skip straight to Twelve Data
    const isIntraday = interval === '5m' || interval === '15m' || interval === '1h';
    if (!isIntraday) {
      const googleData = await fetchGoogleHistory(symbol, range, interval);
      if (googleData.length > 0) return googleData;
    }
    const twelveData = await fetchTwelveData(symbol, range, interval);
    if (twelveData.length > 0) return twelveData;
    throw error;
  }
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
  try {
    const data = await fetchJson(`${yahooBase}/v7/finance/quote`, { symbols: symbol });
    const quote = data?.quoteResponse?.result?.[0];
    if (!quote) {
      throw new Error('Quote not available.');
    }
    return quote;
  } catch (error) {
    const history = await fetchGoogleHistory(symbol, '1mo', '1d');
    if (!history.length) throw error;
    const latest = history.at(-1);
    const previous = history.at(-2);
    return {
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
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error('Fundamentals unavailable for this symbol.');

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
    currency:        price.currency                  ?? 'USD',
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
  };
}

async function fetchGoogleHistory(symbol, range = '1y', interval = '1d') {
  const intervalMap = {
    '1d': 86400,
    '1h': 3600,
    '30m': 1800,
    '15m': 900,
  };

  const periodMap = {
    '1mo': '1M',
    '3mo': '3M',
    '6mo': '6M',
    '1y': '1Y',
    '2y': '2Y',
    '5y': '5Y',
  };

  const intervalSeconds = intervalMap[interval] ?? 86400;
  const period = periodMap[range] ?? '6M';

  const url = new URL('https://www.google.com/finance/getprices');
  url.searchParams.set('q', symbol);
  url.searchParams.set('i', intervalSeconds.toString());
  url.searchParams.set('p', period);
  url.searchParams.set('f', 'd,o,h,l,c,v');
  url.searchParams.set('df', 'cpct');

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      Accept: 'text/plain',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    return [];
  }

  const text = await response.text();
  const lines = text.split('\n').map((line) => line.trim());

  let baseTimestamp = null;
  const rows = [];

  for (const line of lines) {
    if (!line || (!/^[0-9]/.test(line) && !line.startsWith('a'))) continue;
    const parts = line.split(',');
    if (parts.length < 6) continue;

    let timestamp;
    if (parts[0].startsWith('a')) {
      baseTimestamp = Number(parts[0].slice(1));
      timestamp = baseTimestamp;
    } else if (baseTimestamp != null) {
      timestamp = baseTimestamp + Number(parts[0]) * intervalSeconds;
    } else {
      continue;
    }

    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    const volume = Number(parts[5]);

    rows.push({
      date: safeDate(timestamp),
      open: Number.isFinite(open) ? open : null,
      high: Number.isFinite(high) ? high : null,
      low: Number.isFinite(low) ? low : null,
      close: Number.isFinite(close) ? close : null,
      volume: Number.isFinite(volume) ? volume : null,
    });
  }

  return rows.filter((row) => row.date != null).map((row) => ({ ...row, source: 'google' }));
}

async function fetchTwelveData(symbol, range, interval) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return [];

  // Map our (range, interval) to Twelve Data params
  const intervalMap = {
    '5m': '5min', '15m': '15min', '1h': '1h',
    '1d': '1day', '1wk': '1week', '1mo': '1month',
  };
  const outputsizeMap = {
    '1d': 78, '5d': 195, '1mo': 22, '3mo': 66, '6mo': 130,
    '1y': 252, '2y': 504, '5y': 1260, 'max': 5000,
  };
  const tdInterval = intervalMap[interval] ?? '1day';
  const outputsize = outputsizeMap[range] ?? 252;

  try {
    const data = await fetchJson('https://api.twelvedata.com/time_series', {
      symbol,
      interval: tdInterval,
      outputsize,
      apikey: key,
      order: 'ASC',
    });
    if (data.status === 'error' || !Array.isArray(data.values)) return [];
    return data.values.map((bar) => ({
      date: new Date(bar.datetime).toISOString(),
      open: Number.isFinite(Number(bar.open)) ? Number(bar.open) : null,
      high: Number.isFinite(Number(bar.high)) ? Number(bar.high) : null,
      low: Number.isFinite(Number(bar.low)) ? Number(bar.low) : null,
      close: Number.isFinite(Number(bar.close)) ? Number(bar.close) : null,
      volume: Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : null,
      source: 'twelvedata',
    })).filter((row) => row.date != null);
  } catch {
    return [];
  }
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
