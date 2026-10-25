import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { from, upsert, abortSignal } = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn(), abortSignal: vi.fn() }));
vi.mock('../utils/supabaseClient.js', () => ({ supabaseAdmin: { from } }));
const { logForecastSnapshot } = await import('../utils/accountability.js');

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue({ upsert });
  upsert.mockReturnValue({ abortSignal });
  abortSignal.mockResolvedValue({ error: null });
});
afterEach(() => vi.restoreAllMocks());

describe('legacy forecast recorder status', () => {
  it('bounds the write and preserves the documented same-day replacement policy', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    expect(await logForecastSnapshot({ symbol: 'AAPL', lastClose: 100, forecastModel: 'drift', horizon: 5, base: 101 })).toBe(true);
    expect(from).toHaveBeenCalledWith('forecast_log');
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'symbol,snapshot_date,forecast_model' });
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it('returns false and redacts database failure details', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    abortSignal.mockResolvedValue({ error: new Error('https://private.invalid?api_key=secret-value') });
    expect(await logForecastSnapshot({ symbol: 'AAPL' })).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-value');
  });
});
