import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createResearchTools, MAX_HISTORY_ROWS, toToolResult } from '../mcp/researchTools.js';
import { createResearchMcpServer } from '../mcp/server.js';
import { getResearchSnapshot } from '../utils/researchService.js';
import { buildMarketResearch } from '../utils/marketResearch.js';

const bar = { date: '2026-10-20T00:00:00Z', open: 10, high: 12, low: 9, close: 11, volume: 500, source: 'yahoo' };
const fixedNow = () => new Date('2026-10-22T00:00:00Z');
const comparisonSnapshot = {
  fetchedAt: { symbol: '2026-10-22T00:00:00Z', benchmark: '2026-10-22T00:00:00Z' },
  comparison: {
    metrics: { correlation: 0.5, beta: 0.8 }, sample: { commonSessions: 1 },
    metadata: { interval: '1d' }, quality: { status: 'partial', warnings: [] },
    series: [{ date: '2026-10-20', symbolClose: 11, benchmarkClose: 20, symbolIndex: 100, benchmarkIndex: 100, relativePerformancePp: 0, rollingCorrelation20: null }],
  },
};
const overviewSnapshot = {
  interval: '1d', range: '3mo', generatedAt: '2026-10-22T00:00:00Z', status: 'partial',
  rows: ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'USO'].map((symbol) => ({
    symbol, name: symbol, latestClose: 11, currency: 'USD', return1: null, source: 'yahoo', status: 'partial',
    warnings: ['Incomplete history'], sparkline: [{ date: bar.date, close: null }, { date: bar.date, close: 11 }],
  })),
  coverage: { requested: 6, available: 6, sameSession: null }, warnings: [], cache: { hit: false, ttlSeconds: 60 },
};
const dependencies = (overrides = {}) => ({
  fetchHistory: vi.fn().mockResolvedValue([bar]),
  buildResearch: vi.fn().mockReturnValue({ volume: { latest: 500 }, quality: { status: 'limited' } }),
  providerStatus: vi.fn().mockReturnValue({ mode: 'historical-research', providers: [{ id: 'yahoo', configured: true }] }),
  getComparisonSnapshot: vi.fn().mockResolvedValue(comparisonSnapshot),
  getMarketOverview: vi.fn().mockResolvedValue(overviewSnapshot),
  now: fixedNow,
  ...overrides,
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('bounded read-only MCP handlers', () => {
  it('allows one normalized ticker, fixed daily ranges and bounded output', async () => {
    const deps = dependencies({ fetchHistory: vi.fn().mockResolvedValue(Array(700).fill({ ...bar, apiKey: 'private' })) });
    const tools = createResearchTools(deps);
    const result = await tools.getMarketHistory({ symbol: ' aapl ', range: '2y', limit: 10 });
    expect(deps.fetchHistory).toHaveBeenCalledWith('AAPL', '2y', '1d');
    expect(result).toMatchObject({ symbol: 'AAPL', returnedRows: 10, truncated: true });
    expect(result.history).toHaveLength(10);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });

  it.each([
    { symbol: 'https://example.com' },
    { symbol: '../secrets' },
    { symbol: 'AAPL', range: 'max' },
    { symbol: 'AAPL', interval: '1m' },
    { symbol: 'AAPL', limit: MAX_HISTORY_ROWS + 1 },
    { symbol: 'AAPL', limit: 1.5 },
  ])('rejects invalid input without a network request: %j', async (input) => {
    const deps = dependencies();
    await expect(createResearchTools(deps).getMarketHistory(input)).rejects.toThrow();
    expect(deps.fetchHistory).not.toHaveBeenCalled();
  });

  it('preserves missing values and does not return synthetic observations', async () => {
    const missing = createResearchTools(dependencies({ fetchHistory: vi.fn().mockResolvedValue([{ ...bar, close: null, volume: '' }]) }));
    expect((await missing.getMarketHistory({ symbol: 'AAPL' })).history[0]).toMatchObject({ close: null, volume: null });
    const synthetic = createResearchTools(dependencies({ fetchHistory: vi.fn().mockResolvedValue([{ ...bar, source: 'synthetic' }]) }));
    await expect(synthetic.getMarketHistory({ symbol: 'AAPL' })).rejects.toThrow('Synthetic');
  });

  it('preserves safe provenance without copying unbounded provider strings', async () => {
    const deps = dependencies({ fetchHistory: vi.fn().mockResolvedValue([
      { ...bar, currency: 'GBp', exchangeTimezone: 'Europe/London', datePrecision: 'date', historyMayBeTruncated: true, complete: false },
      { ...bar, currency: 'private-secret', exchangeTimezone: 'https://example.com?key=private-secret', datePrecision: 'private-secret' },
    ]) });
    const result = await createResearchTools(deps).getMarketHistory({ symbol: 'ABC' });
    expect(result.history[0]).toMatchObject({ currency: 'GBp', exchangeTimezone: 'Europe/London', datePrecision: 'date', historyMayBeTruncated: true, complete: false });
    expect(result.history[1]).toMatchObject({ currency: null, exchangeTimezone: null, datePrecision: null });
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });

  it('uses the same bounded historical observations for research', async () => {
    const deps = dependencies({ fetchHistory: vi.fn().mockResolvedValue(Array(700).fill(bar)) });
    const result = await createResearchTools(deps).getMarketResearch({ symbol: 'AAPL' });
    expect(deps.buildResearch.mock.calls[0][0]).toHaveLength(MAX_HISTORY_ROWS);
    expect(deps.buildResearch.mock.calls[0][1]).toEqual({ interval: '1d', now: fixedNow(), currency: null });
    expect(result.truncated).toBe(true);
    expect(result.research.volume.latest).toBe(500);
  });

  it('reuses service snapshots while preserving quality findings, versions and cache metadata', async () => {
    const research = { volume: { latest: 500 }, quality: { duplicateBars: 2 }, metadata: { currency: 'USD', dataVersion: '2' }, series: [bar] };
    const deps = dependencies({ getResearchSnapshot: vi.fn().mockResolvedValue({
      fetchedAt: fixedNow().toISOString(), cache: { hit: true, ttlSeconds: 60 }, history: [bar], research,
      authorization: 'private-secret',
    }) });
    const tools = createResearchTools(deps);
    const history = await tools.getMarketHistory({ symbol: ' aapl ', limit: 1 });
    const result = await tools.getMarketResearch({ symbol: 'AAPL' });
    expect(deps.getResearchSnapshot).toHaveBeenCalledWith({ symbol: 'AAPL', range: '1y', interval: '1d' });
    expect(history.cache).toEqual({ hit: true, ttlSeconds: 60 });
    expect(result.research.quality.duplicateBars).toBe(2);
    expect(result.research.metadata.dataVersion).toBe('2');
    expect(deps.fetchHistory).not.toHaveBeenCalled();
    expect(deps.buildResearch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });

  it('history and research share the real service cache and coalesce provider calls', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ chart: { result: [{
      timestamp: [1_760_918_400, 1_761_004_800],
      indicators: { quote: [{ open: [10, 11], high: [12, 13], low: [9, 10], close: [11, 12], volume: [500, 600] }] },
      meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York' },
    }] } })));
    const tools = createResearchTools(dependencies({ getResearchSnapshot, buildResearch: buildMarketResearch }));
    const [history, research] = await Promise.all([
      tools.getMarketHistory({ symbol: 'MCPTEST' }), tools.getMarketResearch({ symbol: 'MCPTEST' }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(history.history).toHaveLength(2);
    expect(research.research.series).toHaveLength(2);
    expect((await tools.getMarketResearch({ symbol: 'MCPTEST' })).cache.hit).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('recalculates on the tighter sample cap when a shared snapshot is larger', async () => {
    const deps = dependencies({ getResearchSnapshot: vi.fn().mockResolvedValue({
      history: Array(700).fill(bar), research: { series: Array(700).fill(bar), quality: { barCount: 700 } },
    }) });
    const result = await createResearchTools(deps).getMarketResearch({ symbol: 'AAPL' });
    expect(deps.buildResearch.mock.calls[0][0]).toHaveLength(MAX_HISTORY_ROWS);
    expect(result.truncated).toBe(true);
  });

  it('compares only two normalized symbols on bounded daily ranges', async () => {
    const deps = dependencies({ getComparisonSnapshot: vi.fn().mockResolvedValue({
      ...comparisonSnapshot, requestHeaders: { authorization: 'private-secret' },
      comparison: { ...comparisonSnapshot.comparison, raw: 'private-secret', series: [{ ...comparisonSnapshot.comparison.series[0], apiKey: 'private-secret' }] },
    }) });
    const result = await createResearchTools(deps).getMarketComparison({ symbol: ' aapl ', benchmark: ' qqq ', range: '2y' });
    expect(deps.getComparisonSnapshot).toHaveBeenCalledWith({ symbol: 'AAPL', benchmark: 'QQQ', range: '2y', interval: '1d' });
    expect(result.comparison.metrics.correlation).toBe(0.5);
    expect(result.comparison.series[0].rollingCorrelation20).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });

  it.each([
    { symbol: 'AAPL', benchmark: 'https://example.com' },
    { symbol: ['AAPL', 'MSFT'] },
    { symbol: 'AAPL', range: 'max' },
    { symbol: 'AAPL', interval: '1m' },
  ])('rejects invalid comparison input before any service call: %j', async (input) => {
    const deps = dependencies();
    await expect(createResearchTools(deps).getMarketComparison(input)).rejects.toThrow();
    expect(deps.getComparisonSnapshot).not.toHaveBeenCalled();
  });

  it('rejects oversized comparison series rather than mismatch metrics and displayed sample', async () => {
    const deps = dependencies({ getComparisonSnapshot: vi.fn().mockResolvedValue({
      comparison: { ...comparisonSnapshot.comparison, series: Array(521).fill(comparisonSnapshot.comparison.series[0]) },
    }) });
    await expect(createResearchTools(deps).getMarketComparison({ symbol: 'AAPL' })).rejects.toThrow('comparison response');
  });

  it('overview is a fixed six-proxy operation with bounded sparklines and preserved gaps', async () => {
    const deps = dependencies({ getMarketOverview: vi.fn().mockResolvedValue({
      ...overviewSnapshot, raw: 'private-secret',
      rows: overviewSnapshot.rows.map((row) => ({ ...row, apiKey: 'private-secret', sparkline: [...Array(21).fill({ date: bar.date, close: 10 }), { date: bar.date, close: null }] })),
    }) });
    const tools = createResearchTools(deps);
    const result = await tools.getMarketOverview({});
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((row) => row.sparkline.length === 20)).toBe(true);
    expect(result.rows[0].sparkline.at(-1).close).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-secret');
    await expect(tools.getMarketOverview({ symbols: ['AAPL'] })).rejects.toThrow();
    expect(deps.getMarketOverview).toHaveBeenCalledTimes(1);
    deps.getMarketOverview.mockResolvedValueOnce({ ...overviewSnapshot, rows: [...overviewSnapshot.rows, { symbol: 'AAPL' }] });
    await expect(tools.getMarketOverview()).rejects.toThrow('overview response');
  });

  it('retains unavailable overview rows instead of manufacturing observations', async () => {
    const deps = dependencies({ getMarketOverview: vi.fn().mockResolvedValue({
      ...overviewSnapshot, status: 'unavailable', rows: overviewSnapshot.rows.map((row) => ({ ...row, latestClose: null, status: 'unavailable', sparkline: [] })),
    }) });
    const result = await createResearchTools(deps).getMarketOverview();
    expect(result.status).toBe('unavailable');
    expect(result.rows.every((row) => row.latestClose === null && row.sparkline.length === 0)).toBe(true);
  });

  it('keeps the concurrency limit after caller timeouts until upstream work settles', async () => {
    vi.useFakeTimers();
    let finish;
    const fetchHistory = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const tools = createResearchTools(dependencies({ fetchHistory, timeoutMs: 20 }));
    const first = tools.getMarketHistory({ symbol: 'AAPL' }).catch((error) => error);
    const second = tools.getMarketHistory({ symbol: 'MSFT' }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(21);
    expect((await first).message).toContain('deadline');
    expect((await second).message).toContain('deadline');
    await expect(tools.getMarketHistory({ symbol: 'GOOG' })).rejects.toThrow('busy');
    expect(fetchHistory).toHaveBeenCalledTimes(2);
    finish([bar]);
    await Promise.resolve();
  });

  it('limits serialized responses and rejects provider status arguments', () => {
    expect(() => toToolResult({ tooLarge: 'x'.repeat(256_000) })).toThrow('size limit');
    const tools = createResearchTools(dependencies());
    expect(() => tools.getProviderStatus({ key: 'secret' })).toThrow();
    expect(tools.getProviderStatus().providers[0].configured).toBe(true);
  });

  it('comparison and overview share the concurrency limit and retain timed-out slots', async () => {
    vi.useFakeTimers();
    const completions = [];
    const pending = () => new Promise((resolve) => completions.push(resolve));
    const deps = dependencies({ getComparisonSnapshot: vi.fn(pending), getMarketOverview: vi.fn(pending), timeoutMs: 20 });
    const tools = createResearchTools(deps);
    const comparison = tools.getMarketComparison({ symbol: 'AAPL' }).catch((error) => error);
    const overview = tools.getMarketOverview().catch((error) => error);
    await vi.advanceTimersByTimeAsync(21);
    expect((await comparison).message).toContain('deadline');
    expect((await overview).message).toContain('deadline');
    await expect(tools.getMarketHistory({ symbol: 'MSFT' })).rejects.toThrow('busy');
    expect(deps.fetchHistory).not.toHaveBeenCalled();
    completions[0](comparisonSnapshot);
    completions[1](overviewSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    await expect(tools.getMarketHistory({ symbol: 'MSFT' })).resolves.toHaveProperty('symbol', 'MSFT');
  });
});

describe('MCP wire behavior', () => {
  it('negotiates five read-only tools, calls the new tools and hides upstream errors', async () => {
    const deps = dependencies();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const connection = serveStdio(() => createResearchMcpServer(deps), { transport: serverTransport });
    const pending = new Map();
    clientTransport.onmessage = (message) => pending.get(message.id)?.(message);
    await clientTransport.start();
    let nextId = 0;
    const request = async (method, params) => {
      const id = ++nextId;
      const response = new Promise((resolve) => pending.set(id, resolve));
      await clientTransport.send({ jsonrpc: '2.0', id, method, params });
      return response;
    };
    try {
      const initialization = await request('initialize', {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'research-tests', version: '1.0.0' },
      });
      expect(initialization.result.serverInfo.name).toBe('patterngrow-research');
      await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const listed = await request('tools/list', {});
      expect(listed.result.tools.map((tool) => tool.name).sort()).toEqual([
        'get_market_comparison', 'get_market_history', 'get_market_overview', 'get_market_research', 'get_provider_status',
      ]);
      expect(listed.result.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
      const valid = await request('tools/call', { name: 'get_market_history', arguments: { symbol: 'AAPL' } });
      expect(valid.result.structuredContent.history).toHaveLength(1);
      const bad = await request('tools/call', { name: 'get_market_history', arguments: { symbol: 'https://example.com' } });
      expect(bad.result?.isError || Boolean(bad.error)).toBe(true);
      expect(deps.fetchHistory).toHaveBeenCalledTimes(1);
      deps.fetchHistory.mockRejectedValueOnce(new Error('https://upstream.invalid?apikey=private-secret'));
      const failed = await request('tools/call', { name: 'get_market_history', arguments: { symbol: 'AAPL' } });
      expect(failed.result.isError).toBe(true);
      expect(JSON.stringify(failed)).not.toContain('private-secret');
      const status = await request('tools/call', { name: 'get_provider_status', arguments: {} });
      expect(status.result.structuredContent.mode).toBe('historical-research');
      const comparison = await request('tools/call', { name: 'get_market_comparison', arguments: { symbol: 'AAPL' } });
      expect(comparison.result.structuredContent.benchmark).toBe('SPY');
      const overview = await request('tools/call', { name: 'get_market_overview', arguments: {} });
      expect(overview.result.structuredContent.rows).toHaveLength(6);
      const badOverview = await request('tools/call', { name: 'get_market_overview', arguments: { symbols: ['AAPL'] } });
      expect(badOverview.result?.isError || Boolean(badOverview.error)).toBe(true);
      expect(deps.getMarketOverview).toHaveBeenCalledTimes(1);
      deps.getComparisonSnapshot.mockRejectedValueOnce(new Error('https://upstream.invalid?apikey=private-secret'));
      const failedComparison = await request('tools/call', { name: 'get_market_comparison', arguments: { symbol: 'AAPL' } });
      expect(failedComparison.result.isError).toBe(true);
      expect(JSON.stringify(failedComparison)).not.toContain('private-secret');
    } finally {
      await connection.close();
      await clientTransport.close();
    }
  });
});
