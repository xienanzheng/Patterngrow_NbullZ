import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecordedHistoryReader } from '../utils/recordedHistory.js';

function fakeClient(results = {}) {
  const queries = [];
  return {
    queries,
    from: vi.fn((table) => {
      const query = { table };
      queries.push(query);
      const chain = {
        select(fields) { query.fields = fields; return chain; },
        eq(field, value) { query.filter = [field, value]; return chain; },
        order(field, options) { query.order = [field, options]; return chain; },
        limit(limit) { query.limit = limit; return chain; },
        abortSignal(signal) {
          query.signal = signal;
          return typeof results[table] === 'function'
            ? results[table](signal)
            : Promise.resolve(results[table] ?? { data: [], error: null });
        },
      };
      return chain;
    }),
  };
}

const decision = {
  decision_date: '2026-10-21', created_at: '2026-10-21T21:00:01+00:00',
  conviction_label: 'Medium Buy', conviction_score: '0.4',
  votes: { sma: 1, rsi: 0, macd: 1, bollinger: -1, stochastic: 0, adx: 1 },
};
const forecast = {
  snapshot_date: '2026-10-21', created_at: '2026-10-21T20:00:01.123Z',
  forecast_model: 'simple', horizon: 60, conviction_label: 'Medium Sell',
  conviction_score: '-0.4', last_close: '100.50',
};

afterEach(() => vi.useRealTimers());

