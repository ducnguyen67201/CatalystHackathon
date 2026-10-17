import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { importFinancials } from '../src/features/Financials.js';
import { checkDeckClaim, projectDeckClaims } from '../src/features/DeckClaims.js';
import { deckClaimSchema } from '../src/contracts/DeckClaims.js';

function fixture() {
  const { state } = preparationFixture();
  const snapshot = importFinancials(
    readFileSync('fixtures/Tidewell.csv', 'utf8'),
    'RenamedSample.csv',
    'CAD',
  );
  state.snapshots = [snapshot];
  state.onboarding.snapshotId = snapshot.id;
  const claim = deckClaimSchema.parse({
    id: randomUUID(),
    snapshotId: snapshot.id,
    createdAt: new Date().toISOString(),
    drafts: [],
    quote: 'Our operating income was 122503 CAD.',
    location: 'Fictional deck, slide 5',
    metric: 'operating_income',
    value: '122503',
    unit: 'CAD',
    period: '2026-07',
    kind: 'actual',
    precision: 0,
  });
  return { state, snapshot, claim };
}
describe('Evidence-backed deck claims', () => {
  it('distinguishes operating results from credited net income with original row provenance', () => {
    const { state, claim } = fixture();
    const result = checkDeckClaim(state, claim);
    expect(result.status).toBe('contradicted');
    expect(result.value).toBe('-59797');
    expect(result.sourceRows[0]).toMatchObject({
      row: 23,
      period: '2026-07',
      cells: { operating_income: '-59797' },
    });
    expect(result.fictional).toBe(true);
    expect(result.suggestion).toContain('separate from other income');
  });
  it('uses an explicit support adjustment rather than accepting the booked margin definition', () => {
    const { state, claim } = fixture();
    const booked = checkDeckClaim(state, {
      ...claim,
      metric: 'gross_margin',
      unit: 'percent',
      value: '92',
    });
    const adjusted = checkDeckClaim(state, {
      ...claim,
      metric: 'support_adjusted_margin',
      unit: 'percent',
      value: '92',
    });
    expect(Number(adjusted.value)).toBeLessThan(Number(booked.value));
    expect(adjusted.status).toBe('contradicted');
    expect(adjusted.formula).toContain('original books unchanged');
    expect(adjusted.sourceRows[0]?.cells.customer_success_salaries).toBeDefined();
  });
  it('keeps missing MRR, customer and cash evidence unknown', () => {
    const { state, claim } = fixture();
    for (const metric of ['arr', 'nrr', 'logo_churn', 'cac', 'cac_payback', 'runway'] as const) {
      const result = checkDeckClaim(state, { ...claim, metric });
      expect(result.status).toBe('insufficient_evidence');
      expect(result.value).toBeNull();
      expect(result.sourceRows).toEqual([]);
    }
  });
  it('does not compare forecasts to actuals or infer currencies', () => {
    const { state, snapshot, claim } = fixture();
    expect(checkDeckClaim(state, { ...claim, kind: 'forecast' }).status).toBe('not_checked');
    expect(checkDeckClaim(state, { ...claim, unit: 'USD' }).status).toBe('ambiguous');
    snapshot.currency = 'unspecified';
    expect(checkDeckClaim(state, claim).status).toBe('ambiguous');
  });
  it('pins historical evidence when the founder selects a different statement', () => {
    const { state, snapshot, claim } = fixture();
    state.snapshots.push({
      ...snapshot,
      id: 'new-source',
      rows: snapshot.rows.map((row) => ({ ...row, operatingIncome: '999' })),
    });
    state.onboarding.snapshotId = 'new-source';
    const result = checkDeckClaim(state, claim);
    expect(result.stale).toBe(true);
    expect(result.value).toBe('-59797');
  });
  it('does not verify a claim because its draft was saved', () => {
    const { state, claim } = fixture();
    claim.drafts.push({
      id: randomUUID(),
      text: 'Corrected draft',
      createdAt: new Date().toISOString(),
    });
    expect(checkDeckClaim(state, claim).status).toBe('contradicted');
    expect(claim.quote).toBe('Our operating income was 122503 CAD.');
    expect(projectDeckClaims(state).results).toEqual([]);
  });
  it('uses declared comparison precision and never divides by zero', () => {
    const { state, snapshot, claim } = fixture();
    const row = snapshot.rows.find((item) => item.month === claim.period);
    if (!row) throw new Error('Missing source row');
    row.grossProfit = '1';
    row.revenue = '3';
    expect(
      checkDeckClaim(state, {
        ...claim,
        metric: 'gross_margin',
        unit: 'percent',
        value: '33.33',
        precision: 2,
      }).status,
    ).toBe('supported');
    row.revenue = '0';
    expect(
      checkDeckClaim(state, { ...claim, metric: 'gross_margin', unit: 'percent' }).value,
    ).toBeNull();
  });
});
