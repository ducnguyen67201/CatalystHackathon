import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  peerInputSchema,
  peerRecordSchema,
  type PeerRecord,
} from '../src/contracts/PeerComparison.js';
import { snapshotSchema, workspaceSchema, rehearsalSchema } from '../src/contracts/Workspace.js';
import {
  evaluationContextSchema,
  withoutPeerComparison,
} from '../src/contracts/RehearsalEvaluation.js';
import { buildPeerComparison, currentPeers } from '../src/features/PeerComparison.js';
import { buildPeerInsights } from '../src/features/PeerInsights.js';
import { assembleEvaluationContext } from '../src/features/EvaluationContextAssembler.js';
import { scenarioInputHash } from '../src/features/ScenarioSources.js';
import { scenarioInputSchema } from '../src/contracts/Scenario.js';
import { ComparisonChart, RevenueTrend } from '../src/web/PeerCharts.js';
import { PitchPreparationReport } from '../src/web/PitchPreparationReport.js';
import {
  interviewerContext,
  practiceContextSchema,
  createEmptyPracticeContext,
} from '../src/contracts/PracticeContext.js';
import { hashEvaluationInput } from '../src/features/RehearsalEvaluationService.js';
import { DemoScenarioGenerator } from '../src/infrastructure/ScenarioGeneration.js';
import { evidenceFixture } from './EvidenceReviewFixtures.js';

function snapshot() {
  return snapshotSchema.parse({
    id: 'financials',
    hash: 'real-upload',
    fileName: 'Statement.csv',
    currency: 'CAD',
    createdAt: '2026-10-16T12:00:00Z',
    rows: [
      { month: '2026-08', revenue: '100', grossProfit: '60', operatingIncome: '-20', sourceRow: 2 },
      { month: '2026-09', revenue: '120', grossProfit: '84', operatingIncome: '-12', sourceRow: 3 },
    ].map((row) => ({
      ...row,
      subscriptionRevenue: row.revenue,
      cogs: '0',
      expenses: '0',
      credit: '0',
      netIncome: row.operatingIncome,
      raw: {},
    })),
  });
}
function peer(): PeerRecord {
  return peerRecordSchema.parse({
    id: randomUUID(),
    peerId: randomUUID(),
    version: 1,
    recordedAt: '2026-10-16T10:00:00Z',
    archived: false,
    name: 'Comparable',
    stage: 'Seed',
    customer: 'Retailers',
    businessModel: 'Subscription',
    rationale: 'Same customer and workflow',
    currency: 'CAD',
    sourceUrl: 'https://example.com/disclosure',
    excerpt: 'Source-reported monthly statement figures.',
    publishedAt: '2026-10-15',
    fictional: false,
    periods: [
      { month: '2026-08', revenue: '100', grossProfit: '50', operatingIncome: '-40' },
      { month: '2026-09', revenue: '110', grossProfit: '66', operatingIncome: '-22' },
    ],
  });
}
function comparison(peers = [peer()]) {
  return buildPeerComparison(snapshot(), peers, 1, '2026-10-17T12:00:00Z');
}
function workspace(peers = [peer()]) {
  const financials = snapshot();
  return workspaceSchema.parse({
    id: 'test',
    revision: 0,
    profile: {
      name: 'Company',
      version: 1,
      stage: 'Seed',
      sector: 'software',
      geography: '',
      raiseTarget: null,
      currency: 'CAD',
      goal: '',
      watchlist: [],
    },
    onboarding: { snapshotId: financials.id },
    schedule: { frequency: 'paused', timezone: 'UTC', nextAt: null, lastAt: null },
    snapshots: [financials],
    peers,
    evidence: [],
    briefs: [],
    rehearsals: [],
    milestones: [],
    notices: [],
  });
}

