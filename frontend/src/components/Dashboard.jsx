import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUserPreferences } from '../hooks/useUserPreferences';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import WatchlistTable from './WatchlistTable';
import StockChart from './StockChart';
import AdvancedBacktest from './AdvancedBacktest';
import AlertsPanel from './AlertsPanel';
import MiniAssistant from './MiniAssistant';
import RegimePanel from './RegimePanel';
import PortfolioPanel from './PortfolioPanel';
import BrokerPanel from './BrokerPanel';
import FundamentalsCard from './FundamentalsCard';
import { getAccountability, getInsights, getMetadata, getNews, upsertMetadataRow, uploadMetadataCsv } from '../services/api';
import AlgoExplainer from './AlgoExplainer';

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

const CHART_PERIODS = [
  { label: '1D',  range: '1d',   interval: '5m'  },
  { label: '5D',  range: '5d',   interval: '15m' },
  { label: '1M',  range: '1mo',  interval: '1d'  },
  { label: '3M',  range: '3mo',  interval: '1d'  },
  { label: '6M',  range: '6mo',  interval: '1d'  },
  { label: '1Y',  range: '1y',   interval: '1d'  },
  { label: '5Y',  range: '5y',   interval: '1wk' },
  { label: 'ALL', range: 'max',  interval: '1mo' },
];

const INDICATORS = [
  { label: 'Simple Moving Average', value: 'sma' },
  { label: 'Relative Strength Index', value: 'rsi' },
  { label: 'MACD', value: 'macd' },
  { label: 'Bollinger Bands', value: 'bollinger' },
  { label: 'Stochastic Oscillator', value: 'stochastic' },
  { label: 'VWAP', value: 'vwap' },
  { label: 'Ensemble (weighted vote)', value: 'ensemble' },
];

const DEFAULT_WEIGHTS = { sma: 20, rsi: 20, macd: 20, bollinger: 15, stochastic: 15, adx: 10 };
const WEIGHT_LABELS = { sma: 'SMA', rsi: 'RSI', macd: 'MACD', bollinger: 'Bollinger', stochastic: 'Stochastic', adx: 'ADX' };

const FORECAST_MODELS = [
  { label: 'Drift (mean return)', value: 'drift', description: 'Assumes returns continue at their historical average. Fast, interpretable.' },
  { label: 'Autoregressive (AR)', value: 'ar', description: 'Uses recent return patterns to project forward. Good for momentum-driven stocks.' },
  { label: 'Holt Exp. Smoothing', value: 'holt', description: 'Tracks level and trend, weighted toward recent data. Good for trending markets.' },
  { label: 'Monte Carlo (GBM)', value: 'montecarlo', description: 'Simulates 300 random price paths. Shows a range of possible outcomes, not a single line.' },
];

const TABS = [
  { id: 'overview', label: 'Market Overview' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'metadata', label: 'Metadata Explorer' },
  { id: 'advanced', label: 'Advanced Lab' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'trading', label: 'Trading' },
  { id: 'assistant', label: 'AI Assistant' },
];

