import { describe, expect, it } from 'vitest';
import { parseCsvRecords, parseCsvRows } from '../utils/csv.js';

describe('CSV parsing', () => {
  it('preserves commas and escaped quotes inside quoted fields', () => {
    const csv = [
      'symbol,name,exchange,sector,evidence',
      'AMZN,"Amazon.com, Inc.",NASDAQ,"Consumer Discretionary","Called ""the everything store""."',
    ].join('\r\n');

    expect(parseCsvRecords(csv)).toEqual([{
      symbol: 'AMZN',
      name: 'Amazon.com, Inc.',
      exchange: 'NASDAQ',
      sector: 'Consumer Discretionary',
      evidence: 'Called "the everything store".',
    }]);
  });

  it('supports embedded newlines and rejects unterminated quoted fields', () => {
    expect(parseCsvRows('symbol,evidence\nAAPL,"line one\nline two"')).toEqual([
      ['symbol', 'evidence'],
      ['AAPL', 'line one\nline two'],
    ]);
    expect(() => parseCsvRows('symbol,name\nAAPL,"Apple')).toThrow('unterminated quoted field');
  });
});
