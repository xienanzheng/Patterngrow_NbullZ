// Configuration inventory only: never exposes credentials or implies a successful health check.
export function getProviderStatus() {
  const primary = process.env.MARKET_DATA_PROVIDER === 'twelvedata' ? 'twelvedata' : 'yahoo';
  return {
    mode: 'historical-research',
    generatedAt: new Date().toISOString(),
    primary,
    providers: [
      {
        id: 'yahoo', name: 'Yahoo Finance', configured: true,
        role: primary === 'yahoo' ? 'Primary prices' : 'Fallback prices',
        capabilities: ['OHLCV history', 'Quotes', 'Partial fundamentals'],
        delay: 'Unverified', url: 'https://finance.yahoo.com/',
        notes: 'Unofficial endpoints; availability and coverage are not guaranteed.',
      },
      {
        id: 'twelvedata', name: 'Twelve Data', configured: Boolean(process.env.TWELVE_DATA_API_KEY),
        role: primary === 'twelvedata' ? 'Primary prices' : 'Fallback prices',
        capabilities: ['OHLCV history'], delay: 'Depends on subscription and exchange',
        url: 'https://twelvedata.com/docs',
        notes: 'Historical bars through the documented API. Exchange coverage and display rights depend on your agreement.',
      },
      {
        id: 'massive', name: 'Massive / Polygon', configured: Boolean(process.env.POLYGON_API_KEY),
        role: 'Company reference', capabilities: ['Company descriptions', 'Exchange metadata'],
        delay: 'Reference data', url: 'https://massive.com/docs',
        notes: 'The current integration supplies company details only; price bars are not connected.',
      },
      {
        id: 'alphavantage', name: 'Alpha Vantage', configured: Boolean(process.env.ALPHA_VANTAGE_KEY),
        role: 'News', capabilities: ['Headlines', 'News sentiment'],
        delay: 'Provider publication times', url: 'https://www.alphavantage.co/documentation/',
        notes: 'Optional news feed; sentiment is provider-generated and is not a forecast.',
      },
    ],
  };
}
