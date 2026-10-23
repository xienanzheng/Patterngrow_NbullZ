import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createResearchTools, MAX_HISTORY_ROWS, toToolResult } from '../mcp/researchTools.js';
import { createResearchMcpServer } from '../mcp/server.js';

const bar = { date: '2026-10-20T00:00:00Z', open: 10, high: 12, low: 9, close: 11, volume: 500, source: 'yahoo' };
const fixedNow = () => new Date('2026-10-22T00:00:00Z');
const dependencies = (overrides = {}) => ({
  fetchHistory: vi.fn().mockResolvedValue([bar]),
  buildResearch: vi.fn().mockReturnValue({ volume: { latest: 500 }, quality: { status: 'limited' } }),
  providerStatus: vi.fn().mockReturnValue({ mode: 'historical-research', providers: [{ id: 'yahoo', configured: true }] }),
  now: fixedNow,
  ...overrides,
});

afterEach(() => vi.useRealTimers());

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
});

describe('MCP wire behavior', () => {
  it('negotiates, lists only three read-only tools, validates input and hides upstream errors', async () => {
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
        'get_market_history', 'get_market_research', 'get_provider_status',
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
    } finally {
      await connection.close();
      await clientTransport.close();
    }
  });
});
