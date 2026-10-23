import { describe, expect, it } from 'vitest';
import { historyCsv, normalizeWorkspace, readSavedViews, researchSessionDate, researchSnapshot, saveWorkspaceView, workspaceQuery } from '../../frontend/src/utils/researchWorkspace.js';

describe('research workspace persistence and exports', () => {
  it('normalizes shared links and rejects arbitrary symbols and views', () => {
    expect(normalizeWorkspace({ symbol: ' msft ', benchmark: 'qqq', range: '6mo', view: 'compare' })).toEqual({ symbol: 'MSFT', benchmark: 'QQQ', range: '6mo', view: 'compare' });
    expect(normalizeWorkspace({ symbol: '<script>', benchmark: 'https://a', range: 'max', view: 'orders' })).toEqual({ symbol: 'AAPL', benchmark: 'SPY', range: '1y', view: 'price' });
    expect(new URLSearchParams(workspaceQuery({ symbol: '^GSPC' })).get('symbol')).toBe('^GSPC');
  });
  it('does not crash on unavailable, malformed or oversized browser storage', () => {
    expect(readSavedViews({ getItem() { throw new Error('denied'); } })).toEqual([]);
    for (const value of ['{broken', '{}', 'x'.repeat(20_001)]) expect(readSavedViews({ getItem: () => value })).toEqual([]);
  });
  it('labels daily bars by exchange date without inventing an unknown timezone', () => {
    expect(researchSessionDate({ date: '2026-01-05T23:00:00Z', exchangeTimezone: 'Australia/Sydney' })).toBe('2026-01-06');
    expect(researchSessionDate({ date: '2026-01-05T00:00:00Z', datePrecision: 'date', exchangeTimezone: 'America/New_York' })).toBe('2026-01-05');
    expect(researchSessionDate({ date: '2026-01-05T00:00:00Z', datePrecision: 'session-date', exchangeTimezone: 'America/New_York' })).toBe('2026-01-05');
    expect(researchSessionDate({ date: '2026-01-05T23:00:00Z' })).toBeNull();
    expect(researchSessionDate({ date: '2026-01-05T23:00:00Z', exchangeTimezone: 'invalid' })).toBeNull();
  });
  it('validates, deduplicates, and bounds stored views without retaining unknown fields', () => {
    const valid = normalizeWorkspace({});
    const data = [null, [], { ...valid, symbol: 'http://a' }, { ...valid, arbitrary: 'ignore' }, valid];
    expect(readSavedViews({ getItem: () => JSON.stringify(data) })).toEqual([valid]);
    let views = [];
    for (let i = 0; i < 20; i++) views = saveWorkspaceView(views, { symbol: `A${i}` });
    expect(views).toHaveLength(12);
    expect(views[0].symbol).toBe('A19');
    expect(saveWorkspaceView(views, views[0])).toHaveLength(12);
  });
  it('exports missingness, timezone provenance and formula-safe CSV text', () => {
    const csv = historyCsv({ history: [{ date: '2026-01-01', close: null, volume: 0, source: '  =HYPERLINK("a")', currency: 'USD', datePrecision: 'date', exchangeTimezone: 'America/New_York' }] });
    expect(csv).toContain('datePrecision,exchangeTimezone');
    expect(csv).toContain('"",\"0\"');
    expect(csv).toContain('"\'  =HYPERLINK(""a"")"');
    expect(csv).toContain('"date","America/New_York"');
  });
  it('keeps exact data and metadata in a versioned snapshot', () => {
    const payload = { history: [{ close: null }], research: { metadata: { currency: null } } };
    const result = researchSnapshot(payload, { symbol: 'msft' }, '2026-01-01T00:00:00.000Z');
    expect(result.dataset).toBe(payload);
    expect(result.schemaVersion).toBe('patterngrow.research-snapshot.v1');
    expect(result.workspace.symbol).toBe('MSFT');
    expect(result.exportedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
