import express from 'express';
import { computeSignals } from '../utils/computeSignals.js';
import { fetchNews, fetchQuote, fetchYahooHistory } from '../utils/marketData.js';
import { getTickerMetadata, listFacetOptions, listMetadata } from '../utils/metadata.js';

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'analytics' });
});

router.get('/metadata', (req, res) => {
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
      minPrototypeScore,
    } = req.query;

    const filters = {
      symbol,
      sector,
      industryGroup,
      region,
      marketCapBucket,
      riskBucket,
      dividendProfile,
      styleFactor,
    };

    if (minPrototypeScore != null) {
      const parsed = Number(minPrototypeScore);
      if (Number.isFinite(parsed)) {
        filters.minPrototypeScore = parsed;
      }
    }

    const rows = listMetadata(filters);
    const facets = listFacetOptions();

    res.json({ rows, facets, count: rows.length });
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
    });

    const metadata = getTickerMetadata(symbol);

    res.json({ ...payload, metadata });
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

router.post('/chat', async (req, res) => {
  try {
    const { prompt, provider = 'openai', model, apiKey, temperature } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required.' });
    }

    const normalizedProvider = String(provider).toLowerCase();
    const temp = typeof temperature === 'number' && temperature >= 0 && temperature <= 1 ? temperature : 0.3;
    const userPrompt = prompt.trim();

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
            { role: 'system', content: MINI_NZ_DIRECTIVE },
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
      return res.json({ provider: 'openai', model: model || 'gpt-4o-mini', message: text });
    }

    if (normalizedProvider === 'google' || normalizedProvider === 'gemini') {
      const key = apiKey || process.env.GOOGLE_API_KEY;
      if (!key) {
        return res.status(400).json({ error: 'Google Generative AI key missing. Provide apiKey or set GOOGLE_API_KEY.' });
      }
      const selectedModel = model || 'gemini-1.5-flash-latest';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`;
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
              parts: [{ text: `${MINI_NZ_DIRECTIVE}\n\nUser prompt:\n${userPrompt}` }],
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
      return res.json({ provider: 'google', model: selectedModel, message: text });
    }

    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
