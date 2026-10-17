import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { evidenceFixture } from './EvidenceReviewFixtures.js';
import { fixtureEvaluationProvider } from './EvaluationFixtures.js';
import { runInvestorEvaluation } from '../src/features/InvestorEvaluationWorkflow.js';
import { runPeerEvaluation } from '../src/features/PeerEvaluationWorkflow.js';
import { runEvaluationWorkflows } from '../src/features/EvaluationOrchestrator.js';
import { buildPeerComparison } from '../src/features/PeerComparison.js';
import { snapshotSchema } from '../src/contracts/Workspace.js';
import { peerRecordSchema } from '../src/contracts/PeerComparison.js';
import { EvaluationWorkflows } from '../src/web/EvaluationWorkflows.js';
import type { EvaluationProgress } from '../src/contracts/RehearsalEvaluation.js';
import type { EvaluationInput } from '../src/features/EvaluationProvider.js';
import { withoutPeerComparison } from '../src/contracts/RehearsalEvaluation.js';

function context() {
  const { context } = evidenceFixture();
  context.investorId = 'selected-investor';
  context.investorName = 'Fictional Seed Fund';
  context.sources.push({
    id: 'investor:selected',
    kind: 'investor',
    title: 'Fictional source',
    text: 'Fictional Seed Fund invested in seed software companies in Canada.',
    url: 'https://example.com/fictional',
    recordedAt: context.capturedAt,
    origin: 'fictional',
  });
  context.investorAssessment = {
    company: { stage: 'Seed', sector: 'software', geography: 'Canada' },
    observations: [
      { sourceId: 'investor:selected', stage: 'Seed', sector: 'software', geography: 'Canada' },
    ],
  };
  return context;
}
function input(): EvaluationInput {
  return {
    context: withoutPeerComparison(context()),
    turns: [
      { id: 'answer', role: 'user', text: 'Our operating income is -48531 CAD for 2026-09.' },
    ],
    scope: 'complete',
    clarification: null,
    previous: null,
  };
}
function peerContext() {
  const frozen = context();
  const rows = [
    { month: '2026-08', revenue: '100', grossProfit: '60', operatingIncome: '-20', sourceRow: 2 },
    { month: '2026-09', revenue: '120', grossProfit: '84', operatingIncome: '-12', sourceRow: 3 },
  ];
  const snapshot = snapshotSchema.parse({
    id: 'statement',
    hash: 'real',
    fileName: 'Statement.csv',
    currency: 'CAD',
    createdAt: frozen.capturedAt,
    rows: rows.map((row) => ({
      ...row,
      subscriptionRevenue: row.revenue,
      cogs: '0',
      expenses: '0',
      credit: '0',
      netIncome: row.operatingIncome,
      raw: {},
    })),
  });
  const peer = peerRecordSchema.parse({
    id: '853058fd-0735-4dbe-87ed-7de41c0eec42',
    peerId: '853058fd-0735-4dbe-87ed-7de41c0eec43',
    version: 1,
    archived: false,
    recordedAt: frozen.capturedAt,
    name: 'Selected peer',
    stage: 'Seed',
    customer: 'Retail',
    businessModel: 'Subscription',
    rationale: 'Selected example',
    currency: 'CAD',
    sourceUrl: 'https://example.com/statement',
    excerpt: 'Unverified example statement',
    publishedAt: null,
    fictional: false,
    periods: rows.map((row) => ({
      month: row.month,
      revenue: row.revenue,
      grossProfit: '50',
      operatingIncome: '-30',
    })),
  });
  frozen.peerComparison = buildPeerComparison(snapshot, [peer], 1, frozen.capturedAt);
  return frozen;
}
describe('independent evaluation workflows', () => {
  it('compares selected investor observations and keeps missing criteria unknown', () => {
    const frozen = context();
    const result = runInvestorEvaluation(frozen);
    expect(result.criteria.map((item) => item.outcome)).toEqual(['aligned', 'aligned', 'aligned']);
    expect(result.status).toBe('limited');
    frozen.investorAssessment = {
      company: { stage: null, sector: null, geography: null },
      observations: [],
    };
    expect(runInvestorEvaluation(frozen).criteria.every((item) => item.outcome === 'unknown')).toBe(
      true,
    );
    expect(runInvestorEvaluation(frozen).status).toBe('unavailable');
  });
  it('distinguishes conflicting research from a consistent label gap', () => {
    const frozen = context();
    const source = frozen.sources.at(-1);
    if (!source) throw new Error('Missing fictional source');
    frozen.sources.push({
      ...source,
      id: 'investor:other',
      kind: 'investor',
      title: 'Other fictional source',
      text: 'A different fictional historical deal.',
    });
    frozen.investorAssessment?.observations.push({
      sourceId: 'investor:other',
      stage: 'Series A',
      sector: 'hardware',
      geography: 'US',
    });
    expect(runInvestorEvaluation(frozen).criteria[0]?.outcome).toBe('conflicting');
    if (frozen.investorAssessment) frozen.investorAssessment.company.stage = 'Series B';
    expect(runInvestorEvaluation(frozen).criteria[0]?.outcome).toBe('gap');
  });
  it('does not attribute unavailable sources or assess an unselected investor', () => {
    const frozen = context();
    frozen.sources = [];
    expect(runInvestorEvaluation(frozen).status).toBe('unavailable');
    const noInvestor = context();
    noInvestor.investorId = null;
    expect(
      runInvestorEvaluation(noInvestor).criteria.every((item) => !item.observations.length),
    ).toBe(true);
    const old = context();
    delete old.investorAssessment;
    expect(runInvestorEvaluation(old).status).toBe('unavailable');
  });
  it('compares every saved metric without needing a transcript claim', () => {
    const result = runPeerEvaluation(peerContext());
    expect(result.comparison?.metrics).toHaveLength(3);
    expect(result.comparison?.metrics[0]?.value).toBe('20.00000000');
    expect(result.limitations.some((item) => item.includes('fewer than three'))).toBe(true);
    expect(runPeerEvaluation(context()).status).toBe('unavailable');
  });
  it('resumes completed children after coaching failure without repeating extraction', async () => {
    const data = input();
    const frozen = context();
    const extract = vi.fn((...args: Parameters<typeof fixtureEvaluationProvider.extract>) =>
      fixtureEvaluationProvider.extract(...args),
    );
    const coach = vi
      .fn((...args: Parameters<typeof fixtureEvaluationProvider.coach>) =>
        fixtureEvaluationProvider.coach(...args),
      )
      .mockRejectedValueOnce(new Error('Temporary coaching failure'));
    let saved: EvaluationProgress | undefined;
    const checkpoint = (progress: EvaluationProgress) => {
      saved = structuredClone(progress);
      return Promise.resolve();
    };
    await expect(
      runEvaluationWorkflows(
        { model: 'test-fixture', extract, coach },
        data,
        frozen,
        saved,
        checkpoint,
      ),
    ).rejects.toThrow();
    expect(saved?.extraction).toBeDefined();
    expect(saved?.peer).toBeDefined();
    expect(saved?.investor?.investorId).toBe('selected-investor');
    expect(saved?.answer).toBeUndefined();
    const report = await runEvaluationWorkflows(
      { model: 'test-fixture', extract, coach },
      data,
      frozen,
      saved,
      checkpoint,
    );
    expect(report.workflows?.investor.criteria[0]?.outcome).toBe('aligned');
    expect(extract).toHaveBeenCalledTimes(1);
    expect(coach).toHaveBeenCalledTimes(2);
    await runEvaluationWorkflows(
      { model: 'test-fixture', extract, coach },
      data,
      frozen,
      saved,
      checkpoint,
    );
    expect(coach).toHaveBeenCalledTimes(2);
  });
  it('joins peer context to the same answer without inventing an investor connection', async () => {
    const report = await runEvaluationWorkflows(
      fixtureEvaluationProvider,
      input(),
      peerContext(),
      undefined,
      async () => {},
    );
    const action = report.workflows?.synthesis.actions[0];
    expect(action?.peerMetrics).toEqual(['operating_margin']);
    expect(action?.investorSourceIds).toEqual([]);
    expect(action?.claimId).toBe(report.coaching.items[0]?.claimId);
  });
  it('does not proceed after a rejected checkpoint', async () => {
    const coach = vi.fn((...args: Parameters<typeof fixtureEvaluationProvider.coach>) =>
      fixtureEvaluationProvider.coach(...args),
    );
    await expect(
      runEvaluationWorkflows(
        { ...fixtureEvaluationProvider, coach },
        input(),
        context(),
        undefined,
        () => Promise.reject(new Error('Lease expired')),
      ),
    ).rejects.toThrow('Lease expired');
    expect(coach).not.toHaveBeenCalled();
  });
  it('renders saved business comparisons even when no answer references a metric', async () => {
    const data = input();
    data.turns = [{ id: 'answer', role: 'user', text: 'We sell to retailers.' }];
    const report = await runEvaluationWorkflows(
      fixtureEvaluationProvider,
      data,
      peerContext(),
      undefined,
      async () => {},
    );
    expect(report.peerInsights).toEqual([]);
    const markup = renderToStaticMarkup(<EvaluationWorkflows report={report} />);
    expect(markup).toContain('Your business versus selected peers');
    expect(markup).toContain('Revenue growth');
    expect(markup).toContain('Fictional Seed Fund');
    expect(markup).toContain('Fictional demo');
    expect(markup).toContain('unassessed');
    delete report.workflows;
    expect(renderToStaticMarkup(<EvaluationWorkflows report={report} />)).toBe('');
  });
});