describe('peer evidence and comparisons', () => {
  it('calculates growth and signed margins with exact decimal values and CSV provenance', () => {
    const metrics = comparison().metrics;
    expect(metrics.map((item) => item.value)).toEqual([
      '20.00000000',
      '70.00000000',
      '-10.00000000',
    ]);
    expect(metrics.map((item) => item.position)).toEqual(['above', 'above', 'above']);
    expect(metrics[2]?.low).toBe('-20.00000000');
    expect(metrics[2]?.companySource.rows[0]?.sourceRow).toBe(3);
    expect(metrics[0]?.startMonth).toBe('2026-08');
    expect(metrics[1]?.startMonth).toBe('2026-09');
  });
  it('rounds derived percentages to eight decimal places without rounding source amounts', () => {
    const financials = snapshot();
    const first = financials.rows[0];
    const last = financials.rows[1];
    if (!first || !last) throw Error('Missing fixture');
    first.revenue = '3.0001';
    last.revenue = '4.0001';
    expect(buildPeerComparison(financials, [], 1).metrics[0]?.value).toBe('33.33222226');
    expect(first.revenue).toBe('3.0001');
  });
  it('excludes incompatible currencies, periods and fictional origins with visible reasons', () => {
    const currency = { ...peer(), currency: 'USD' as const };
    const period = { ...peer(), periods: [] };
    const fictional = { ...peer(), fictional: true };
    const metric = comparison([currency, period, fictional]).metrics[0];
    expect(metric?.position).toBe('unavailable');
    expect(metric?.excluded.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('currencies'),
        expect.stringContaining('monthly'),
        expect.stringContaining('Fictional'),
      ]),
    );
  });
  it('does not invent a previous month or divide by nonpositive revenue', () => {
    const financials = snapshot();
    financials.rows.splice(0, 1);
    expect(buildPeerComparison(financials, [], 1).metrics[0]?.value).toBeNull();
    const last = financials.rows[0];
    if (!last) throw Error('Missing row');
    last.revenue = '0';
    expect(
      buildPeerComparison(financials, [], 1).metrics.every((metric) => metric.value === null),
    ).toBe(true);
    last.revenue = '-1';
    expect(
      buildPeerComparison(financials, [], 1).metrics.every((metric) => metric.value === null),
    ).toBe(true);
  });
  it('uses calendar-month boundaries across years and sorts observations chronologically', () => {
    const financials = snapshot();
    const first = financials.rows[0];
    const last = financials.rows[1];
    if (!first || !last) throw Error('Missing fixture');
    first.month = '2025-12';
    last.month = '2026-01';
    financials.rows.reverse();
    expect(buildPeerComparison(financials, [], 1).metrics[0]?.value).toBe('20.00000000');
    expect(buildPeerComparison(financials, [], 1).metrics[0]?.startMonth).toBe('2025-12');
  });
  it('selects the latest version and archives without discarding earlier evidence', () => {
    const original = peer();
    const updated = { ...original, id: randomUUID(), version: 2, name: 'Updated' };
    const archived = { ...updated, id: randomUUID(), version: 3, archived: true };
    expect(currentPeers([updated, original])[0]?.name).toBe('Updated');
    expect(currentPeers([archived, original, updated])).toEqual([]);
    expect(original.archived).toBe(false);
  });
  it('validates duplicate months, malformed amounts and unsafe source schemes', () => {
    const input = (({
      id: _id,
      version: _version,
      recordedAt: _recorded,
      archived: _archived,
      ...value
    }: PeerRecord) => value)(peer());
    expect(peerInputSchema.safeParse({ ...input, expectedVersion: 0 }).success).toBe(true);
    expect(
      peerInputSchema.safeParse({ ...input, expectedVersion: 0, sourceUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
    expect(
      peerInputSchema.safeParse({
        ...input,
        expectedVersion: 0,
        periods: [input.periods[0], input.periods[0]],
      }).success,
    ).toBe(false);
    expect(
      peerInputSchema.safeParse({
        ...input,
        expectedVersion: 0,
        periods: [{ ...input.periods[0], revenue: 'NaN' }],
      }).success,
    ).toBe(false);
  });
  it('keeps a zero-width single-peer range and explicitly labels the sample size', () => {
    const metric = comparison().metrics[2];
    if (!metric) throw Error('Missing metric');
    const html = renderToStaticMarkup(<ComparisonChart comparison={metric} />);
    expect(html).toContain('1 selected peers');
    expect(html).toContain('width="2"');
    expect(html).toContain('-20%');
    expect(html).toContain('not a market benchmark');
    expect(html).toContain('CSV row 3');
  });
});

describe('frozen after-call peer insights', () => {
  it('links only relevant actual claims from the matching period, excluding superseded claims', () => {
    const { evaluation } = evidenceFixture();
    const extraction = evaluation.report?.extraction;
    if (!extraction) throw Error('Missing extraction');
    const insights = buildPeerInsights(comparison(), extraction);
    expect(insights.map((item) => item.comparison.metric)).toEqual([
      'revenue_growth',
      'operating_margin',
    ]);
    expect(insights[0]?.turnId).toBe('answer');
    expect(
      buildPeerInsights(comparison(), {
        claims: extraction.claims.map((claim) => ({ ...claim, kind: 'forecast' })),
        focusAreas: [],
      }),
    ).toEqual([]);
    expect(
      buildPeerInsights(comparison(), {
        claims: extraction.claims.map((claim) => ({ ...claim, period: '2025-01' })),
        focusAreas: [],
      }),
    ).toEqual([]);
    expect(
      buildPeerInsights(comparison(), {
        claims: extraction.claims.map((claim) => ({ ...claim, supersededByTurnId: 'later' })),
        focusAreas: [],
      }),
    ).toEqual([]);
    expect(buildPeerInsights(comparison([]), extraction)).toEqual([]);
  });
  it('captures independent evidence without changing historical context hashes', () => {
    const state = workspace();
    const context = assembleEvaluationContext(state, createEmptyPracticeContext());
    const before = JSON.stringify(context.peerComparison);
    state.peers = [{ ...peer(), archived: true }];
    state.snapshots[0]?.rows.splice(0, 2);
    expect(JSON.stringify(context.peerComparison)).toBe(before);
    const legacy = evaluationContextSchema
      .omit({ peerComparison: true })
      .parse(evidenceFixture().context);
    const hash = hashEvaluationInput(legacy);
    expect(evaluationContextSchema.parse(legacy).peerComparison).toBeUndefined();
    expect(hashEvaluationInput(evaluationContextSchema.parse(legacy))).toBe(hash);
    expect(withoutPeerComparison(context).peerComparison).toBeUndefined();
  });
  it('preserves frozen scenario peer context and does not attach current peers to old scenarios', async () => {
    const frozen = comparison();
    const input = scenarioInputSchema.parse({
      schemaVersion: 1,
      capturedAt: frozen.capturedAt,
      investor: { id: randomUUID(), name: 'Investor', url: null, profileLinks: [] },
      objective: '',
      sources: [
        {
          id: 'founder:1',
          schemaVersion: 1,
          kind: 'founder_initial',
          capturedAt: frozen.capturedAt,
          provenance: 'founder_provided',
          profileVersion: 1,
          meetingRevision: null,
          company: {
            name: 'Frozen',
            stage: null,
            sector: null,
            geography: null,
            raiseTarget: null,
            currency: 'CAD',
            goal: '',
          },
          meetingNotes: null,
        },
      ],
      coverage: [],
      omittedEvidenceIds: [],
      peerComparison: frozen,
    });
    const oldInput = { ...input };
    delete oldInput.peerComparison;
    const state = workspace();
    const legacy = createEmptyPracticeContext();
    expect(legacy.version).toBe(1);
    const changedTime = {
      ...input,
      capturedAt: '2026-10-18T12:00:00Z',
      peerComparison: { ...frozen, capturedAt: '2026-10-18T12:00:00Z' },
      sources: input.sources.map((source) => ({ ...source, capturedAt: '2026-10-18T12:00:00Z' })),
    };
    expect(scenarioInputHash(input)).toBe(scenarioInputHash(changedTime));
    expect(scenarioInputHash(input)).not.toBe(scenarioInputHash(oldInput));
    const output = await new DemoScenarioGenerator().generate(input);
    const scenario = output.scenarios[0];
    const practice = practiceContextSchema.parse({
      ...legacy,
      version: 2,
      mode: 'provided',
      selection: { generationId: randomUUID(), scenarioId: scenario?.id },
      scenario,
      input,
      investorProfile: output.investorProfile,
      generationMode: 'demo',
      instruction: '',
    });
    expect(interviewerContext(practice).version).toBe(2);
    expect(JSON.stringify(interviewerContext(practice))).not.toContain('peerComparison');
    state.peers = [];
    expect(assembleEvaluationContext(state, practice).peerComparison).toEqual(frozen);
    const oldPractice = practiceContextSchema.parse({ ...practice, input: oldInput });
    expect(assembleEvaluationContext(state, oldPractice).peerComparison).toBeUndefined();
  });
  it('renders saved insights and sources while leaving historical reports unchanged', () => {
    const { evaluation } = evidenceFixture();
    if (!evaluation.report) throw Error('Missing report');
    const before = JSON.stringify(evaluation);
    const historical = renderToStaticMarkup(
      <PitchPreparationReport evaluation={evaluation} fictional={false} />,
    );
    expect(historical).not.toContain('Peer context for your answers');
    expect(JSON.stringify(evaluation)).toBe(before);
    evaluation.report.peerInsights = buildPeerInsights(comparison(), evaluation.report.extraction);
    const html = renderToStaticMarkup(
      <PitchPreparationReport evaluation={evaluation} fictional={false} />,
    );
    expect(html).toContain('Peer context for your answers');
    expect(html).toContain('Source ↗');
    expect(html).toContain('We made CAD 12000');
    const trend = renderToStaticMarkup(<RevenueTrend comparison={comparison()} />);
    expect(trend).toContain('Points are saved observations');
    expect(trend).toContain('Statement.csv');
  });
  it('keeps pre-feature rehearsals readable without inventing peer snapshots', () => {
    const session = rehearsalSchema.parse({
      id: 'old',
      briefId: null,
      mode: 'text',
      status: 'completed',
      createdAt: '2026-10-17T12:00:00Z',
      conversationId: null,
      turns: [],
      review: null,
    });
    expect(session.evaluationContext).toBeNull();
    expect(session.evaluations).toEqual([]);
  });
});
