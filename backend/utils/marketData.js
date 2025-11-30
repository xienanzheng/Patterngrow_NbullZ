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
    const fallback = await fetchGoogleHistory(symbol, range, interval);
    if (fallback.length === 0) {
      throw error;
    }
    return fallback;
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
