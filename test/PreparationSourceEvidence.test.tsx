import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { importFinancials } from '../src/features/Financials.js';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { buildPreparationPlan } from '../src/features/PreparationPlanner.js';
import {
  preparationStateSchema,
  preparationGoalSchema,
} from '../src/contracts/FundraisingPreparation.js';
import { preparationCsvSource } from '../src/features/PreparationSource.js';
import {
  ExactCsvTable,
  HighlightedPassage,
  InvestorSourceEvidence,
} from '../src/web/PreparationSourceEvidence.js';
function fixture() {
  const csv = readFileSync('fixtures/Tidewell.csv', 'utf8');
  const snapshot = importFinancials(csv, 'Tidewell.csv', 'unspecified');
  const { state } = preparationFixture();
  state.snapshots = [snapshot];
  state.onboarding.snapshotId = snapshot.id;
  const goal = preparationGoalSchema.parse({
    id: randomUUID(),
    confirmedAt: '2026-10-17T12:00:00Z',
    round: 'Next round',
    previousRounds: null,
    amount: null,
    currency: 'unspecified',
    targetDate: null,
    timezone: 'UTC',
    investorId: null,
  });
  const plan = buildPreparationPlan(state, goal, goal.confirmedAt);
  state.preparation = preparationStateSchema.parse({ plans: [plan], goals: [goal] });
  const artifact = plan.artifacts[0];
  if (!artifact) throw new Error('Missing financial artifact');
  return { csv, snapshot, state, plan, artifact };
}
describe('precise preparation evidence', () => {
  it('retains uploaded CSV text unchanged and highlights exact saved cells from the artifact snapshot', () => {
    const { csv, snapshot, state, plan, artifact } = fixture();
    expect(snapshot.sourceCsv).toBe(csv);
    const data = preparationCsvSource(state, plan.id, artifact.id);
    expect(data.sourceCsv).toBe(csv);
    expect(data.highlightedRecord).toBe(23);
    expect(data.rows.find((row) => row.record === 23)?.cells.operating_income).toBe('-$59,797.00');
    const html = renderToStaticMarkup(<ExactCsvTable data={data} />);
    expect(html).toContain('operating_income: supporting cell');
    expect(html).toContain('-$59,797.00');
    expect(html).toContain('other_income_srred_credit');
    expect(html).toContain('182,300.00');
    expect(html).toContain('scope="col"');
    state.onboarding.snapshotId = 'another-selected-snapshot';
    expect(preparationCsvSource(state, plan.id, artifact.id)).toEqual(data);
    expect(() => preparationCsvSource(state, 'unknown', artifact.id)).toThrow('unavailable');
  });
  it('does not reconstruct older source files or mutate historical snapshots', () => {
    const { state, plan, artifact } = fixture();
    const snapshot = state.snapshots[0];
    if (!snapshot) throw new Error('Missing snapshot');
    delete snapshot.sourceCsv;
    const before = structuredClone(state);
    expect(preparationCsvSource(state, plan.id, artifact.id).sourceCsv).toBeNull();
    expect(state).toEqual(before);
  });
  it('highlights only an exact saved quote and keeps interpretation and attribution separate', () => {
    const html = renderToStaticMarkup(
      <HighlightedPassage
        text="Before. We prefer durable revenue. After."
        quote="We prefer durable revenue."
      />,
    );
    expect(html).toContain('Before. <mark>We prefer durable revenue.</mark> After.');
    const missing = renderToStaticMarkup(
      <HighlightedPassage text="Different text" quote="We prefer durable revenue." />,
    );
    expect(missing).toContain('could not be located');
    expect(missing).not.toContain('<mark>');
    const source = renderToStaticMarkup(
      <InvestorSourceEvidence
        source={{
          id: 'source',
          title: 'An investment thesis',
          excerpt: 'We prefer durable revenue.',
          url: 'https://example.com/thesis',
          recordedAt: '2026-10-17',
          publishedAt: '2026-09-01',
          fictional: false,
          investorName: 'Example Fund',
          interpretation: 'Prepare retention evidence.',
        }}
      />,
    );
    expect(source).toContain('<mark>We prefer durable revenue.</mark>');
    expect(source).toContain('not a source quote');
    expect(source).toContain('Author/speaker: not captured');
    expect(source).toContain('2026-09-01');
    expect(source).toContain('https://example.com/thesis');
  });
});
