import express from 'express';
import { backtestStrategy, runTradingSimulationDetailed } from '../utils/backtesting.js';
import { fetchYahooHistory } from '../utils/marketData.js';
import { requireAuth } from '../utils/authMiddleware.js';

const router = express.Router();
router.use(requireAuth);

function maxDrawdown(series) {
  let peak = -Infinity;
  let maxDd = 0;
  for (const row of series) {
    if (row.value > peak) peak = row.value;
    if (!Number.isFinite(peak) || peak === 0) continue;
    const dd = (row.value - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function normalizeTrades(trades) {
  return trades.map((t) => ({
    type: t.type.toUpperCase(),
    date: t.date,
    price: t.price,
    changePct: t.pnlPct ?? null,
  }));
}

function buildResult(sim, capital) {
  const equity = sim.portfolio;
  const finalValue = equity.at(-1)?.value ?? capital;
  return {
    equity,
    trades: normalizeTrades(sim.trades),
    metrics: {
      finalValue,
      totalReturn: ((finalValue / capital) - 1) * 100,
      maxDrawdown: maxDrawdown(equity) * 100,
    },
  };
}

router.post('/run', async (req, res) => {
  try {
    const {
      symbol,
      benchmark = 'SPY',
      period = '1y',
      strategy = 'sma',
      initialCapital = 10000,
      stopLossPct = 0,
      takeProfitPct = 0,
    } = req.body ?? {};

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'symbol is required' });
    }
    const capital = Number(initialCapital);
    if (!Number.isFinite(capital) || capital <= 0) {
      return res.status(400).json({ error: 'initialCapital must be a positive number' });
    }

    const simOpts = {
      stopLossPct: Number(stopLossPct) > 0 ? Number(stopLossPct) / 100 : null,
      takeProfitPct: Number(takeProfitPct) > 0 ? Number(takeProfitPct) / 100 : null,
    };

    const [targetHistory, benchHistory] = await Promise.all([
      fetchYahooHistory(symbol.toUpperCase(), period, '1d'),
      fetchYahooHistory(benchmark.toUpperCase(), period, '1d'),
    ]);

    if (!targetHistory.length) {
      return res.status(422).json({ error: `No price data found for ${symbol}` });
    }

    const { signals: targetSignals } = backtestStrategy(targetHistory, strategy);
    const { signals: benchSignals } = backtestStrategy(benchHistory, 'sma');

    const targetSim = runTradingSimulationDetailed(targetHistory, targetSignals, capital, simOpts);
    const benchSim = runTradingSimulationDetailed(benchHistory, benchSignals, capital, {});

    res.json({
      target: buildResult(targetSim, capital),
      benchmark: buildResult(benchSim, capital),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
