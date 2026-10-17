import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { importFinancials, findFinancialQuestion } from '../src/features/Financials.js';
const csv = readFileSync(new URL('../fixtures/Tidewell.csv', import.meta.url), 'utf8');
describe('Financial evidence', () => {
  it('reconciles the actual sample and separates July operations from the credit', () => {
    const snapshot = importFinancials(csv, 'sample.csv', 'unspecified');
    expect(snapshot.rows).toHaveLength(24);
    expect(findFinancialQuestion(snapshot)).toMatchObject({
      month: '2026-07',
      operatingIncome: '-59797',
      credit: '182300',
      netIncome: '122503',
    });
    expect(snapshot.rows.at(-1)?.operatingIncome).toBe('-48531');
    expect(snapshot.currency).toBe('unspecified');
  });
  it('rejects inconsistent financial totals instead of accepting model guesses', () => {
    expect(() =>
      importFinancials(csv.replace('$122,503.00', '$122,504.00'), 'bad.csv', 'unspecified'),
    ).toThrow('does not reconcile');
  });
  it('rejects duplicate months', () => {
    const lines = csv.trim().split(/\r?\n/);
    const duplicate = lines[1];
    if (!duplicate) {
      throw new Error('Missing fixture row.');
    }
    expect(() => importFinancials(csv.trim() + '\r\n' + duplicate, 'bad.csv', 'CAD')).toThrow(
      'Duplicate month',
    );
  });
  it('uses content and confirmed currency for idempotency', () => {
    expect(importFinancials(csv, 'a.csv', 'CAD').hash).toBe(
      importFinancials(csv, 'b.csv', 'CAD').hash,
    );
    expect(importFinancials(csv, 'a.csv', 'CAD').hash).not.toBe(
      importFinancials(csv, 'a.csv', 'USD').hash,
    );
  });
  it('rejects missing or duplicate headers before reading financial values', () => {
    expect(() =>
      importFinancials(
        csv.replace('subscription_revenue', 'total_revenue'),
        'bad.csv',
        'unspecified',
      ),
    ).toThrow('CSV format:');
  });
});
