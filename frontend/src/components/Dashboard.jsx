import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import WatchlistTable from './WatchlistTable';
import StockChart from './StockChart';
import AdvancedBacktest from './AdvancedBacktest';
import MiniAssistant from './MiniAssistant';
import { getInsights, getMetadata, getNews, upsertMetadataRow, uploadMetadataCsv } from '../services/api';

const formatCurrency = (value) => {
  if (value == null) return 'N/A';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
};

const formatPercent = (value) => {
  if (value == null) return 'N/A';
  return `${value.toFixed(2)}%`;
};

const PRICE_RANGES = [
  { label: '1 Month', value: '1mo' },
  { label: '3 Months', value: '3mo' },
  { label: '6 Months', value: '6mo' },
  { label: '1 Year', value: '1y' },
  { label: '2 Years', value: '2y' },
  { label: '5 Years', value: '5y' },
];

const INDICATORS = [
  { label: 'Simple Moving Average', value: 'sma' },
  { label: 'Relative Strength Index', value: 'rsi' },
  { label: 'MACD', value: 'macd' },
  { label: 'Bollinger Bands', value: 'bollinger' },
  { label: 'Stochastic Oscillator', value: 'stochastic' },
  { label: 'VWAP', value: 'vwap' },
];

const FORECAST_MODELS = [
  { label: 'Simple Trend', value: 'simple' },
  { label: 'ARIMA Inspired', value: 'arima' },
  { label: 'Prophet Inspired', value: 'prophet' },
];

const TABS = [
  { id: 'overview', label: 'Market Overview' },
  { id: 'metadata', label: 'Metadata Explorer' },
  { id: 'advanced', label: 'Advanced Lab' },
  { id: 'assistant', label: 'Mini NZ Assistant' },
];

