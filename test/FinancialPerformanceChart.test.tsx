import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { importFinancials } from '../src/features/Financials.js';
import { buildFinancialPerformance } from '../src/features/FinancialPerformance.js';
import { FinancialStatementTable } from '../src/web/FinancialPerformanceStatement.js';

describe('professional financial statement presentation', () => {
  it('renders aligned period bridges, exact amounts and accessible signed variances', () => {
    const snapshot = importFinancials(
      readFileSync('fixtures/Tidewell.csv', 'utf8'),
      'Tidewell.csv',
      'unspecified',
    );
    const data = buildFinancialPerformance(snapshot, { current: '2026-07', comparison: '2026-06' });
    const html = renderToStaticMarkup(<FinancialStatementTable data={data} />);
    expect(html).toContain('Profit &amp; loss');
    expect(html).toContain('currency not confirmed');
    expect(html).toContain('2026-07');
    expect(html).toContain('2026-06');
    expect(html).toContain('Operating result');
    expect(html).toContain('Other income / credit');
    expect(html).toContain('-59,797');
    expect(html).toContain('182,300');
    expect(html).toContain('122,503');
    expect(html).toContain('Δ Amount');
    expect(html).toContain('Δ %');
    expect(html).toContain('scope="row"');
    expect(html).toContain('role="img"');
  });
});
