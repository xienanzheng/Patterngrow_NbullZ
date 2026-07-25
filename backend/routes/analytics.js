import express from 'express';
import { fetchSnapshots, gradeSnapshots, logForecastSnapshot } from '../utils/accountability.js';
import { buildAssistantContext } from '../utils/assistantContext.js';
import { requireAuth } from '../utils/authMiddleware.js';
import { directionalForecast } from '../utils/classifier.js';
import { computeSignals } from '../utils/computeSignals.js';
import { evaluateForecastModel, evaluateNaiveBaseline, evaluateStrategy } from '../utils/evaluation.js';
import { FORECAST_MODEL_IDS } from '../utils/predictions.js';
import { fetchFundamentals, fetchNews, fetchQuote, fetchYahooHistory } from '../utils/marketData.js';
import { getTickerMetadata, listFacetOptions, listMetadata, upsertMetadataRows } from '../utils/metadata.js';
import { chatLimiter, evaluateLimiter, publicLimiter } from '../utils/rateLimits.js';

const router = express.Router();

router.use(publicLimiter);

// Optional ?weights={"sma":0.3,...} — invalid JSON or shapes fall back to defaults downstream.
function parseWeightsParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'analytics' });
});

router.get('/metadata', async (req, res) => {
  try {
    const {
      symbol,
      sector,
      industryGroup,
      region,
      marketCapBucket,
      riskBucket,
      dividendProfile,
      styleFactor,
      minIpoYear,
      page = '1',
      pageSize = '100',
    } = req.query;

    const filters = {
      symbol,
      sector,
      industry_group: industryGroup,
      region,
      market_cap_bucket: marketCapBucket,
      risk_bucket: riskBucket,
      dividend_profile: dividendProfile,
      style_factor: styleFactor,
    };

    const pageNum = Math.max(1, Number(page) || 1);
    const sizeNum = Math.min(200, Math.max(1, Number(pageSize) || 100));
    const offset = (pageNum - 1) * sizeNum;

    if (minIpoYear != null) {
      const parsed = Number(minIpoYear);
      if (Number.isFinite(parsed)) {
        filters.min_ipo_year = parsed;
      }
    }

    const rows = await listMetadata(filters, { limit: sizeNum, offset });
    const facets = await listFacetOptions();

    res.json({ rows, facets, count: rows.length, page: pageNum, pageSize: sizeNum });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/metadata/manual', requireAuth, async (req, res) => {
  try {
    const payload = req.body;
    const rows = Array.isArray(payload?.rows) ? payload.rows : payload ? [payload] : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'Provide a row or rows array with at least symbol.' });
    }
    const inserted = await upsertMetadataRows(rows);
    res.status(201).json({ insertedCount: inserted.length, rows: inserted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/metadata/csv', requireAuth, async (req, res) => {
  try {
    const { csv } = req.body ?? {};
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'Provide csv text in request body.' });
    }
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must include header and at least one row.' });
    }
    const headers = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const cols = line.split(',');
      const obj = {};
      headers.forEach((key, idx) => {
        obj[key] = cols[idx]?.trim();
      });
      return obj;
    });
    const inserted = await upsertMetadataRows(rows);
    res.status(201).json({ insertedCount: inserted.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/quote', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Query parameter "symbol" is required.' });
    }
    const quote = await fetchQuote(symbol);
    res.json({ symbol, quote });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fundamentals', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol is required.' });
    const fundamentals = await fetchFundamentals(symbol.trim().toUpperCase());
    res.json({ symbol: symbol.trim().toUpperCase(), fundamentals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const { symbol, range = '1y', interval = '1d' } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Query parameter "symbol" is required.' });
    }
    const history = await fetchYahooHistory(symbol, range, interval);
    res.json({ symbol, range, interval, history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/news', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Query parameter "symbol" is required.' });
    }
    const news = await fetchNews(symbol);
    res.json({ symbol, news });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/insights', async (req, res) => {
  try {
    const {
      symbol,
      range = '1y',
      interval = '1d',
      indicator = 'sma',
      forecastModel = 'simple',
      forecastHorizon,
      initialCapital,
    } = req.query;

    if (!symbol) {
      return res.status(400).json({ error: 'Query parameter "symbol" is required.' });
    }

    const payload = await computeSignals(symbol, {
      range,
      interval,
      indicator,
      forecastModel,
      forecastHorizon: forecastHorizon ? Number(forecastHorizon) : undefined,
      initialCapital: initialCapital ? Number(initialCapital) : undefined,
      weights: parseWeightsParam(req.query.weights),
    });

    const metadata = await getTickerMetadata(symbol);

    // Accountability: record today's forecast so it can be graded later.
    // Only real market data is logged, and only fire-and-forget.
    if (payload.dataSource === 'yahoo' && payload.forecast?.length && payload.latestClose != null) {
      const lastPoint = payload.forecast.at(-1);
      // Awaited: on Vercel, un-awaited I/O can be frozen with the instance
      // before it completes, silently losing the snapshot.
      await logForecastSnapshot({
        symbol: payload.symbol,
        lastClose: payload.latestClose,
        forecastModel: payload.forecastModel,
        horizon: payload.forecast.length,
        base: lastPoint.value,
        lower: lastPoint.lower ?? null,
        upper: lastPoint.upper ?? null,
        convictionScore: payload.conviction?.score ?? null,
        convictionLabel: payload.conviction?.label ?? null,
        probUp: payload.directional?.probUp ?? null,
      });
    }

    res.json({ ...payload, metadata });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/accountability', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Query parameter "symbol" is required.' });
    }
    const normalized = String(symbol).trim().toUpperCase();
    let snapshots = [];
    try {
      snapshots = await fetchSnapshots(normalized);
    } catch (err) {
      console.warn('forecast_log unavailable:', err.message);
      return res.json({ symbol: normalized, rows: [], summary: { graded: 0, bandHitRate: null, directionHitRate: null }, note: 'forecast_log table not available yet.' });
    }
    if (!snapshots.length) {
      return res.json({ symbol: normalized, rows: [], summary: { graded: 0, bandHitRate: null, directionHitRate: null } });
    }
    const history = await fetchYahooHistory(normalized, '1y', '1d');
    const closesByDate = {};
    history.forEach((row) => {
      if (row.date && Number.isFinite(Number(row.close))) {
        closesByDate[row.date.slice(0, 10)] = Number(row.close);
      }
    });
    const graded = gradeSnapshots(snapshots, closesByDate);
    res.json({ symbol: normalized, ...graded });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/evaluate', evaluateLimiter, async (req, res) => {
  try {
    const { symbol, range = '2y', interval = '1d', indicator = 'sma' } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Query parameter "symbol" is required.' });
    }
    const horizon = Math.min(30, Math.max(3, Number(req.query.horizon) || 10));
    const folds = Math.min(8, Math.max(2, Number(req.query.folds) || 4));
    const history = await fetchYahooHistory(symbol, range, interval);

    const forecasts = FORECAST_MODEL_IDS.map((model) =>
      evaluateForecastModel(history, model, { folds, horizon }));
    const baseline = evaluateNaiveBaseline(history, { folds, horizon });
    const strategy = evaluateStrategy(history, indicator, { weights: parseWeightsParam(req.query.weights) });
    let directional = null;
    try {
      directional = directionalForecast(history, { horizon: 5 });
    } catch {
      directional = null;
    }

    res.json({ symbol, range, horizon, folds, forecasts, baseline, strategy, directional });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const MINI_NZ_DIRECTIVE = [
  'You are the Mini NZ Assistant briefing a hedge-fund PM. Follow these rules strictly:',
  'Output Format (keep under 200 words total):',
  'Position: Select exactly one of {Strong Buy, Can Buy, Cautious Purchase, Neutral, Small Bear, Big Bear, Brown Bear (don’t touch)}.',
  'Technical View: Mention RSI, MACD, EMA crossovers, volume divergence, ADX, and support/resistance with signal direction.',
  'Fundamental View: Summarise valuation and growth (P/E, PEG, EPS growth, revenue trend, cash flow, debt) and say if they support the position.',
  'Sentiment / News: Capture market, analyst and social sentiment with positive/negative skew plus catalysts or risks.',
  'Macro & Sector Context: Tie to inflation, rates outlook, or geopolitical drivers influencing the ticker.',
  'Summary Verdict: ≤3 sentences, assertive, integrating all signals.',
  'Tone: decisive, professional, evidence-driven; never evasive.',
].join('\n');