export default function Dashboard({ user, session, onSignOut }) {
  const [symbol, setSymbol] = useState('AAPL');
  const [range, setRange] = useState('1y');
  const [selectedIndicators, setSelectedIndicators] = useState(['sma', 'bollinger']);
  const [forecastModel, setForecastModel] = useState('simple');
  const [initialCapital, setInitialCapital] = useState(10000);

  const [stockData, setStockData] = useState([]);
  const [quote, setQuote] = useState(null);
  const [newsItems, setNewsItems] = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState(null);
  const [metadataRows, setMetadataRows] = useState([]);
  const [metadataFacets, setMetadataFacets] = useState(null);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState(null);
  const [ipoYearMin, setIpoYearMin] = useState(1990);
  const [facetFilters, setFacetFilters] = useState({
    sector: '',
    region: '',
    marketCapBucket: '',
    riskBucket: '',
    styleFactor: '',
  });
  const [metadataEntry, setMetadataEntry] = useState(null);
  const [metadataPage, setMetadataPage] = useState(1);
  const itemsPerPage = 10;
  const [newTicker, setNewTicker] = useState({ symbol: '', name: '', sector: '', region: '', ipoYear: '' });
  const [csvText, setCsvText] = useState('');
  const [metadataActionStatus, setMetadataActionStatus] = useState('');

  const [backtestSummary, setBacktestSummary] = useState(null);
  const [simulationSeries, setSimulationSeries] = useState([]);
  const [simulationSummary, setSimulationSummary] = useState(null);
  const [predictionSeries, setPredictionSeries] = useState([]);
  const [indicatorSnapshots, setIndicatorSnapshots] = useState(null);
  const [momentum, setMomentum] = useState(null);
  const [priceTargets, setPriceTargets] = useState(null);
  const [technicalSummary, setTechnicalSummary] = useState(null);
  const [dataSource, setDataSource] = useState('yahoo');
  const [activeTab, setActiveTab] = useState('overview');

  const primaryIndicator = selectedIndicators[0] ?? 'sma';

  const applyInsights = useCallback((payload) => {
    if (!payload) {
      setStockData([]);
      setQuote(null);
      setBacktestSummary(null);
      setSimulationSeries([]);
      setSimulationSummary(null);
      setPredictionSeries([]);
      setIndicatorSnapshots(null);
      setMomentum(null);
      setPriceTargets(null);
      setTechnicalSummary(null);
      setDataSource('unavailable');
      setMetadataEntry(null);
      return;
    }

    setStockData(payload.history ?? []);
    setQuote(payload.quote ?? null);
    setMetadataEntry(payload.metadata ?? null);

    const totalSignals = (payload.signalSummary?.buy ?? 0) + (payload.signalSummary?.sell ?? 0);
    const enrichedSignals = (payload.signals ?? [])
      .map((entry, index) => ({
        ...entry,
        date: payload.history?.[index]?.date ?? null,
      }))
      .filter((entry) => entry.signal !== 'hold');

    setBacktestSummary({
      indicator: payload.indicator,
      totalSignals,
      buySignals: payload.signalSummary?.buy ?? 0,
      sellSignals: payload.signalSummary?.sell ?? 0,
      sampleSignals: enrichedSignals.slice(-5),
    });

    setSimulationSeries(payload.simulation ?? []);
    setSimulationSummary(payload.simulationSummary ?? null);
    setPredictionSeries(payload.forecast ?? []);
    setIndicatorSnapshots(payload.indicatorSnapshots ?? null);
    setMomentum(payload.momentum ?? null);
    setPriceTargets(payload.priceTargets ?? null);
    setDataSource(payload.dataSource ?? 'yahoo');
    setTechnicalSummary(payload.technicalSummary ?? null);
  }, []);

  const loadInsights = useCallback(
    async ({ silent = false, cancelRef } = {}) => {
      if (!silent) setInsightsLoading(true);
      setInsightsError(null);

      try {
        const payload = await getInsights(symbol, {
          range,
          interval: '1d',
          indicator: primaryIndicator,
          forecastModel,
          initialCapital,
        });

        if (cancelRef?.current) return;
        applyInsights(payload);
      } catch (err) {
        if (cancelRef?.current) return;
        console.error('Failed to load analytics', err);
        setInsightsError(err instanceof Error ? err.message : 'Unable to load analytics right now.');
        applyInsights(null);
      } finally {
        if (!silent && !cancelRef?.current) setInsightsLoading(false);
      }
    },
    [applyInsights, symbol, range, primaryIndicator, forecastModel, initialCapital],
  );

  useEffect(() => {
    const cancelRef = { current: false };
    loadInsights({ cancelRef });
    return () => {
      cancelRef.current = true;
    };
  }, [loadInsights]);

  useEffect(() => {
    let cancelled = false;
    const loadNews = async () => {
      try {
        const payload = await getNews(symbol);
        if (!cancelled) setNewsItems(payload?.news ?? []);
      } catch (err) {
        if (!cancelled) {
          console.warn('News unavailable', err);
          setNewsItems([]);
        }
      }
    };
    loadNews();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setMetadataLoading(true);
      setMetadataError(null);
      try {
        const payload = await getMetadata();
        if (cancelled) return;
        setMetadataRows(payload?.rows ?? []);
        setMetadataFacets(payload?.facets ?? null);
      } catch (err) {
        if (cancelled) return;
        setMetadataRows([]);
        setMetadataFacets(null);
        setMetadataError(err instanceof Error ? err.message : 'Unable to load metadata.');
      } finally {
        if (!cancelled) setMetadataLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRunBacktest = () => {
    loadInsights();
  };

  const handleRunSimulation = () => {
    loadInsights();
  };

  const handleGeneratePrediction = () => {
    loadInsights();
  };

  const chartData = useMemo(() => {
    const base = stockData.map((row) => ({
      ...row,
      isForecast: false,
      forecast: null,
    }));

    if (predictionSeries.length > 0) {
      const lastClose = stockData.at(-1)?.close ?? null;
      predictionSeries.forEach((point, index) => {
        base.push({
          date: point.date,
          close: index === 0 && lastClose != null ? lastClose : null,
          high: null,
          low: null,
          open: null,
          volume: null,
          forecast: point.value,
          isForecast: true,
        });
      });
    }

    return base;
  }, [stockData, predictionSeries]);

  const simulationChart = useMemo(
    () =>
      simulationSeries.map((row) => ({
        date: row.date,
        value: row.value,
      })),
    [simulationSeries],
  );

  const finalPortfolioValue = simulationSummary?.finalValue ?? simulationChart.at(-1)?.value ?? null;
  const totalReturn = simulationSummary?.totalReturn ?? (finalPortfolioValue != null
    ? ((finalPortfolioValue - initialCapital) / initialCapital) * 100
    : null);

  const currentMetadata = useMemo(() => {
    if (metadataEntry) return metadataEntry;
    return metadataRows.find((row) => row.symbol === symbol) ?? null;
  }, [metadataEntry, metadataRows, symbol]);

  const currentIndustryLabel = currentMetadata
    ? currentMetadata.industryGroup || currentMetadata.industry_group || currentMetadata.sector
    : null;
  const currentStyleFactors = currentMetadata?.styleFactors || currentMetadata?.style_factors || [];
  const currentPrototypeScore = currentMetadata?.prototypeScore ?? currentMetadata?.prototype_score ?? null;
  const currentIpoYear = currentMetadata?.ipo_year ?? currentMetadata?.ipoYear ?? null;

  const filteredMetadata = useMemo(() => {
    return metadataRows
      .filter((row) => {
        if (ipoYearMin && row.ipo_year && row.ipo_year < ipoYearMin) {
          return false;
        }
        if (facetFilters.sector && row.sector !== facetFilters.sector) return false;
        if (facetFilters.region && row.region !== facetFilters.region) return false;
        if (facetFilters.marketCapBucket && (row.marketCapBucket ?? row.market_cap_bucket) !== facetFilters.marketCapBucket) return false;
        if (facetFilters.riskBucket && (row.riskBucket ?? row.risk_bucket) !== facetFilters.riskBucket) return false;
        if (facetFilters.styleFactor && !(row.styleFactors || row.style_factors || []).includes(facetFilters.styleFactor)) return false;
        return true;
      })
      .sort((a, b) => (b.ipo_year ?? 0) - (a.ipo_year ?? 0));
  }, [facetFilters.marketCapBucket, facetFilters.region, facetFilters.riskBucket, facetFilters.sector, facetFilters.styleFactor, ipoYearMin, metadataRows]);

  const totalPages = Math.max(1, Math.ceil(filteredMetadata.length / itemsPerPage));
  const safePage = Math.min(metadataPage, totalPages);
  const visibleMetadata = filteredMetadata.slice(0, safePage * itemsPerPage);

  useEffect(() => {
    setMetadataPage(1);
  }, [facetFilters.marketCapBucket, facetFilters.region, facetFilters.riskBucket, facetFilters.sector, facetFilters.styleFactor, ipoYearMin, metadataRows]);

  const indicatorSnapshotDisplay = useMemo(() => {
    const snapshot = indicatorSnapshots?.[primaryIndicator];
    if (snapshot == null) return '--';
    if (typeof snapshot === 'number') return snapshot.toFixed(2);
    if (typeof snapshot === 'object') {
      if (primaryIndicator === 'bollinger') {
        return snapshot.middle != null ? `$${snapshot.middle.toFixed(2)}` : '--';
      }
      if (primaryIndicator === 'macd') {
        if (snapshot.divergence != null) {
          return `Δ ${snapshot.divergence.toFixed(2)}`;
        }
        if (snapshot.macd != null && snapshot.signal != null) {
          return `${snapshot.macd.toFixed(2)} | ${snapshot.signal.toFixed(2)}`;
        }
      }
      if (primaryIndicator === 'stochastic') {
        if (snapshot.percentK != null && snapshot.percentD != null) {
          return `K ${snapshot.percentK.toFixed(1)} / D ${snapshot.percentD.toFixed(1)}`;
        }
      }
      if (primaryIndicator === 'adx') {
        if (snapshot.adx != null) {
          const plus = snapshot.plusDI != null ? snapshot.plusDI.toFixed(1) : '--';
          const minus = snapshot.minusDI != null ? snapshot.minusDI.toFixed(1) : '--';
          return `${snapshot.adx.toFixed(2)} ( +DI ${plus} / −DI ${minus} )`;
        }
      }
    }
    return String(snapshot);
  }, [indicatorSnapshots, primaryIndicator]);

  return (
    <div className="min-h-screen bg-slate-950 pb-16">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">AI Stock Intelligence Console</h1>
            <p className="text-sm text-slate-400">
              Build data-informed conviction with technical studies, simulations, watchlists, and AI helpers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user?.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt={user.user_metadata.full_name ?? user.email}
                className="h-10 w-10 rounded-full border border-slate-700 object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-sm font-semibold text-white">
                {user?.email?.slice(0, 2)?.toUpperCase() ?? 'U'}
              </div>
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-white">
                {user?.user_metadata?.full_name ?? user?.email ?? 'Signed In'}
              </p>
              <p className="text-xs text-slate-400">Google OAuth via Supabase</p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-red-400 hover:text-red-300"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="border-t border-slate-800 bg-slate-900/60">
          <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto px-6 py-2">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                    active ? 'bg-blue-500/20 text-blue-200' : 'text-slate-400 hover:text-blue-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto mt-10 max-w-7xl px-6">
        {activeTab === 'overview' ? (
          <div className="flex flex-col gap-6 lg:flex-row">
            <aside className="flex w-full flex-col gap-6 lg:w-80">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner">
            <h2 className="text-lg font-semibold text-white">Symbol</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">Ticker</label>
                <input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">Range</label>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  {PRICE_RANGES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner">
            <h2 className="text-lg font-semibold text-white">Technical Indicators</h2>
            <p className="mb-4 text-xs text-slate-400">Select up to 4 indicators to overlay and evaluate.</p>
            <div className="space-y-2">
              {INDICATORS.map((indicator) => {
                const active = selectedIndicators.includes(indicator.value);
                return (
                  <label
                    key={indicator.value}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      active ? 'border-blue-500/60 bg-blue-500/10 text-slate-100' : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <span>{indicator.label}</span>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedIndicators((prev) => [...new Set([...prev, indicator.value])]);
                        } else {
                          setSelectedIndicators((prev) => prev.filter((item) => item !== indicator.value));
                        }
                      }}
                      className="h-4 w-4 accent-blue-500"
                    />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner">
            <h2 className="text-lg font-semibold text-white">Forecast & Simulation</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">Forecast Model</label>
                <select
                  value={forecastModel}
                  onChange={(event) => setForecastModel(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  {FORECAST_MODELS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-slate-400">Initial Capital ($)</label>
                <input
                  type="number"
                  min="1000"
                  step="100"
                  value={initialCapital}
                  onChange={(event) => setInitialCapital(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div className="flex flex-col gap-2 md:flex-row">
                <button
                  type="button"
                  onClick={handleRunBacktest}
                  className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                >
                  Backtest Signals
                </button>
                <button
                  type="button"
                  onClick={handleRunSimulation}
                  className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-400"
                >
                  Run Simulation
                </button>
              </div>
              <button
                type="button"
                onClick={handleGeneratePrediction}
                className="w-full rounded-lg border border-blue-500/60 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-200 transition hover:border-blue-400/80 hover:bg-blue-500/20"
              >
                Generate 60-day Forecast
              </button>
            </div>
          </section>

            <WatchlistTable
              user={session?.user ?? user}
              accessToken={session?.access_token}
              activeSymbol={symbol}
              onSelectSymbol={(ticker) => setSymbol(ticker)}
            />
          </aside>

          <section className="flex-1 space-y-6">
          {insightsError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
              {insightsError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-400">Last Price</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {quote?.regularMarketPrice != null ? `$${quote.regularMarketPrice.toFixed(2)}` : '--'}
              </p>
              <p
                className={`text-xs ${
                  (quote?.regularMarketChangePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {quote?.regularMarketChangePercent != null
                  ? formatPercent(quote.regularMarketChangePercent)
                  : 'N/A'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-400">Market Cap</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {quote?.marketCap ? formatCurrency(quote.marketCap) : '--'}
              </p>
              <p className="text-xs text-slate-400">Avg Volume: {quote?.averageDailyVolume10Day?.toLocaleString() ?? 'N/A'}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-400">Momentum</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {momentum?.change != null ? formatCurrency(momentum.change) : '--'}
              </p>
              <p
                className={`text-xs ${
                  (momentum?.changePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {momentum?.changePercent != null ? formatPercent(momentum.changePercent) : 'N/A'}
              </p>
            </div>
          </div>

          {technicalSummary ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold text-white">Technical Snapshot</h3>
              <p className="mt-2 text-sm text-slate-300">{technicalSummary}</p>
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Price Action</h3>
                <p className="text-xs text-slate-400">
                  Indicators are calculated client-side for responsive overlays. Server-side analytics keep Supabase-friendly parity with the legacy Streamlit build.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Data source: {dataSource === 'yahoo' ? 'Yahoo Finance' : dataSource === 'google' ? 'Google Finance fallback' : 'Synthetic sample (offline)'}.
                </p>
              </div>
              {insightsLoading ? (
                <span className="text-xs uppercase tracking-wide text-blue-300">Loading…</span>
              ) : null}
            </div>
            {chartData.length > 0 ? (
              <StockChart data={chartData} selectedIndicators={selectedIndicators} />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-sm text-slate-500">
                No price history available for the current configuration.
              </div>
            )}
          </div>

          {backtestSummary ? (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold text-white">Signal Rundown</h3>
              <p className="mt-1 text-xs text-slate-400">
                Based on the {backtestSummary.indicator?.toUpperCase()} indicator.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Total Signals</p>
                  <p className="mt-1 text-lg font-semibold text-white">{backtestSummary.totalSignals ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Buy Bias</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-300">{backtestSummary.buySignals ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Sell Bias</p>
                  <p className="mt-1 text-lg font-semibold text-red-300">{backtestSummary.sellSignals ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Latest Snapshot</p>
                  <p className="mt-1 text-sm text-slate-300">{indicatorSnapshotDisplay}</p>
                </div>
              </div>
              {backtestSummary.sampleSignals?.length ? (
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Recent Signals</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-300">
                    {backtestSummary.sampleSignals.map((item, idx) => (
                      <li key={`${item.signal}-${idx}`} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                        <span className="font-semibold text-blue-300">{item.signal}</span>
                        {item.date ? (
                          <span className="ml-2 text-slate-400">{new Date(item.date).toLocaleDateString()}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {simulationSeries.length > 0 ? (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Portfolio Simulation</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Simulated using {primaryIndicator.toUpperCase()} signals on ${initialCapital.toLocaleString()} starting capital.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Initial Capital</p>
                  <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(initialCapital)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Final Value</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {finalPortfolioValue != null ? formatCurrency(finalPortfolioValue) : '--'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Return</p>
                  <p
                    className={`mt-1 text-lg font-semibold ${
                      totalReturn != null && totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {totalReturn != null ? formatPercent(totalReturn) : '--'}
                  </p>
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={simulationChart}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString()} />
                    <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} />
                    <Tooltip
                      formatter={(value) => formatCurrency(value)}
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.75rem' }}
                      labelFormatter={(value) => `Date: ${new Date(value).toLocaleDateString()}`}
                    />
                    <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          ) : null}

          {predictionSeries.length > 0 ? (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold text-white">Forecast Highlights</h3>
              <p className="mt-2 text-sm text-slate-400">
                Forecasts extend 60 trading days ahead using server-backed heuristics translated from the Streamlit workflow.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-slate-300 md:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Model</p>
                  <p className="mt-1 font-semibold text-white">{forecastModel.toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Base</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.base ? `$${priceTargets.base.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Optimistic</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.optimistic ? `$${priceTargets.optimistic.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Conservative</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.conservative ? `$${priceTargets.conservative.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h3 className="text-lg font-semibold text-white">Market Narrative</h3>
            {newsItems.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">
                News sentiment requires an Alpha Vantage key (optional). Configure `ALPHA_VANTAGE_KEY` for the backend or `VITE_ALPHA_VANTAGE_KEY` for the client proxy to activate feed ingestion.
              </p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                {newsItems.map((item) => (
                  <li key={item.url} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-300">
                      {item.title}
                    </a>
                    <p className="mt-1 text-xs text-slate-400">{item.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </section>
        </div>
        ) : null}

        {activeTab === 'metadata' ? (
          <div className="flex flex-col gap-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Metadata Explorer</h3>
                  <p className="text-xs text-slate-400">
                    Rule-based regions, faceted tags, IPO-year filtering, and search across symbols/names.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    IPO year min ({ipoYearMin})
                    <input
                      type="range"
                      min="1975"
                      max={new Date().getFullYear()}
                      step="1"
                      value={ipoYearMin}
                      onChange={(event) => setIpoYearMin(Number(event.target.value))}
                      className="mt-1 w-48 accent-blue-500"
                    />
                  </label>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Sector
                    <select
                      value={facetFilters.sector}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, sector: event.target.value }))}
                      className="mt-1 w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="">All</option>
                      {(metadataFacets?.sector ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Region
                    <select
                      value={facetFilters.region}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, region: event.target.value }))}
                      className="mt-1 w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="">All</option>
                      {(metadataFacets?.region ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Risk Bucket
                    <select
                      value={facetFilters.riskBucket}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, riskBucket: event.target.value }))}
                      className="mt-1 w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="">All</option>
                      {(metadataFacets?.risk_bucket ?? metadataFacets?.riskBucket ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Style Factor
                    <select
                      value={facetFilters.styleFactor}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, styleFactor: event.target.value }))}
                      className="mt-1 w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="">All</option>
                      {(metadataFacets?.style_factors ?? metadataFacets?.styleFactors ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {metadataError ? (
                <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {metadataError}
                </p>
              ) : null}

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Current Symbol</p>
                  {currentMetadata ? (
                    <div className="mt-2 space-y-1 text-sm text-slate-200">
                      <p className="text-lg font-semibold text-white">{currentMetadata.symbol}</p>
                      <p className="text-slate-400">{currentIndustryLabel} · {currentMetadata.region}</p>
                      <p className="text-slate-300">
                        IPO Year: <span className="font-semibold text-blue-300">{currentIpoYear ?? '--'}</span>
                      </p>
                      {currentPrototypeScore != null ? (
                        <p className="text-slate-300">
                          Prototype score: <span className="font-semibold text-blue-300">{Number(currentPrototypeScore).toFixed(2)}</span>
                        </p>
                      ) : null}
                      <p className="text-xs text-slate-400">
                        {currentMetadata.evidence}
                      </p>
                      {currentStyleFactors.length ? (
                        <p className="text-xs text-slate-500">Style: {currentStyleFactors.join(', ')}</p>
                      ) : null}
                    </div>
                  ) : metadataLoading ? (
                    <p className="mt-2 text-sm text-slate-400">Loading metadata…</p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">No metadata available for {symbol}.</p>
                  )}
                </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Facet Summary</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-300">
                  <li>Sector → {facetFilters.sector || 'Any'}</li>
                  <li>Region → {facetFilters.region || 'Any'}</li>
                    <li>Risk → {facetFilters.riskBucket || 'Any'}</li>
                    <li>Style → {facetFilters.styleFactor || 'Any'}</li>
                    <li>IPO Year ≥ {ipoYearMin}</li>
                    <li>Matches → {filteredMetadata.length}</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Faceted Retrieval Examples</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-300">
                    <li className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">US · High Vol · Momentum → AI-adjacent semis</li>
                    <li className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">EU · Growth → Lithography prototype</li>
                    <li className="rounded-lg border border-slate-800 bg-slate-900/80 p-2">Mega Cap · Low Vol → Core software</li>
                  </ul>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Add Single Ticker</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="Symbol (required)"
                      value={newTicker.symbol}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, symbol: e.target.value }))}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    <input
                      type="text"
                      placeholder="Name"
                      value={newTicker.name}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, name: e.target.value }))}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    <input
                      type="text"
                      placeholder="Sector"
                      value={newTicker.sector}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, sector: e.target.value }))}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    <input
                      type="text"
                      placeholder="Region"
                      value={newTicker.region}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, region: e.target.value }))}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    <input
                      type="number"
                      placeholder="IPO Year"
                      value={newTicker.ipoYear}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, ipoYear: e.target.value }))}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setMetadataActionStatus('');
                      if (!newTicker.symbol.trim()) {
                        setMetadataActionStatus('Symbol is required to add a ticker.');
                        return;
                      }
                      try {
                        await upsertMetadataRow({
                          symbol: newTicker.symbol,
                          name: newTicker.name || undefined,
                          sector: newTicker.sector || undefined,
                          region: newTicker.region || undefined,
                          ipo_year: newTicker.ipoYear ? Number(newTicker.ipoYear) : undefined,
                        });
                        setMetadataActionStatus(`Saved ${newTicker.symbol.toUpperCase()}.`);
                        setNewTicker({ symbol: '', name: '', sector: '', region: '', ipoYear: '' });
                        const payload = await getMetadata();
                        setMetadataRows(payload?.rows ?? []);
                        setMetadataFacets(payload?.facets ?? null);
                      } catch (err) {
                        setMetadataActionStatus(err instanceof Error ? err.message : 'Unable to add ticker.');
                      }
                    }}
                    className="mt-3 rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-blue-900 transition hover:bg-blue-400"
                  >
                    Add Ticker
                  </button>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Upload CSV (header: symbol,name,sector,region,ipo_year)</p>
                  <textarea
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    rows={6}
                    placeholder="symbol,name,sector,region,ipo_year&#10;AAPL,Apple Inc.,Technology,US,1980"
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setMetadataActionStatus('');
                      if (!csvText.trim()) {
                        setMetadataActionStatus('Paste CSV text before uploading.');
                        return;
                      }
                      try {
                        await uploadMetadataCsv(csvText);
                        setMetadataActionStatus('CSV uploaded.');
                        setCsvText('');
                        const payload = await getMetadata();
                        setMetadataRows(payload?.rows ?? []);
                        setMetadataFacets(payload?.facets ?? null);
                      } catch (err) {
                        setMetadataActionStatus(err instanceof Error ? err.message : 'Unable to upload CSV.');
                      }
                    }}
                    className="mt-3 rounded-lg border border-blue-500/60 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-200 transition hover:border-blue-400 hover:bg-blue-500/20"
                  >
                    Upload CSV
                  </button>
                </div>
              </div>

              {metadataActionStatus ? (
                <p className="mt-3 text-sm text-blue-200">{metadataActionStatus}</p>
              ) : null}

              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
                  <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-2 text-left">Symbol</th>
                      <th className="px-4 py-2 text-left">Sector</th>
                      <th className="px-4 py-2 text-left">Region</th>
                      <th className="px-4 py-2 text-left">IPO Year</th>
                      <th className="px-4 py-2 text-left">Prototype</th>
                      <th className="px-4 py-2 text-left">Risk</th>
                      <th className="px-4 py-2 text-left">Style</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {metadataLoading ? (
                      <tr>
                        <td colSpan="7" className="px-4 py-3 text-slate-400">Loading metadata…</td>
                      </tr>
                    ) : filteredMetadata.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="px-4 py-3 text-slate-500">No tickers match the current facet selection.</td>
                      </tr>
                    ) : (
                      visibleMetadata.map((row) => (
                        <tr key={row.symbol} className={row.symbol === symbol ? 'bg-blue-500/5' : ''}>
                          <td className="px-4 py-2 font-semibold text-white">{row.symbol}</td>
                          <td className="px-4 py-2 text-slate-300">{row.industryGroup || row.industry_group || row.sector}</td>
                          <td className="px-4 py-2 text-slate-300">{row.region}</td>
                          <td className="px-4 py-2 text-slate-300">{row.ipo_year ?? row.ipoYear ?? '--'}</td>
                          <td className="px-4 py-2 text-blue-300">
                            {row.prototypeScore != null
                              ? row.prototypeScore.toFixed(2)
                              : row.prototype_score != null
                                ? Number(row.prototype_score).toFixed(2)
                                : '--'}
                          </td>
                          <td className="px-4 py-2">{row.riskBucket || row.risk_bucket}</td>
                          <td className="px-4 py-2 text-slate-300">{(row.styleFactors || row.style_factors || []).join(', ')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
                <span>
                  Showing {Math.min(visibleMetadata.length, filteredMetadata.length)} of {filteredMetadata.length} tickers
                  {totalPages > 1 ? ` · Page ${safePage}/${totalPages}` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMetadataPage((prev) => Math.max(1, prev - 1))}
                    disabled={safePage <= 1}
                    className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-blue-500 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetadataPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safePage >= totalPages}
                    className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-blue-500 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetadataPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safePage >= totalPages}
                    className="rounded-lg border border-blue-500/60 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-200 transition hover:border-blue-400 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Load more
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'advanced' ? <AdvancedBacktest /> : null}

        {activeTab === 'assistant' ? <MiniAssistant /> : null}
      </main>

      <footer className="mx-auto mt-10 max-w-7xl px-6 text-xs text-slate-500">
        <p>
          Node.js analytics keep the architecture aligned with Vercel deployments while Supabase powers auth, storage, and realtime watchlists.
        </p>
      </footer>
    </div>
  );
}
