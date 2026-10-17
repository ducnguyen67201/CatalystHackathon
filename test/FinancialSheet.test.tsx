import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { importFinancials } from '../src/features/Financials.js';
import { FinancialSheet } from '../src/web/FinancialSheet.js';

const snapshot = importFinancials(
  readFileSync(new URL('../fixtures/Tidewell.csv', import.meta.url), 'utf8'),
  'renamed.csv',
  'unspecified',
);

describe('Financial spreadsheet', () => {
  it('shows original precision, source references and fictional provenance without changing data', () => {
    const before = JSON.stringify(snapshot);
    const html = renderToStaticMarkup(
      <FinancialSheet snapshot={snapshot} snapshotCount={2} onUpload={() => undefined} />,
    );
    expect(html).toContain('$122,503.00');
    expect(html).toContain('CSV row 2');
    expect(html).toContain('R&amp;D salaries');
    expect(html).toContain('Currency not confirmed');
    expect(html).toContain('Fictional demo data');
    expect(html).toContain('aria-label="Operating loss"');
    expect(html).toContain(
      'aria-label="Positive net income includes a credit; operations made a loss"',
    );
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('does not label ordinary positive operating results as losses or credit-supported profit', () => {
    const first = snapshot.rows[0];
    if (!first) throw new Error('Missing fixture row');
    const html = renderToStaticMarkup(
      <FinancialSheet
        snapshot={{
          ...snapshot,
          hash: 'user-upload',
          rows: [{ ...first, operatingIncome: '100', netIncome: '100', credit: '0', raw: {} }],
        }}
        snapshotCount={1}
        onUpload={() => undefined}
      />,
    );
    expect(html).not.toContain('sheet-flagged');
    expect(html).not.toContain('Fictional demo data');
    expect(html).toContain('—');
  });

  it('offers an upload when there is no saved income statement', () => {
    const html = renderToStaticMarkup(
      <FinancialSheet snapshot={undefined} snapshotCount={0} onUpload={() => undefined} />,
    );
    expect(html).toContain('Your spreadsheet starts here');
    expect(html).not.toContain('<table');
  });
});