router.post('/chat', requireAuth, chatLimiter, async (req, res) => {
  try {
    const { prompt, provider = 'openai', model, apiKey, temperature, symbol } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    const normalizedProvider = String(provider).toLowerCase();
    const temp = typeof temperature === 'number' && temperature >= 0 && temperature <= 1 ? temperature : 0.3;
    const userPrompt = prompt.trim();

    // Ground the assistant in the app's own analytics for the active symbol.
    let systemDirective = MINI_NZ_DIRECTIVE;
    let grounded = false;
    if (symbol && typeof symbol === 'string' && /^[A-Z0-9.^-]{1,12}$/i.test(symbol.trim())) {
      const context = await buildAssistantContext(symbol.trim().toUpperCase());
      if (context) {
        systemDirective = `${MINI_NZ_DIRECTIVE}\n\n${context}`;
        grounded = true;
      }
    }

    if (normalizedProvider === 'openai') {
      const key = apiKey || process.env.OPENAI_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'OpenAI API key missing. Provide apiKey or set OPENAI_API_KEY.' });
      }
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          temperature: temp,
          input: [
            { role: 'system', content: systemDirective },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `OpenAI error: ${err}` });
      }
      const data = await response.json();
      const text = data?.output?.[0]?.content?.[0]?.text || data?.output_text || data?.choices?.[0]?.message?.content || 'No response.';
      return res.json({ provider: 'openai', model: model || 'gpt-4o-mini', message: text, grounded });
    }

    if (normalizedProvider === 'google' || normalizedProvider === 'gemini') {
      const key = apiKey || process.env.GOOGLE_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'Google Generative AI key missing. Provide apiKey or set GOOGLE_API_KEY.' });
      }
      const selectedModel = model || 'gemini-1.5-flash-latest';
      if (!/^[\w.-]+$/.test(selectedModel)) {
        return res.status(400).json({ error: 'Invalid model name.' });
      }
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${key}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generationConfig: {
            temperature: temp,
          },
          contents: [
            {
              parts: [{ text: `${systemDirective}\n\nUser prompt:\n${userPrompt}` }],
            },
          ],
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: `Gemini error: ${err}` });
      }
      const data = await response.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n') ||
        data?.candidates?.[0]?.output_text ||
        'No response.';
      return res.json({ provider: 'google', model: selectedModel, message: text, grounded });
    }

    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
