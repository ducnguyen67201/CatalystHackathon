import { describe, expect, it } from 'vitest';
import { evaluationContextSchema } from '../src/contracts/RehearsalEvaluation.js';
import { projectEvidenceReview } from '../src/features/EvidenceReview.js';
import { evidenceFixture, refreshEvidenceHashes } from './EvidenceReviewFixtures.js';

function fixture() {
  const data = evidenceFixture();
  return {
    ...data,
    project: () => projectEvidenceReview('session', data.evaluation, data.context),
  };
}

describe('frozen evidence review projection', () => {
  it('links exact quotes to primary and explanatory cells without changing saved data', () => {
    const { context, evaluation, project } = fixture();
    const before = JSON.stringify({ context, evaluation });
    const result = project();
    const link = result.claimLinks.find((c) => c.claimId === 'profit');
    expect(link?.comparison).toEqual({
      claimed: '12000',
      source: '-18000',
      difference: '30000',
      period: '2026-09',
      unit: 'CAD',
    });
    expect(link?.primaryCellIds).toEqual(['financial:fictional-snapshot:4:operating_income']);
    expect(link?.cellIds).toHaveLength(3);
    const cell = result.grids[0]?.cells.find((c) => c.id === link?.primaryCellIds[0]);
    expect(cell?.displayAddress).toBe('C8');
    expect(cell?.sourceLocator).toMatchObject({
      fileName: 'Fictional.csv',
      sourceRow: 4,
      columnKey: 'operating_income',
    });
    expect(cell?.origin).toBe('fictional');
    expect(result.claimLinks.find((c) => c.claimId === 'revenue')?.comparison?.difference).toBe(
      '0',
    );
    expect(result.claimLinks.find((c) => c.claimId === 'runway')).toMatchObject({
      support: 'insufficient_evidence',
      cellIds: [],
      comparison: null,
    });
    expect(JSON.stringify({ context, evaluation })).toBe(before);
  });
  it('does exact decimal arithmetic and calendar-aligned month changes', () => {
    const { context, evaluation, project } = fixture();
    const result = project();
    expect(result.changes.find((c) => c.currentFactId === '2026-09:revenue')).toMatchObject({
      absoluteDelta: '12000',
      percentDelta: '15.00',
      previousPeriod: '2026-08',
    });
    expect(
      result.changes.find((c) => c.currentFactId === '2026-09:operating_income'),
    ).toMatchObject({ absoluteDelta: '4000', percentDelta: null });
    expect(
      result.changes.find((c) => c.currentFactId === '2026-08:revenue')?.unavailableReason,
    ).toContain('adjacent');
    const source = context.sources.find((s) => s.id.endsWith(':4'));
    const fact = context.facts.find((f) => f.id === '2026-09:revenue');
    const claim = evaluation.report?.extraction.claims.find((c) => c.id === 'revenue');
    if (!source || !fact || !claim) throw new Error('Missing fixture');
    source.text = source.text.replace('"revenue":"92000"', '"revenue":"0.2"');
    fact.value = '0.2';
    claim.value = '0.1';
    refreshEvidenceHashes(context, evaluation);
    expect(project().claimLinks.find((c) => c.claimId === 'revenue')?.comparison?.difference).toBe(
      '-0.1',
    );
  });
  it('keeps legacy context hashes and original row citations without inventing a filename', () => {
    const { context, evaluation, project } = fixture();
    context.sources.forEach((s) => {
      delete s.financialLocation;
    });
    refreshEvidenceHashes(context, evaluation);
    expect(JSON.stringify(evaluationContextSchema.parse(context))).toBe(JSON.stringify(context));
    expect(project().grids[0]?.cells[0]?.sourceLocator).toMatchObject({
      fileName: null,
      sourceRow: 3,
    });
    expect(project().claimLinks.find((c) => c.claimId === 'profit')?.comparison?.source).toBe(
      '-18000',
    );
  });
  it('rejects a raw-column mismatch as one unavailable source instead of publishing partial row evidence', () => {
    const { context, evaluation, project } = fixture();
    const source = context.sources[1];
    if (!source) throw new Error('Missing fixture');
    source.text = source.text.slice(0, -1) + ',"raw":{"operating_income":"999"}}';
    refreshEvidenceHashes(context, evaluation);
    expect(project().coverage.unavailableSources).toHaveLength(1);
    expect(project().grids[0]?.periods).toEqual(['2026-08']);
    expect(project().claimLinks[0]?.comparison).toBeNull();
  });
  it('exposes source failures without substituting other periods or newer financials', () => {
    const { context, evaluation, project } = fixture();
    const source = context.sources.find((s) => s.id.endsWith(':4'));
    if (!source) throw new Error('Missing fixture');
    source.text = '{malformed';
    refreshEvidenceHashes(context, evaluation);
    expect(project().coverage.unavailableSources).toHaveLength(1);
    expect(project().claimLinks[0]?.comparison).toBeNull();
    expect(project().grids[0]?.periods).toEqual(['2026-08']);
    expect(
      projectEvidenceReview('session', evaluation, context, false, 'new-snapshot')
        .currentSnapshotChanged,
    ).toBe(true);
  });
  it('refuses mismatched source identity, metric values and duplicate reporting periods', () => {
    const { context, evaluation, project } = fixture();
    const source = context.sources[1];
    if (!source) throw new Error('Missing fixture');
    source.id = 'financial:another-snapshot:4';
    refreshEvidenceHashes(context, evaluation);
    expect(project().claimLinks[0]?.comparison).toBeNull();
    source.id = 'financial:fictional-snapshot:4';
    const fact = context.facts.find((f) => f.id === '2026-09:operating_income');
    if (!fact) throw new Error('Missing fixture');
    fact.value = '999';
    refreshEvidenceHashes(context, evaluation);
    expect(project().claimLinks[0]?.comparison).toBeNull();
    context.sources.push({
      ...source,
      id: 'financial:fictional-snapshot:5',
      financialLocation: {
        ...source.financialLocation,
        kind: 'csv',
        snapshotId: 'fictional-snapshot',
        fileName: 'Fictional.csv',
        sourceRow: 5,
      },
      text: source.text.replace('"sourceRow":4', '"sourceRow":5'),
    });
    refreshEvidenceHashes(context, evaluation);
    expect(project().coverage.unavailableSources.some((s) => s.reason.includes('Multiple'))).toBe(
      true,
    );
    expect(project().grids[0]?.periods).toEqual(['2026-08']);
  });
  it('handles repeated quotes, UTF-16 offsets, missing quotes and later corrections honestly', () => {
    const { context, evaluation, project } = fixture();
    const turn = evaluation.turns.find((t) => t.id === 'answer');
    const claim = evaluation.report?.extraction.claims[0];
    if (!turn || !claim) throw new Error('Missing fixture');
    turn.text = '🙂 ' + turn.text;
    refreshEvidenceHashes(context, evaluation);
    const span = project().claimLinks[0]?.span;
    expect(span && turn.text.slice(span.startUtf16, span.endUtf16)).toBe(claim.quote);
    turn.text += ' ' + claim.quote;
    refreshEvidenceHashes(context, evaluation);
    expect(project().claimLinks[0]).toMatchObject({ span: null, spanStatus: 'repeated' });
    claim.quote = 'This was not said.';
    expect(project().claimLinks[0]).toMatchObject({ span: null, spanStatus: 'unavailable' });
    claim.supersededByTurnId = 'runway';
    expect(project().claimLinks[0]).toMatchObject({
      support: 'not_checked',
      comparison: null,
      correctedByTurnId: 'runway',
    });
  });
  it('suppresses comparisons for unknown currency, changed units and non-actual claims', () => {
    const { context, evaluation, project } = fixture();
    context.facts.forEach((f) => {
      f.unit = 'unspecified';
    });
    const claim = evaluation.report?.extraction.claims[0];
    if (!claim) throw new Error('Missing fixture');
    claim.unit = 'unspecified';
    refreshEvidenceHashes(context, evaluation);
    expect(project().claimLinks[0]?.comparison).toBeNull();
    expect(project().claimLinks[0]?.unavailableReason).toContain('Currency');
    expect(project().changes.every((c) => c.absoluteDelta === null)).toBe(true);
    context.facts.forEach((f) => {
      f.unit = 'CAD';
    });
    claim.unit = 'USD';
    refreshEvidenceHashes(context, evaluation);
    expect(project().claimLinks[0]?.comparison).toBeNull();
    claim.unit = 'CAD';
    claim.kind = 'forecast';
    expect(project().claimLinks[0]?.comparison).toBeNull();
  });
  it('highlights verified calculation inputs for derived margin facts', () => {
    const { context, evaluation, project } = fixture();
    context.facts.push({
      id: '2026-09:gross_margin',
      metric: 'gross_margin',
      value: '69.56521739',
      unit: 'percent',
      period: '2026-09',
      sourceIds: ['financial:fictional-snapshot:4'],
      calculation: 'gross_profit / revenue * 100',
    });
    const claim = evaluation.report?.extraction.claims[1];
    const check = evaluation.report?.checks[1];
    if (!claim || !check) throw new Error('Missing fixture');
    Object.assign(claim, { metric: 'gross_margin', value: '69.56521739', unit: 'percent' });
    const turn = evaluation.turns.find((t) => t.id === 'answer');
    if (!turn) throw new Error('Missing fixture');
    claim.quote = 'Gross margin was 69.56521739 percent.';
    turn.text += ' ' + claim.quote;
    check.factIds = ['2026-09:gross_margin'];
    refreshEvidenceHashes(context, evaluation);
    expect(project().claimLinks[1]?.primaryCellIds).toEqual([
      'financial:fictional-snapshot:4:gross_profit',
      'financial:fictional-snapshot:4:revenue',
    ]);
    expect(project().claimLinks[1]?.comparison?.difference).toBe('0');
  });
  it('exposes pending, failed, skipped, contextless and integrity states without claim links', () => {
    const { context, evaluation, project } = fixture();
    evaluation.status = 'queued';
    evaluation.report = null;
    expect(project().state).toBe('pending');
    expect(project().claimLinks).toEqual([]);
    expect(projectEvidenceReview('session', evaluation, context, true).state).toBe('failed');
    evaluation.status = 'skipped';
    expect(project().state).toBe('skipped');
    expect(
      projectEvidenceReview('session', evaluation, null).coverage.limitations.some((s) =>
        s.includes('no frozen'),
      ),
    ).toBe(true);
    context.facts[0]?.sourceIds.push('invalid');
    expect(project().reason).toContain('integrity');
    expect(project().grids).toEqual([]);
  });
});