function snapPrice(price) {
  if (price == null || !Number.isFinite(price)) return price;
  const abs = Math.abs(price);
  if (abs >= 1000) return Math.round(price / 5) * 5;
  if (abs >= 100)  return Math.round(price);
  if (abs >= 10)   return Math.round(price * 4) / 4;       // nearest 0.25
  if (abs >= 1)    return Math.round(price * 20) / 20;     // nearest 0.05
  return Math.round(price * 100) / 100;                    // nearest 0.01
}

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
  const [symbolInput, setSymbolInput] = useState('AAPL');
  const [range, setRange] = useState('1y');
  const [chartInterval, setChartInterval] = useState('1d');
  const [selectedIndicators, setSelectedIndicators] = useState(['sma', 'bollinger']);
  const [forecastModel, setForecastModel] = useState('drift');
  const [showForecast, setShowForecast] = useState(true);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingTool, setDrawingTool] = useState('trend-line'); // 'trend-line' | 'horizontal' | 'extended-line'
  const [drawnLines, setDrawnLines] = useState([]);
  const [pendingPoint, setPendingPoint] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);
  const [draggingHandle, setDraggingHandle] = useState(null); // { lineId: string, endpoint: 'start'|'end' } | null
  const [initialCapital, setInitialCapital] = useState(10000);
  const [draftWeights, setDraftWeights] = useState(DEFAULT_WEIGHTS);
  const [appliedWeights, setAppliedWeights] = useState(DEFAULT_WEIGHTS);

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
  const [metadataActionStatus, setMetadataActionStatus] = useState(null);
  const csvFileInputRef = useRef(null);

  const { preferences, loading: prefsLoading, save: savePreferences } = useUserPreferences(
    session?.access_token,
  );

  const prefsApplied = useRef(false);

  // Keep symbolInput in sync when symbol changes from external sources (watchlist clicks, prefs)
  useEffect(() => {
    setSymbolInput(symbol);
  }, [symbol]);

  useEffect(() => {
    if (prefsLoading || prefsApplied.current) return;
    prefsApplied.current = true;
    if (!preferences) return;
    if (preferences.last_symbol) setSymbol(preferences.last_symbol);
    if (preferences.last_range) {
      setRange(preferences.last_range);
      const matchedPeriod = CHART_PERIODS.find((p) => p.range === preferences.last_range);
      if (matchedPeriod) setChartInterval(matchedPeriod.interval);
    }
    if (Array.isArray(preferences.selected_indicators) && preferences.selected_indicators.length > 0) {
      setSelectedIndicators(preferences.selected_indicators);
    }
    if (preferences.forecast_model) setForecastModel(preferences.forecast_model);
    if (preferences.initial_capital) setInitialCapital(Number(preferences.initial_capital));
  }, [preferences, prefsLoading]);

  useEffect(() => {
    if (prefsLoading || !prefsApplied.current) return;
    savePreferences({
      lastSymbol: symbol,
      lastRange: range,
      selectedIndicators,
      forecastModel,
      initialCapital,
    });
  }, [symbol, range, selectedIndicators, forecastModel, initialCapital, savePreferences, prefsLoading]);

  const [backtestSummary, setBacktestSummary] = useState(null);
  const [simulationSeries, setSimulationSeries] = useState([]);
  const [simulationSummary, setSimulationSummary] = useState(null);
  const [predictionSeries, setPredictionSeries] = useState([]);
  const [forecastCloud, setForecastCloud] = useState(null);
  const [signalSeries, setSignalSeries] = useState([]);
  const [indicatorSnapshots, setIndicatorSnapshots] = useState(null);
  const [momentum, setMomentum] = useState(null);
  const [priceTargets, setPriceTargets] = useState(null);
  const [conviction, setConviction] = useState(null);
  const [directional, setDirectional] = useState(null);
  const [accountability, setAccountability] = useState(null);
  const [technicalSummary, setTechnicalSummary] = useState(null);
  const [dataSource, setDataSource] = useState('yahoo');
  const [activeTab, setActiveTab] = useState('overview');
  const [showDetailedAnalysis, setShowDetailedAnalysis] = useState(false);

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
      setConviction(null);
      setDirectional(null);
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
    setConviction(payload.conviction ?? null);
    setDirectional(payload.directional ?? null);
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
          interval: chartInterval,
          indicator: primaryIndicator,
          forecastModel,
          initialCapital,
          weights: JSON.stringify(
            Object.fromEntries(Object.entries(appliedWeights).map(([key, value]) => [key, value / 100])),
          ),
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
    [applyInsights, symbol, range, chartInterval, primaryIndicator, forecastModel, initialCapital, appliedWeights],
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
    const loadAccountability = async () => {
      try {
        const payload = await getAccountability(symbol);
        if (!cancelled) setAccountability(payload ?? null);
      } catch {
        if (!cancelled) setAccountability(null);
      }
    };
    loadAccountability();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

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
          // 80% band fields from statistical models (drift/ar/holt)
          forecastLower: point.lower ?? null,
          forecastUpper: point.upper ?? null,
          forecastBand: point.lower != null && point.upper != null ? [point.lower, point.upper] : null,
          isForecast: true,
        });
      });
    }

    return base;
  }, [stockData, predictionSeries, forecastCloud]);

  const scalesRef = useRef(null);

  const pixelToPrice = useCallback((chartY) => {
    const sc = scalesRef.current;
    if (!sc?.yScale?.invert || !sc?.offset) return null;
    const price = sc.yScale.invert(chartY - (sc.offset.top ?? 0));
    return Number.isFinite(price) ? price : null;
  }, []); // reads from ref — no reactive deps needed

  const handleChartClick = useCallback(
    (data) => {
      if (!drawingMode || !data?.activeLabel) return;
      const rawPrice = pixelToPrice(data.chartY);
      if (rawPrice == null) return;
      const price = snapPrice(rawPrice);

      if (drawingTool === 'horizontal') {
        // Single click — full-width horizontal line
        setDrawnLines((prev) => [
          ...prev,
          { id: Date.now().toString(), type: 'horizontal', x1: null, y1: price, x2: null, y2: price },
        ]);
        return;
      }

      // trend-line and extended-line: two-click flow
      const point = { x: data.activeLabel, y: price };
      if (!pendingPoint) {
        setPendingPoint(point);
      } else {
        setDrawnLines((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            type: drawingTool,
            x1: pendingPoint.x, y1: pendingPoint.y,
            x2: point.x, y2: point.y,
          },
        ]);
        setPendingPoint(null);
        setHoverPoint(null);
      }
    },
    [drawingMode, drawingTool, pendingPoint, pixelToPrice],
  );

  const handleChartMouseMove = useCallback(
    (data) => {
      if (draggingHandle) {
        // Drag mode — update the dragged endpoint
        const rawPrice = pixelToPrice(data.chartY);
        if (rawPrice == null || !data?.activeLabel) return;
        const newPrice = snapPrice(rawPrice);
        const newDate  = data.activeLabel;
        setDrawnLines((prev) => prev.map((l) => {
          if (l.id !== draggingHandle.lineId) return l;
          if (l.type === 'horizontal') return { ...l, y1: newPrice, y2: newPrice };
          if (draggingHandle.endpoint === 'start') return { ...l, x1: newDate, y1: newPrice };
          return { ...l, x2: newDate, y2: newPrice };
        }));
        return;
      }
      if (!drawingMode || drawingTool === 'horizontal') {
        if (hoverPoint) setHoverPoint(null);
        return;
      }
      if (!pendingPoint || !data?.activeLabel) {
        if (hoverPoint) setHoverPoint(null);
        return;
      }
      const rawPrice = pixelToPrice(data.chartY);
      if (rawPrice == null) return;
      setHoverPoint({ x: data.activeLabel, y: snapPrice(rawPrice) });
    },
    [draggingHandle, drawingMode, drawingTool, pendingPoint, hoverPoint, pixelToPrice],
  );

  const handleLineDelete = useCallback((id) => {
    setDrawnLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const handleChartMouseUp = useCallback(() => {
    if (draggingHandle) setDraggingHandle(null);
  }, [draggingHandle]);

  useEffect(() => {
    if (!draggingHandle) return;
    window.addEventListener('mouseup', handleChartMouseUp);
    return () => { window.removeEventListener('mouseup', handleChartMouseUp); };
  }, [draggingHandle, handleChartMouseUp]);

  const handleDragStart = useCallback((lineId, endpoint) => {
    setDraggingHandle({ lineId, endpoint });
    setPendingPoint(null); // cancel any in-progress drawing
  }, []);

  useEffect(() => {
    setDrawnLines([]);
    setPendingPoint(null);
    setHoverPoint(null);
    setDrawingMode(false);
    setDrawingTool('trend-line');
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

  const Tip = ({ text }) => (
    <span className="group relative ml-1 inline-flex cursor-help items-center">
      <span className="rounded-full border border-zinc-600 px-1 text-[10px] text-zinc-500 group-hover:border-zinc-400 group-hover:text-zinc-300">?</span>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-56 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );

  return (
    <div className="min-h-screen bg-zinc-950 pb-16">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Patterngrow</h1>
            <p className="text-xs text-zinc-500">
              Stock intelligence &amp; portfolio analytics
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
              <div
                aria-label={user?.email ?? 'User avatar'}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-sm font-semibold text-white"
              >
                {user?.email?.slice(0, 2)?.toUpperCase() ?? 'U'}
              </div>
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-white">
                {user?.user_metadata?.full_name ?? user?.email ?? 'Signed In'}
              </p>
              <p className="text-xs text-zinc-500">Signed in</p>
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
                    active ? 'bg-amber-400/25 text-amber-100 ring-1 ring-amber-400/40' : 'text-zinc-400 hover:text-zinc-200'
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
                <label className="text-xs font-medium text-zinc-400">Ticker</label>
                <input
                  value={symbolInput}
                  onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
                  onBlur={() => { if (symbolInput.trim()) setSymbol(symbolInput.trim()); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); if (symbolInput.trim()) setSymbol(symbolInput.trim()); }
                  }}
                  placeholder="e.g. AAPL"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                />
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
                <label className="text-xs font-medium text-zinc-400">Forecast Model</label>
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
                {(() => {
                  const selected = FORECAST_MODELS.find((m) => m.value === forecastModel);
                  return selected?.description ? (
                    <p className="mt-1 text-xs text-zinc-500">{selected.description}</p>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-400">Initial Capital ($)</label>
                <input
                  type="number"
                  min="1"
                  step="100"
                  value={initialCapital}
                  onChange={(event) => setInitialCapital(Math.max(1, Number(event.target.value)))}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/25"
                />
              </div>
              <button
                type="button"
                onClick={() => loadInsights()}
                disabled={insightsLoading}
                className="w-full rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {insightsLoading ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
          </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-inner">
              <h2 className="text-lg font-semibold text-white">Ensemble Weights</h2>
              <p className="mb-3 text-xs text-zinc-400">
                How much each indicator counts in the conviction score (and the ensemble strategy). Normalized automatically.
              </p>
              <div className="space-y-2">
                {Object.keys(DEFAULT_WEIGHTS).map((key) => (
                  <label key={key} className="block text-xs text-zinc-400">
                    {WEIGHT_LABELS[key]} ({draftWeights[key]})
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={draftWeights[key]}
                      onChange={(event) =>
                        setDraftWeights((prev) => ({ ...prev, [key]: Number(event.target.value) }))
                      }
                      className="mt-1 w-full accent-amber-400"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAppliedWeights(draftWeights)}
                  className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-300"
                >
                  Apply Weights
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftWeights(DEFAULT_WEIGHTS);
                    setAppliedWeights(DEFAULT_WEIGHTS);
                  }}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300 transition hover:border-amber-400 hover:text-amber-200"
                >
                  Reset
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

          <AlgoExplainer />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs font-medium text-zinc-500">Last Price</p>
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
              <p className="text-xs font-medium text-zinc-500">Market Cap</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {quote?.marketCap ? formatCurrency(quote.marketCap) : '--'}
              </p>
              <p className="text-xs text-zinc-400">Avg Volume: {quote?.averageDailyVolume10Day?.toLocaleString() ?? 'N/A'}</p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs font-medium text-zinc-500">30-Day Change</p>
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

          {conviction ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <p className="text-xs text-zinc-500">Ensemble Conviction<Tip text="A weighted vote across 6 indicators (SMA, RSI, MACD, Bollinger, Stochastic, ADX). Score ranges from −6 (strong sell) to +6 (strong buy)." /></p>
                <p className={`mt-1 text-2xl font-semibold ${conviction.score >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {conviction.label}
                </p>
                <p className="text-xs text-zinc-400">
                  Score {conviction.score >= 0 ? '+' : ''}{conviction.score} · weighted vote across 6 indicators
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <p className="text-xs text-zinc-500">5-Day Direction<Tip text="A logistic regression classifier trained on recent indicator snapshots. Predicts whether price is more likely up or down in the next 5 trading days." /></p>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {directional?.probUp != null ? `${(directional.probUp * 100).toFixed(0)}% up` : '--'}
                </p>
                <p className="text-xs text-zinc-400">
                  {directional
                    ? `Holdout accuracy ${(directional.accuracy * 100).toFixed(0)}% on ${directional.testSamples} samples — random baseline is 50%`
                    : 'Insufficient history for the classifier.'}
                </p>
              </div>
            </div>
          ) : null}

          <FundamentalsCard symbol={symbol} />
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <div className="mb-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Price Action</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {dataSource === 'yahoo' ? 'Yahoo Finance' : dataSource === 'google' ? 'Google Finance fallback' : 'Synthetic sample (offline)'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap gap-1">
                    {CHART_PERIODS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => { setRange(p.range); setChartInterval(p.interval); }}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                          range === p.range
                            ? 'bg-amber-400 text-zinc-900'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowForecast((v) => !v)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      showForecast
                        ? 'bg-amber-400 text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    Forecast
                  </button>
                  {insightsLoading ? (
                    <span className="text-xs text-amber-300">Loading…</span>
                  ) : null}
                </div>
              </div>

              {/* Drawing toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Tool type selector — only visible in draw mode */}
                {drawingMode ? (
                  <div className="flex items-center rounded-md border border-zinc-700 overflow-hidden">
                    {[
                      { key: 'trend-line',    label: 'Trend' },
                      { key: 'horizontal',    label: 'H-Line' },
                      { key: 'extended-line', label: 'Extended' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDrawingTool(key)}
                        className={`px-2.5 py-1 text-xs font-semibold transition ${
                          drawingTool === key
                            ? 'bg-amber-400 text-zinc-900'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Draw / Stop button */}
                <button
                  type="button"
                  onClick={() => {
                    setDrawingMode((v) => !v);
                    setPendingPoint(null);
                    setHoverPoint(null);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    drawingMode
                      ? 'bg-amber-400 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {drawingMode ? '✓ Done' : '✏ Draw'}
                </button>

                {drawnLines.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => { setDrawnLines([]); setPendingPoint(null); setHoverPoint(null); }}
                    className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
                  >
                    Clear ({drawnLines.length})
                  </button>
                ) : null}

                {(drawingMode || drawnLines.length > 0) && !showForecast ? (
                  <button
                    type="button"
                    onClick={() => setShowForecast(true)}
                    className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:bg-amber-400 hover:text-zinc-900 transition"
                  >
                    Overlay Prediction
                  </button>
                ) : null}

                {pendingPoint ? (
                  <span className="text-xs text-zinc-500">Click to set endpoint</span>
                ) : drawingMode && drawingTool === 'horizontal' ? (
                  <span className="text-xs text-zinc-500">Click anywhere to place a horizontal line</span>
                ) : drawingMode ? (
                  <span className="text-xs text-zinc-500">Click to start drawing</span>
                ) : null}
              </div>
            </div>
            {chartData.length > 0 ? (
              <div className={insightsLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
                <StockChart
                  data={chartData}
                  interval={chartInterval}
                  selectedIndicators={selectedIndicators}
                  forecastModel={forecastModel}
                  hasForecastCloud={Boolean(forecastCloud)}
                  showForecast={showForecast}
                  drawingMode={drawingMode}
                  drawnLines={drawnLines}
                  pendingPoint={pendingPoint}
                  hoverPoint={hoverPoint}
                  onChartClick={handleChartClick}
                  onChartMouseMove={handleChartMouseMove}
                  onLineDelete={handleLineDelete}
                  scalesRef={scalesRef}
                  onDragStart={handleDragStart}
                  isDragging={draggingHandle != null}
                />
              </div>
            ) : insightsLoading ? (
              <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40">
                <p className="text-sm text-zinc-500">Loading price data…</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-sm text-zinc-500">
                {insightsError ? 'Could not load price data — check the ticker symbol or try again.' : 'No price history available for the current configuration.'}
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
                  <p className="text-xs font-medium text-zinc-500">Initial Capital</p>
                  <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(initialCapital)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Final Value</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {finalPortfolioValue != null ? formatCurrency(finalPortfolioValue) : '--'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Return</p>
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
                Forecasts extend 60 days ahead. Bands are an 80% confidence interval derived from historical volatility — wider bands mean less certainty, not a promise of range.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-zinc-300 md:grid-cols-4">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Model</p>
                  <p className="mt-1 font-semibold text-white">{forecastModel.toUpperCase()}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Base</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.base ? `$${priceTargets.base.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Upper band (80%)</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.optimistic ? `$${priceTargets.optimistic.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Lower band (80%)</p>
                  <p className="mt-1 text-white">
                    {priceTargets?.conservative ? `$${priceTargets.conservative.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => setShowDetailedAnalysis((prev) => !prev)}
              className="flex items-center gap-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              <span className="inline-block w-3">{showDetailedAnalysis ? '▲' : '▼'}</span>
              {showDetailedAnalysis ? 'Hide' : 'Show'} forecast accountability &amp; news
            </button>
          </div>
          {showDetailedAnalysis ? (
          <>
          {accountability?.rows?.length ? (
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <h3 className="text-lg font-semibold text-white">Forecast Accountability</h3>
              <p className="mt-1 text-xs text-zinc-400">
                What the models said on past days vs. what actually happened.
                {accountability.summary?.bandHitRate != null
                  ? ` Band hit rate ${(accountability.summary.bandHitRate * 100).toFixed(0)}% · direction ${accountability.summary.directionHitRate != null ? (accountability.summary.directionHitRate * 100).toFixed(0) + '%' : '—'} over ${accountability.summary.graded} graded forecasts. (50% = random baseline)`
                  : ''}
              </p>
              <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-800 text-sm text-zinc-200">
                  <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-400">
                    <tr>
                      <th className="px-4 py-2 text-left">Forecast date</th>
                      <th className="px-4 py-2 text-left">Model</th>
                      <th className="px-4 py-2 text-right">Predicted</th>
                      <th className="px-4 py-2 text-right">Band</th>
                      <th className="px-4 py-2 text-right">Actual</th>
                      <th className="px-4 py-2 text-center">In band<Tip text="Whether the actual price fell within the model's 80% confidence interval on the target date." /></th>
                      <th className="px-4 py-2 text-center">Direction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {accountability.rows.slice(0, 10).map((row) => (
                      <tr key={`${row.snapshotDate}-${row.model}`}>
                        <td className="px-4 py-2 text-zinc-300">{row.snapshotDate}</td>
                        <td className="px-4 py-2 text-zinc-300">{row.model}</td>
                        <td className="px-4 py-2 text-right">{row.base != null ? `$${row.base.toFixed(2)}` : '—'}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">
                          {row.lower != null ? `${row.lower.toFixed(2)}–${row.upper.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-white">{row.actual != null ? `$${row.actual.toFixed(2)}` : '—'}</td>
                        <td className={`px-4 py-2 text-center ${row.inBand ? 'text-emerald-300' : 'text-red-300'}`}>
                          {row.inBand == null ? '—' : row.inBand ? 'Yes' : 'No'}
                        </td>
                        <td className={`px-4 py-2 text-center ${row.directionHit ? 'text-emerald-300' : 'text-red-300'}`}>
                          {row.directionHit == null ? '—' : row.directionHit ? 'Hit' : 'Miss'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h3 className="text-lg font-semibold text-white">Market Narrative</h3>
            {newsItems.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                No recent news available for {symbol}.
              </p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm text-zinc-300">
                {newsItems.map((item) => (
                  <li key={item.url} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-semibold text-zinc-100 transition-colors hover:text-amber-300">
                      {item.title}
                    </a>
                    <p className="mt-1 text-xs text-zinc-400">{item.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </>
          ) : null}
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
                        IPO Year: <span className="font-semibold text-zinc-100">{currentIpoYear ?? '--'}</span>
                      </p>
                      {currentPrototypeScore != null ? (
                        <p className="text-zinc-300">
                          Prototype score: <span className="font-semibold text-zinc-100">{Number(currentPrototypeScore).toFixed(2)}</span>
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
                      setMetadataActionStatus(null);
                      if (!newTicker.symbol.trim()) {
                        setMetadataActionStatus({ type: 'error', text: 'Symbol is required to add a ticker.' });
                        return;
                      }
                      try {
                        await upsertMetadataRow({
                          symbol: newTicker.symbol,
                          name: newTicker.name || undefined,
                          sector: newTicker.sector || undefined,
                          region: newTicker.region || undefined,
                          ipo_year: newTicker.ipoYear ? Number(newTicker.ipoYear) : undefined,
                        }, session?.access_token);
                        setMetadataActionStatus({ type: 'success', text: `Saved ${newTicker.symbol.toUpperCase()}.` });
                        setNewTicker({ symbol: '', name: '', sector: '', region: '', ipoYear: '' });
                        const payload = await getMetadata();
                        setMetadataRows(payload?.rows ?? []);
                        setMetadataFacets(payload?.facets ?? null);
                      } catch (err) {
                        setMetadataActionStatus({ type: 'error', text: err instanceof Error ? err.message : 'Unable to add ticker.' });
                      }
                    }}
                    className="mt-3 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-amber-300"
                  >
                    Add Ticker
                  </button>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <p className="text-xs font-medium text-zinc-400">Upload CSV <span className="font-normal text-zinc-500">(columns: symbol, name, sector, region, ipo_year)</span></p>
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
                        setMetadataActionStatus({ type: 'success', text: `Loaded ${file.name}. Review and click Upload CSV to save.` });
                      } catch {
                        setMetadataActionStatus({ type: 'error', text: 'Unable to read CSV file. Try again or paste the contents.' });
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
                      setMetadataActionStatus(null);
                      if (!csvText.trim()) {
                        setMetadataActionStatus({ type: 'error', text: 'Choose a CSV file or paste CSV text before uploading.' });
                        return;
                      }
                      setMetadataUploading(true);
                      setMetadataActionStatus({ type: 'info', text: 'Uploading…' });
                      try {
                        await uploadMetadataCsv(csvText, session?.access_token);
                        setMetadataActionStatus({ type: 'success', text: 'CSV uploaded and saved.' });
                        setCsvText('');
                        const payload = await getMetadata();
                        setMetadataRows(payload?.rows ?? []);
                        setMetadataFacets(payload?.facets ?? null);
                      } catch (err) {
                        setMetadataActionStatus({ type: 'error', text: err instanceof Error ? err.message : 'Unable to upload CSV.' });
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
                <p className={`mt-3 text-sm ${metadataActionStatus.type === 'success' ? 'text-emerald-300' : metadataActionStatus.type === 'error' ? 'text-red-300' : 'text-zinc-400'}`}>
                  {metadataActionStatus.text}
                </p>
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
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSymbol(row.symbol);
                              setMetadataSymbolFilter(row.symbol);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSymbol(row.symbol);
                                setMetadataSymbolFilter(row.symbol);
                              }
                            }}
                            className={`${isActive ? 'bg-amber-400/10' : ''} cursor-pointer transition hover:bg-amber-400/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60`}
                          >
                          <td className="px-4 py-2 font-semibold text-white">{row.symbol}</td>
                          <td className="px-4 py-2 text-zinc-300">{row.industryGroup || row.industry_group || row.sector}</td>
                          <td className="px-4 py-2 text-zinc-300">{row.region}</td>
                          <td className="px-4 py-2 text-zinc-300">{row.ipo_year ?? row.ipoYear ?? '--'}</td>
                          <td className="px-4 py-2 text-zinc-300">
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
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'watchlist' ? (
          <div className="max-w-md">
            <WatchlistTable
              user={session?.user ?? user}
              accessToken={session?.access_token}
              activeSymbol={symbol}
              onSelectSymbol={(ticker) => { setSymbol(ticker); setActiveTab('overview'); }}
            />
          </div>
        ) : null}

        {activeTab === 'advanced' ? <AdvancedBacktest /> : null}

        {activeTab === 'alerts' ? <AlertsPanel accessToken={session?.access_token} defaultSymbol={symbol} /> : null}

        {activeTab === 'portfolio' ? <PortfolioPanel accessToken={session?.access_token} /> : null}
        {activeTab === 'trading' ? <BrokerPanel accessToken={session?.access_token} defaultSymbol={symbol} /> : null}

        {activeTab === 'assistant' ? <MiniAssistant accessToken={session?.access_token} symbol={symbol} /> : null}
      </main>

      <footer className="mx-auto mt-10 max-w-7xl px-6 text-xs text-zinc-500">
        <p>Prices delayed 15 min. Not financial advice.</p>
      </footer>
    </div>
  );
}
