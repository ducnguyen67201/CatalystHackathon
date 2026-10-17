import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFinancials } from '../src/features/Financials.js';
import { buildFinancialPerformance } from '../src/features/FinancialPerformance.js';

const snapshot = importFinancials(
  readFileSync('fixtures/Tidewell.csv', 'utf8'),
  'Tidewell.csv',
  'unspecified',
);
describe('financial statement bridge and variance', () => {
  it('separates the credit from operating performance and preserves a source-linked reconciliation', () => {
    const before = JSON.stringify(snapshot);
    const report = buildFinancialPerformance(snapshot, {
      current: '2026-07',
      comparison: '2026-06',
    });
    expect(report.fictional).toBe(true);
    expect(report.currency).toBe('unspecified');
    expect(report.currentSourceRow).toBe(23);
    expect(report.rows.find((row) => row.id === 'operating')?.current).toMatchObject({
      value: '-59797',
      start: '0',
      end: '-59797',
    });
    expect(report.rows.find((row) => row.id === 'credit')?.current).toMatchObject({
      value: '182300',
      start: '-59797',
      end: '122503',
    });
    expect(report.rows.find((row) => row.id === 'netIncome')?.current?.value).toBe('122503');
    expect(report.rows.find((row) => row.id === 'revenue')?.delta).toBe('-5160');
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('treats lower expenses as favorable and uses exact decimals with a zero-base guard', () => {
    const previous = snapshot.rows[0];
    if (!previous) throw new Error('Missing row');
    const custom = {
      ...snapshot,
      rows: [
        {
          ...previous,
          month: '2026-01',
          revenue: '0',
          subscriptionRevenue: '0',
          cogs: '0',
          grossProfit: '0',
          expenses: '0.3',
          operatingIncome: '-0.3',
          credit: '0',
          netIncome: '-0.3',
        },
        {
          ...previous,
          month: '2026-02',
          revenue: '0.3',
          subscriptionRevenue: '0.1',
          cogs: '0.1',
          grossProfit: '0.2',
          expenses: '0.2',
          operatingIncome: '0',
          credit: '0',
          netIncome: '0',
        },
      ],
    };
    const result = buildFinancialPerformance(custom, {});
    expect(result.rows.find((row) => row.id === 'services')?.current?.value).toBe('0.2');
    expect(result.rows.find((row) => row.id === 'expenses')).toMatchObject({
      delta: '-0.1',
      deltaPercent: '-33.33',
      favorable: true,
    });
    expect(result.rows.find((row) => row.id === 'revenue')).toMatchObject({
      delta: '0.3',
      deltaPercent: null,
    });
    expect(result.rows.find((row) => row.id === 'operating')).toMatchObject({
      delta: '0.3',
      deltaPercent: '100.00',
      favorable: true,
    });
  });
  it('does not silently substitute an older month when the previous calendar month is missing', () => {
    const current = snapshot.rows.at(-1);
    const older = snapshot.rows[0];
    if (!current || !older) throw new Error('Missing rows');
    const result = buildFinancialPerformance({ ...snapshot, rows: [older, current] }, {});
    expect(result.comparisonPeriod).toBeNull();
    expect(result.rows.every((row) => row.delta === null && row.deltaPercent === null)).toBe(true);
    expect(result.comparisonNote).toContain('No statement for 2026-08');
    expect(
      buildFinancialPerformance(
        { ...snapshot, rows: [older, current] },
        { comparison: older.month },
      ).comparisonPeriod,
    ).toBe(older.month);
  });
  it('keeps missing statements unavailable and rejects invalid or forward comparisons', () => {
    expect(buildFinancialPerformance(undefined, {}).rows).toEqual([]);
    expect(() => buildFinancialPerformance(snapshot, { current: '2030-01' })).toThrow(
      'saved reporting period',
    );
    expect(() =>
      buildFinancialPerformance(snapshot, { current: '2026-07', comparison: '2026-07' }),
    ).toThrow('earlier');
    expect(() =>
      buildFinancialPerformance(snapshot, { current: '2026-07', comparison: '2030-01' }),
    ).toThrow('earlier');
  });
});
