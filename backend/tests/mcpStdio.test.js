import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('starts the real stdio entry and serves cached research, comparison and fixed overview without account configuration', async () => {
  // Stub only the provider network. The child loads the actual services, SDK and
  // stdio entry point; no provider credentials or external requests are needed.
  const preload = `
    const prices = Array.from({length:30}, (_, i) => 100 + i + (i % 7) / 10);
    globalThis.fetch = async () => new Response(JSON.stringify({chart:{result:[{
      timestamp:prices.map((_,i) => Date.parse('2026-08-03T20:00:00Z') / 1000 + i * 86400),
      meta:{currency:'USD',exchangeTimezoneName:'America/New_York'},
      indicators:{quote:[{open:prices,high:prices.map(p => p+1),low:prices.map(p => p-1),close:prices,volume:prices.map(() => 1000)}]}
    }]}}),{status:200});
  `;
  const child = spawn(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('../mcp/server.js', import.meta.url)),
  ], {
    cwd: tmpdir(),
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', MARKET_DATA_PROVIDER: 'yahoo' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let nextId = 0;
  let malformedOutput = false;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    } catch { malformedOutput = true; }
  });
  const watchdog = setTimeout(() => child.kill(), 8_000);
  const request = async (method, params) => {
    const id = ++nextId;
    const response = new Promise((resolve) => pending.set(id, resolve));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return Promise.race([response, exited.then(() => { throw new Error('MCP exited before a response.'); })]);
  };
  try {
    const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stdio-test', version: '1.0' } });
    expect(init.result.serverInfo.name).toBe('patterngrow-research');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const listed = await request('tools/list', {});
    expect(listed.result.tools).toHaveLength(5);
    expect(listed.result.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    const comparison = await request('tools/call', { name: 'get_market_comparison', arguments: { symbol: 'AAPL', range: '1mo' } });
    expect(comparison.result.isError).not.toBe(true);
    expect(comparison.result.structuredContent.comparison.series).toHaveLength(30);
    expect(comparison.result.structuredContent.comparison.sample.pairedReturns).toBe(29);
    const research = await request('tools/call', { name: 'get_market_research', arguments: { symbol: 'AAPL', range: '1mo' } });
    expect(research.result.structuredContent.cache.hit).toBe(true);
    expect(research.result.structuredContent.research.metadata.currency).toBe('USD');
    const overview = await request('tools/call', { name: 'get_market_overview', arguments: {} });
    expect(overview.result.isError).not.toBe(true);
    expect(overview.result.structuredContent.rows.map((row) => row.symbol)).toEqual(['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'USO']);
    expect(overview.result.structuredContent.rows.every((row) => row.sparkline.length === 20)).toBe(true);
    expect(overview.result.structuredContent.rows[0].sparkline[0].close).toEqual(expect.any(Number));
    expect(malformedOutput).toBe(false);
    expect(stderr).toBe('');
  } finally {
    clearTimeout(watchdog);
    lines.close();
    child.stdin.end();
    child.kill();
    await exited;
  }
}, 10_000);