describe('read-only recorded history', () => {
  it('reads only bounded explicit public fields from the two legacy sources', async () => {
    const client = fakeClient({ decision_log: { data: [decision] }, forecast_log: { data: [forecast] } });
    const result = await createRecordedHistoryReader({ client })({ symbol: ' aapl ' });
    expect(result.symbol).toBe('AAPL');
    expect(result.decisionLog).toEqual({
      status: 'available', coverage: 'daily_summary_only', sameDayPolicy: 'first_observation',
      rows: [{ decisionDate: '2026-10-21', createdAt: '2026-10-21T21:00:01.000Z', label: 'Medium Buy', score: 0.4, votes: decision.votes }],
    });
    expect(result.forecastLog).toEqual({
      status: 'available', sameDayPolicy: 'replaces_same_day_model',
      rows: [{ snapshotDate: '2026-10-21', createdAt: forecast.created_at, model: 'simple', horizon: 60, label: 'Medium Sell', score: -0.4, lastClose: 100.5 }],
    });
    expect(client.queries.map(({ table, fields, filter, order, limit }) => ({ table, fields, filter, order, limit }))).toEqual([
      { table: 'decision_log', fields: 'decision_date,created_at,conviction_label,conviction_score,votes', filter: ['symbol', 'AAPL'], order: ['decision_date', { ascending: false }], limit: 60 },
      { table: 'forecast_log', fields: 'snapshot_date,created_at,forecast_model,horizon,conviction_label,conviction_score,last_close', filter: ['symbol', 'AAPL'], order: ['snapshot_date', { ascending: false }], limit: 60 },
    ]);
    expect(result.notes.join(' ')).toMatch(/shared symbol records, not account-specific/);
    expect(result.notes.join(' ')).toMatch(/different settings/);
    expect(result.notes.join(' ')).toMatch(/completed daily bar/);
  });

  it('distinguishes empty available storage from storage not configured', async () => {
    const empty = await createRecordedHistoryReader({ client: fakeClient() })({ symbol: 'AAPL' });
    const absent = await createRecordedHistoryReader({ client: null })({ symbol: 'AAPL' });
    expect(empty.decisionLog).toMatchObject({ status: 'available', rows: [] });
    expect(empty.forecastLog).toMatchObject({ status: 'available', rows: [] });
    expect(absent.decisionLog).toMatchObject({ status: 'not_configured', rows: [] });
    expect(absent.forecastLog).toMatchObject({ status: 'not_configured', rows: [] });
  });

  it.each(['decision_log', 'forecast_log'])('isolates a returned failure in %s and redacts its details', async (failedTable) => {
    const client = fakeClient({
      decision_log: { data: [decision] }, forecast_log: { data: [forecast] },
      [failedTable]: { error: { message: 'https://private.example?apikey=secret-value' }, data: [] },
    });
    const result = await createRecordedHistoryReader({ client })({ symbol: 'AAPL' });
    const failed = failedTable === 'decision_log' ? 'decisionLog' : 'forecastLog';
    const available = failed === 'decisionLog' ? 'forecastLog' : 'decisionLog';
    expect(result[failed]).toMatchObject({ status: 'unavailable', rows: [] });
    expect(result[available].status).toBe('available');
    expect(result[available].rows).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/secret-value|private\.example/);
  });

  it('redacts thrown errors and invalid response bodies', async () => {
    const client = fakeClient({
      decision_log: () => { throw new Error('credential-secret'); },
      forecast_log: { data: { token: 'credential-secret' } },
    });
    const result = await createRecordedHistoryReader({ client })({ symbol: 'AAPL' });
    expect(result.decisionLog.status).toBe('unavailable');
    expect(result.forecastLog.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('credential-secret');
  });

  it('enforces the deadline even if a source ignores abort; keeps the successful source', async () => {
    vi.useFakeTimers();
    const client = fakeClient({ decision_log: () => new Promise(() => {}), forecast_log: { data: [forecast] } });
    const reading = createRecordedHistoryReader({ client, timeoutMs: 100 })({ symbol: 'AAPL' });
    await vi.advanceTimersByTimeAsync(100);
    const result = await reading;
    expect(result.decisionLog.status).toBe('unavailable');
    expect(result.forecastLog.rows).toHaveLength(1);
    expect(client.queries.find((query) => query.table === 'decision_log').signal.aborted).toBe(true);
  });

  it('caps oversized responses and strips unknown, private and recommendation fields', async () => {
    const polluted = { ...decision, recommended_action: 'secret-value', user_id: 'secret-value', votes: { ...decision.votes, private: 'secret-value' } };
    const client = fakeClient({ decision_log: { data: Array(100).fill(polluted) }, forecast_log: { data: Array(100).fill({ ...forecast, token: 'secret-value' }) } });
    const result = await createRecordedHistoryReader({ client })({ symbol: 'AAPL' });
    expect(result.decisionLog.rows).toHaveLength(60);
    expect(result.forecastLog.rows).toHaveLength(60);
    expect(JSON.stringify(result)).not.toMatch(/secret-value|recommended_action|user_id|token/);
  });

  it('does not turn null, blank, boolean or malformed scalars into recorded facts', async () => {
    const client = fakeClient({
      decision_log: { data: [
        { ...decision, decision_date: '2026-02-30' },
        { ...decision, created_at: 'secret-value', conviction_label: 'secret-value', conviction_score: null, votes: { sma: true, rsi: '1', macd: -1, bollinger: 12 } },
      ] },
      forecast_log: { data: [{ ...forecast, forecast_model: 'secret-value', horizon: false, conviction_score: '', last_close: null }] },
    });
    const result = await createRecordedHistoryReader({ client })({ symbol: 'AAPL' });
    expect(result.decisionLog.rows).toEqual([{
      decisionDate: decision.decision_date, createdAt: null, label: null, score: null,
      votes: { sma: null, rsi: null, macd: -1, bollinger: null, stochastic: null, adx: null },
    }]);
    expect(result.forecastLog.rows[0]).toMatchObject({ model: null, horizon: null, score: null, lastClose: null });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it.each([{}, { symbol: ['AAPL'] }, { symbol: 'https://example.com' }, { symbol: 'A'.repeat(21) }, { symbol: 'AAPL', limit: 100 }, { symbol: { value: 'AAPL' } }, null])('rejects ambiguous or unsupported input before database reads: %j', async (query) => {
    const client = fakeClient();
    await expect(createRecordedHistoryReader({ client })(query)).rejects.toMatchObject({ code: 'INVALID_RECORDED_HISTORY_QUERY' });
    expect(client.from).not.toHaveBeenCalled();
  });
});
