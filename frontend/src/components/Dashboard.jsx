import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import WatchlistTable from './WatchlistTable';
import StockChart from './StockChart';
import AdvancedBacktest from './AdvancedBacktest';
import MiniAssistant from './MiniAssistant';
import RegimePanel from './RegimePanel';
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
  { label: 'Monte Carlo (GBM)', value: 'montecarlo' },
];

const TABS = [
  { id: 'overview', label: 'Market Overview' },
  { id: 'metadata', label: 'Metadata Explorer' },
  { id: 'advanced', label: 'Advanced Lab' },
  { id: 'assistant', label: 'Mini NZ Assistant' },
];

const SIGNAL_STRENGTH = {
  buy_strong: 3,
  buy_medium: 2,
  buy_weak: 1,
  hold: 0,
  sell_weak: -1,
  sell_medium: -2,
  sell_strong: -3,
};

function signalColor(value) {
  if (value >= 3) return '#10b981'; // emerald-500 — strong buy
  if (value >= 2) return '#34d399'; // emerald-400 — medium buy
  if (value >= 1) return '#6ee7b7'; // emerald-300 — weak buy
  if (value <= -3) return '#ef4444'; // red-500 — strong sell
  if (value <= -2) return '#f87171'; // red-400 — medium sell
  return '#fca5a5'; // red-300 — weak sell
}

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
  const [metadataSymbolFilter, setMetadataSymbolFilter] = useState('');
  const [facetFilters, setFacetFilters] = useState({
    sector: '',
    region: '',
    marketCapBucket: '',
    riskBucket: '',
    styleFactor: '',
  });
  const metadataFilters = useMemo(
    () => ({
      symbol: metadataSymbolFilter || undefined,
      sector: facetFilters.sector || undefined,
      region: facetFilters.region || undefined,
      marketCapBucket: facetFilters.marketCapBucket || undefined,
      riskBucket: facetFilters.riskBucket || undefined,
      styleFactor: facetFilters.styleFactor || undefined,
      minIpoYear: ipoYearMin || undefined,
    }),
    [
      facetFilters.marketCapBucket,
      facetFilters.region,
      facetFilters.riskBucket,
      facetFilters.sector,
      facetFilters.styleFactor,
      ipoYearMin,
      metadataSymbolFilter,
    ],
  );
  const [metadataEntry, setMetadataEntry] = useState(null);
  const [metadataPage, setMetadataPage] = useState(1);
  const itemsPerPage = 10;
  const [newTicker, setNewTicker] = useState({ symbol: '', name: '', sector: '', region: '', ipoYear: '' });
  const [csvText, setCsvText] = useState('');
  const [metadataUploading, setMetadataUploading] = useState(false);
  const [metadataActionStatus, setMetadataActionStatus] = useState('');
  const csvFileInputRef = useRef(null);

  const { preferences, loading: prefsLoading, save: savePreferences } = useUserPreferences(
    session?.access_token,
  );

  const prefsApplied = useRef(false);

  useEffect(() => {
    if (prefsLoading || prefsApplied.current) return;
    prefsApplied.current = true;
    if (!preferences) return;
    if (preferences.last_symbol) setSymbol(preferences.last_symbol);
    if (preferences.last_range) setRange(preferences.last_range);
    if (Array.isArray(preferences.selected_indicators) && preferences.selected_indicators.length > 0) {
      setSelectedIndicators(preferences.selected_indicators);
    }
    if (preferences.forecast_model) setForecastModel(preferences.forecast_model);
    if (preferences.initial_capital) setInitialCapital(Number(preferences.initial_capital));
  }, [preferences, prefsLoading]);

  useEffect(() => {
    if (!prefsApplied.current) return;
    savePreferences({
      lastSymbol: symbol,
      lastRange: range,
      selectedIndicators,
      forecastModel,
      initialCapital,
    });
  }, [symbol, range, selectedIndicators, forecastModel, initialCapital, savePreferences]);

  const [backtestSummary, setBacktestSummary] = useState(null);
  const [simulationSeries, setSimulationSeries] = useState([]);
  const [simulationSummary, setSimulationSummary] = useState(null);
  const [predictionSeries, setPredictionSeries] = useState([]);
  const [forecastCloud, setForecastCloud] = useState(null);
  const [signalSeries, setSignalSeries] = useState([]);
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
      setForecastCloud(null);
      setSignalSeries([]);
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
    setSignalSeries(enrichedSignals);

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
    setForecastCloud(payload.forecastCloud ?? null);
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
        const payload = await getMetadata(metadataFilters);
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
  }, [metadataFilters]);

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
        const cloud = forecastCloud;
        base.push({
          date: point.date,
          close: index === 0 && lastClose != null ? lastClose : null,
          high: null, low: null, open: null, volume: null,
          forecast: point.value,
          forecastLower68: point.lower68 ?? null,
          forecastUpper68: point.upper68 ?? null,
          forecastLower95: point.lower95 ?? null,
          forecastUpper95: point.upper95 ?? null,
          // Recharts stacked-area trick: bandHeight = upper - lower
          forecastBand68Height: point.upper68 != null && point.lower68 != null
            ? point.upper68 - point.lower68 : null,
          forecastBand95Height: point.upper95 != null && point.lower95 != null
            ? point.upper95 - point.lower95 : null,
          // MC cloud fields (null when not using montecarlo model)
          mcP5: cloud?.p5[index] ?? null,
          mcP25: cloud?.p25[index] ?? null,
          mcP75: cloud?.p75[index] ?? null,
          mcP95: cloud?.p95[index] ?? null,
          mcBandOuterHeight: cloud ? (cloud.p95[index] ?? 0) - (cloud.p5[index] ?? 0) : null,
          mcBandInnerHeight: cloud ? (cloud.p75[index] ?? 0) - (cloud.p25[index] ?? 0) : null,
          isForecast: true,
        });
      });
    }

    return base;
  }, [stockData, predictionSeries, forecastCloud]);

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
        if (metadataSymbolFilter && row.symbol !== metadataSymbolFilter) return false;
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
  }, [facetFilters.marketCapBucket, facetFilters.region, facetFilters.riskBucket, facetFilters.sector, facetFilters.styleFactor, ipoYearMin, metadataRows, metadataSymbolFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMetadata.length / itemsPerPage));
  const safePage = Math.min(metadataPage, totalPages);
  const visibleMetadata = filteredMetadata.slice(0, safePage * itemsPerPage);

  const symbolMissingFromResults = useMemo(
    () => Boolean(symbol && !metadataLoading && !filteredMetadata.some((row) => row.symbol === symbol)),
    [filteredMetadata, metadataLoading, symbol],
  );

  useEffect(() => {
    setMetadataPage(1);
  }, [facetFilters.marketCapBucket, facetFilters.region, facetFilters.riskBucket, facetFilters.sector, facetFilters.styleFactor, ipoYearMin, metadataRows, metadataSymbolFilter]);

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
    <div className="min-h-screen bg-zinc-950 pb-16">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Patterngrow</h1>
            <p className="text-xs text-zinc-500">
              Technical intelligence for AAPL, TSLA, and beyond.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user?.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt={user.user_metadata.full_name ?? user.email}
                className="h-10 w-10 rounded-full border border-zinc-700 object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-sm font-semibold text-white">
                {user?.email?.slice(0, 2)?.toUpperCase() ?? 'U'}
              </div>
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-white">
                {user?.user_metadata?.full_name ?? user?.email ?? 'Signed In'}
              </p>
              <p className="text-xs text-zinc-400">Google OAuth via Supabase</p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-300 transition hover:border-red-400 hover:text-red-300"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="border-t border-zinc-800 bg-zinc-900/60">
          <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto px-6 py-2">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                    active ? 'bg-amber-400/15 text-amber-200' : 'text-zinc-400 hover:text-amber-200'
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
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-inner">
            <h2 className="text-lg font-semibold text-white">Symbol</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wide text-zinc-400">Ticker</label>
                <input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-zinc-400">Range</label>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
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

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-inner">
            <h2 className="text-lg font-semibold text-white">Technical Indicators</h2>
            <p className="mb-4 text-xs text-zinc-400">Select up to 4 indicators to overlay and evaluate.</p>
            <div className="space-y-2">
              {INDICATORS.map((indicator) => {
                const active = selectedIndicators.includes(indicator.value);
                return (
                  <label
                    key={indicator.value}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      active ? 'border-amber-400/50 bg-amber-400/10 text-zinc-100' : 'border-zinc-700 bg-zinc-950 text-zinc-300'
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
                      className="h-4 w-4 accent-amber-400"
                    />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-inner">
            <h2 className="text-lg font-semibold text-white">Forecast & Simulation</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wide text-zinc-400">Forecast Model</label>
                <select
                  value={forecastModel}
                  onChange={(event) => setForecastModel(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                >
                  {FORECAST_MODELS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-zinc-400">Initial Capital ($)</label>
                <input
                  type="number"
                  min="1000"
                  step="100"
                  value={initialCapital}
                  onChange={(event) => setInitialCapital(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
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
                className="w-full rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-200 transition hover:border-amber-400/80 hover:bg-amber-400/20"
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
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Last Price</p>
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
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Market Cap</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {quote?.marketCap ? formatCurrency(quote.marketCap) : '--'}
              </p>
              <p className="text-xs text-zinc-400">Avg Volume: {quote?.averageDailyVolume10Day?.toLocaleString() ?? 'N/A'}</p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-zinc-400">Momentum</p>
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

          {indicatorSnapshots ? (
            <RegimePanel indicatorSnapshots={indicatorSnapshots} stockData={stockData} />
          ) : null}

          {technicalSummary ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h3 className="text-lg font-semibold text-white">Technical Snapshot</h3>
              <p className="mt-2 text-sm text-zinc-300">{technicalSummary}</p>
            </div>
          ) : null}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Price Action</h3>
                <p className="text-xs text-zinc-400">
                  Indicators are calculated client-side for responsive overlays. Server-side analytics keep Supabase-friendly parity with the legacy Streamlit build.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Data source: {dataSource === 'yahoo' ? 'Yahoo Finance' : dataSource === 'google' ? 'Google Finance fallback' : 'Synthetic sample (offline)'}.
                </p>
              </div>
              {insightsLoading ? (
                <span className="text-xs text-amber-300">Loading…</span>
              ) : null}
            </div>
            {chartData.length > 0 ? (
              <StockChart
                data={chartData}
                selectedIndicators={selectedIndicators}
                forecastModel={forecastModel}
                hasForecastCloud={Boolean(forecastCloud)}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-sm text-zinc-500">
                No price history available for the current configuration.
              </div>
            )}
          </div>

          {backtestSummary ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <h3 className="text-sm font-semibold text-zinc-200">Signal Conviction</h3>
              <p className="mt-1 text-xs text-zinc-500">
                {backtestSummary.indicator?.toUpperCase()} signals — strength from −3 (strong sell) to +3 (strong buy)
              </p>
              <div className="mt-4 grid grid-cols-4 gap-3">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Total</p>
                  <p className="mt-1 text-lg font-semibold text-zinc-100">{backtestSummary.totalSignals ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Buy</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-400">{backtestSummary.buySignals ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Sell</p>
                  <p className="mt-1 text-lg font-semibold text-red-400">{backtestSummary.sellSignals ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Snapshot</p>
                  <p className="mt-1 text-sm text-zinc-200">{indicatorSnapshotDisplay}</p>
                </div>
              </div>
              {signalSeries.length > 0 ? (
                <div className="mt-4 h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={signalSeries.map((s) => ({
                        date: s.date ? new Date(s.date).toLocaleDateString() : '',
                        strength: SIGNAL_STRENGTH[s.signal] ?? 0,
                      }))}
                      margin={{ top: 4, right: 0, left: -24, bottom: 0 }}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: '#71717a' }}
                        minTickGap={30}
                      />
                      <YAxis
                        domain={[-3, 3]}
                        ticks={[-3, -2, -1, 0, 1, 2, 3]}
                        tick={{ fontSize: 9, fill: '#71717a' }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '0.5rem', fontSize: 11 }}
                        formatter={(value) => [value > 0 ? `Buy +${value}` : `Sell ${value}`, 'Conviction']}
                      />
                      <Bar dataKey="strength" radius={[2, 2, 0, 0]}>
                        {signalSeries.map((s, index) => (
                          <Cell key={index} fill={signalColor(SIGNAL_STRENGTH[s.signal] ?? 0)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">No non-hold signals in this period.</p>
              )}
            </section>
          ) : null}

          {simulationSeries.length > 0 ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Portfolio Simulation</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    Simulated using {primaryIndicator.toUpperCase()} signals on ${initialCapital.toLocaleString()} starting capital.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Initial Capital</p>
                  <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(initialCapital)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Final Value</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {finalPortfolioValue != null ? formatCurrency(finalPortfolioValue) : '--'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Return</p>
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
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString()} />
                    <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} />
                    <Tooltip
                      formatter={(value) => formatCurrency(value)}
                      contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '0.75rem' }}
                      labelFormatter={(value) => `Date: ${new Date(value).toLocaleDateString()}`}
                    />
                    <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          ) : null}

          {predictionSeries.length > 0 ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h3 className="text-lg font-semibold text-white">Forecast Highlights</h3>
              <p className="mt-2 text-sm text-zinc-400">
                Forecasts extend 60 trading days ahead using server-backed heuristics translated from the Streamlit workflow.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-zinc-300 md:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Model</p>
                  <p className="mt-1 font-semibold text-white">{forecastModel.toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Base</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.base ? `$${priceTargets.base.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Optimistic</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.optimistic ? `$${priceTargets.optimistic.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Conservative</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.conservative ? `$${priceTargets.conservative.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h3 className="text-lg font-semibold text-white">Market Narrative</h3>
            {newsItems.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-400">
                News sentiment requires an Alpha Vantage key (optional). Configure `ALPHA_VANTAGE_KEY` for the backend or `VITE_ALPHA_VANTAGE_KEY` for the client proxy to activate feed ingestion.
              </p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm text-zinc-300">
                {newsItems.map((item) => (
                  <li key={item.url} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-amber-300">
                      {item.title}
                    </a>
                    <p className="mt-1 text-xs text-zinc-400">{item.summary}</p>
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
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Metadata Explorer</h3>
                  <p className="text-xs text-zinc-400">
                    Rule-based regions, faceted tags, IPO-year filtering, and search across symbols/names.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs uppercase tracking-wide text-zinc-400">
                    IPO year min ({ipoYearMin})
                    <input
                      type="range"
                      min="1975"
                      max={new Date().getFullYear()}
                      step="1"
                      value={ipoYearMin}
                      onChange={(event) => setIpoYearMin(Number(event.target.value))}
                      className="mt-1 w-48 accent-amber-400"
                    />
                  </label>
                  <label className="text-xs uppercase tracking-wide text-zinc-400">
                    Sector
                    <select
                      value={facetFilters.sector}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, sector: event.target.value }))}
                      className="mt-1 w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                    >
                      <option value="">All</option>
                      {(metadataFacets?.sector ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-zinc-400">
                    Region
                    <select
                      value={facetFilters.region}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, region: event.target.value }))}
                      className="mt-1 w-32 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                    >
                      <option value="">All</option>
                      {(metadataFacets?.region ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-zinc-400">
                    Risk Bucket
                    <select
                      value={facetFilters.riskBucket}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, riskBucket: event.target.value }))}
                      className="mt-1 w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                    >
                      <option value="">All</option>
                      {(metadataFacets?.risk_bucket ?? metadataFacets?.riskBucket ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs uppercase tracking-wide text-zinc-400">
                    Style Factor
                    <select
                      value={facetFilters.styleFactor}
                      onChange={(event) => setFacetFilters((prev) => ({ ...prev, styleFactor: event.target.value }))}
                      className="mt-1 w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
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
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Current Symbol</p>
                  {currentMetadata ? (
                    <div className="mt-2 space-y-1 text-sm text-zinc-200">
                      <p className="text-lg font-semibold text-white">{currentMetadata.symbol}</p>
                      <p className="text-zinc-400">{currentIndustryLabel} · {currentMetadata.region}</p>
                      <p className="text-zinc-300">
                        IPO Year: <span className="font-semibold text-amber-300">{currentIpoYear ?? '--'}</span>
                      </p>
                      {currentPrototypeScore != null ? (
                        <p className="text-zinc-300">
                          Prototype score: <span className="font-semibold text-amber-300">{Number(currentPrototypeScore).toFixed(2)}</span>
                        </p>
                      ) : null}
                      <p className="text-xs text-zinc-400">
                        {currentMetadata.evidence}
                      </p>
                      {currentStyleFactors.length ? (
                        <p className="text-xs text-zinc-500">Style: {currentStyleFactors.join(', ')}</p>
                      ) : null}
                    </div>
                  ) : metadataLoading ? (
                    <p className="mt-2 text-sm text-zinc-400">Loading metadata…</p>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-400">
                      No metadata available for {symbol}. Use the Add Single Ticker form below to seed it.
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Facet Summary</p>
                  <ul className="mt-2 space-y-1 text-sm text-zinc-300">
                    <li className="flex items-center gap-2">
                      <span>Symbol → {metadataSymbolFilter || 'Any'}</span>
                      {metadataSymbolFilter ? (
                        <button
                          type="button"
                          onClick={() => setMetadataSymbolFilter('')}
                          className="text-xs font-semibold text-amber-300 underline-offset-2 hover:underline"
                        >
                          Clear
                        </button>
                      ) : null}
                    </li>
                  <li>Sector → {facetFilters.sector || 'Any'}</li>
                  <li>Region → {facetFilters.region || 'Any'}</li>
                    <li>Risk → {facetFilters.riskBucket || 'Any'}</li>
                    <li>Style → {facetFilters.styleFactor || 'Any'}</li>
                    <li>IPO Year ≥ {ipoYearMin}</li>
                    <li>Matches → {filteredMetadata.length}</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Faceted Retrieval Examples</p>
                  <ul className="mt-2 space-y-2 text-sm text-zinc-300">
                    <li className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">US · High Vol · Momentum → AI-adjacent semis</li>
                    <li className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">EU · Growth → Lithography prototype</li>
                    <li className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2">Mega Cap · Low Vol → Core software</li>
                  </ul>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Add Single Ticker</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="Symbol (required)"
                      value={newTicker.symbol}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, symbol: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                    />
                    <input
                      type="text"
                      placeholder="Name"
                      value={newTicker.name}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, name: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                    />
                    <input
                      type="text"
                      placeholder="Sector"
                      value={newTicker.sector}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, sector: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                    />
                    <input
                      type="text"
                      placeholder="Region"
                      value={newTicker.region}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, region: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                    />
                    <input
                      type="number"
                      placeholder="IPO Year"
                      value={newTicker.ipoYear}
                      onChange={(e) => setNewTicker((prev) => ({ ...prev, ipoYear: e.target.value }))}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
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
                    className="mt-3 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
                  >
                    Add Ticker
                  </button>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Upload CSV (header: symbol,name,sector,region,ipo_year)</p>
                  <input
                    ref={csvFileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        const text = await file.text();
                        setCsvText(text);
                        setMetadataActionStatus(`Loaded ${file.name}. Review and click Upload CSV to save.`);
                      } catch (err) {
                        setMetadataActionStatus('Unable to read CSV file. Try again or paste the contents.');
                      } finally {
                        event.target.value = '';
                      }
                    }}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => csvFileInputRef.current?.click()}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-amber-400 hover:text-amber-200"
                    >
                      Choose CSV File
                    </button>
                    <span className="text-xs text-zinc-400">or paste CSV text below.</span>
                  </div>
                  <textarea
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    rows={6}
                    placeholder="symbol,name,sector,region,ipo_year&#10;AAPL,Apple Inc.,Technology,US,1980"
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      setMetadataActionStatus('');
                      if (!csvText.trim()) {
                        setMetadataActionStatus('Choose a CSV file or paste CSV text before uploading.');
                        return;
                      }
                      setMetadataUploading(true);
                      setMetadataActionStatus('Uploading CSV…');
                      try {
                        await uploadMetadataCsv(csvText);
                        setMetadataActionStatus('CSV uploaded and saved.');
                        setCsvText('');
                        const payload = await getMetadata();
                        setMetadataRows(payload?.rows ?? []);
                        setMetadataFacets(payload?.facets ?? null);
                      } catch (err) {
                        setMetadataActionStatus(err instanceof Error ? err.message : 'Unable to upload CSV.');
                      } finally {
                        setMetadataUploading(false);
                      }
                    }}
                    disabled={metadataUploading}
                    className="mt-3 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-200 transition hover:border-amber-400 hover:bg-amber-400/20"
                  >
                    {metadataUploading ? 'Uploading…' : 'Upload CSV'}
                  </button>
                </div>
              </div>

              {metadataActionStatus ? (
                <p className="mt-3 text-sm text-amber-200">{metadataActionStatus}</p>
              ) : null}

              <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-800 text-sm text-zinc-200">
                  <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-400">
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
                  <tbody className="divide-y divide-zinc-800">
                    {metadataLoading ? (
                      <tr>
                        <td colSpan="7" className="px-4 py-3 text-zinc-400">Loading metadata…</td>
                      </tr>
                    ) : filteredMetadata.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="px-4 py-3 text-zinc-500">No tickers match the current facet selection.</td>
                      </tr>
                    ) : (
                      visibleMetadata.map((row) => {
                        const isActive = row.symbol === symbol || row.symbol === metadataSymbolFilter;
                        return (
                          <tr
                            key={row.symbol}
                            onClick={() => {
                              setSymbol(row.symbol);
                              setMetadataSymbolFilter(row.symbol);
                            }}
                            className={`${isActive ? 'bg-amber-400/10' : ''} cursor-pointer transition hover:bg-amber-400/5`}
                          >
                          <td className="px-4 py-2 font-semibold text-white">{row.symbol}</td>
                          <td className="px-4 py-2 text-zinc-300">{row.industryGroup || row.industry_group || row.sector}</td>
                          <td className="px-4 py-2 text-zinc-300">{row.region}</td>
                          <td className="px-4 py-2 text-zinc-300">{row.ipo_year ?? row.ipoYear ?? '--'}</td>
                          <td className="px-4 py-2 text-amber-300">
                            {row.prototypeScore != null
                              ? row.prototypeScore.toFixed(2)
                              : row.prototype_score != null
                                ? Number(row.prototype_score).toFixed(2)
                                : '--'}
                          </td>
                          <td className="px-4 py-2">{row.riskBucket || row.risk_bucket}</td>
                          <td className="px-4 py-2 text-zinc-300">{(row.styleFactors || row.style_factors || []).join(', ')}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
                <span>
                  Showing {Math.min(visibleMetadata.length, filteredMetadata.length)} of {filteredMetadata.length} tickers
                  {totalPages > 1 ? ` · Page ${safePage}/${totalPages}` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMetadataPage((prev) => Math.max(1, prev - 1))}
                    disabled={safePage <= 1}
                    className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-200 transition hover:border-amber-400 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetadataPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safePage >= totalPages}
                    className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-200 transition hover:border-amber-400 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetadataPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safePage >= totalPages}
                    className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:border-amber-400 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
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

      <footer className="mx-auto mt-10 max-w-7xl px-6 text-xs text-zinc-500">
        <p>
          Node.js analytics keep the architecture aligned with Vercel deployments while Supabase powers auth, storage, and realtime watchlists.
        </p>
      </footer>
    </div>
  );
}
