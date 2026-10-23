import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('public research without account-service configuration', () => {
  it('starts safely, serves observed research and keeps private routes closed', async () => {
    const appUrl = new URL('../index.js', import.meta.url).href;
    const clientUrl = new URL('../utils/supabaseClient.js', import.meta.url).href;
    // A fresh process bypasses the test suite's intentionally fake Supabase config
    // and proves that module import/startup does not depend on account credentials.
    const script = `
      import assert from 'node:assert/strict';
      const nativeFetch = globalThis.fetch;
      const start = Date.parse('2026-01-01T00:00:00Z') / 1000;
      const prices = Array.from({ length: 25 }, (_, i) => 100 + i);
      globalThis.fetch = async () => new Response(JSON.stringify({
        chart: { result: [{
          timestamp: prices.map((_, i) => start + i * 86400),
          meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York' },
          indicators: { quote: [{ open: prices, high: prices.map(p => p + 1), low: prices.map(p => p - 1), close: prices, volume: prices.map(() => 1000) }] },
        }] },
      }), { status: 200 });
      const { default: app } = await import(${JSON.stringify(appUrl)});
      const { supabaseAdmin, getUserFromRequest } = await import(${JSON.stringify(clientUrl)});
      assert.equal(supabaseAdmin, null);
      assert.equal((await getUserFromRequest({ headers: { authorization: 'Bearer unverified-token' } })).user, null);
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = 'http://127.0.0.1:' + server.address().port;
      const get = (path, authorization) => nativeFetch(base + path, { headers: { Connection: 'close', ...(authorization ? { Authorization: authorization } : {}) } });
      try {
        assert.equal((await get('/api/health')).status, 200);
        const research = await get('/api/analytics/research?symbol=AAPL&range=1y&interval=1d');
        assert.equal(research.status, 200);
        const payload = await research.json();
        assert.equal(payload.history.length, 25);
        assert.equal(payload.research.quality.source, 'yahoo');
        for (const path of ['/api/watchlist', '/api/positions', '/api/user/preferences']) {
          assert.equal((await get(path)).status, 401);
          const protectedResponse = await get(path, 'Bearer unverified-token');
          assert.equal(protectedResponse.status, 401);
          assert.equal((await protectedResponse.json()).error, 'Sign-in is unavailable on this server.');
        }
        process.stdout.write('public-research-ok; private-routes-closed');
      } finally {
        await new Promise(resolve => server.close(resolve));
      }
    `;
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: tmpdir(),
      env: {
        ...process.env,
        VERCEL: '1',
        SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', SUPABASE_ANON_KEY: '',
        MARKET_DATA_PROVIDER: 'yahoo',
        YAHOO_FINANCE_API_BASE: 'https://query1.finance.yahoo.com',
        TWELVE_DATA_API_KEY: '',
      },
      timeout: 10_000,
    });
    expect(stdout).toBe('public-research-ok; private-routes-closed');
    expect(stderr).toBe('');
  }, 15_000);
});
