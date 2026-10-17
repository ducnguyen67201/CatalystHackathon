import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { followupsResponseSchema } from '../src/contracts/Followups.js';
import { radarEventSchema, type RadarEvent } from '../src/contracts/RadarDelivery.js';
import { rehearsalSchema, workspaceSchema, type Job } from '../src/contracts/Workspace.js';
import { projectFollowups } from '../src/features/Followups.js';
import { evidenceFixture } from './EvidenceReviewFixtures.js';
import { radarEvidence } from './fixtures/RadarFixture.js';
import { assembleScenarioInput } from '../src/features/ScenarioSources.js';
import { DemoScenarioGenerator } from '../src/infrastructure/ScenarioGeneration.js';
import { practiceContextSchema } from '../src/contracts/PracticeContext.js';

function fixture() {
  const { context, evaluation } = evidenceFixture();
  const investorId = randomUUID();
  context.investorId = investorId;
  context.investorName = 'Fictional Northline';
  const session = rehearsalSchema.parse({
    id: randomUUID(),
    briefId: null,
    mode: 'text',
    status: 'completed',
    createdAt: context.capturedAt,
    conversationId: null,
    turns: evaluation.turns.map(({ role, text }) => ({ role, text })),
    review: null,
    evaluationContext: context,
    evaluations: [evaluation],
  });
  const state = workspaceSchema.parse({
    id: 'test',
    revision: 1,
    profile: {
      name: 'Fictional Tidewell',
      version: 1,
      stage: 'Seed',
      sector: '',
      geography: '',
      currency: 'unspecified',
      raiseTarget: null,
      goal: 'Explain profitability',
      watchlist: [],
    },
    schedule: { frequency: 'paused', timezone: 'UTC', nextAt: null, lastAt: null },
    snapshots: [],
    evidence: [],
    briefs: [],
    rehearsals: [],
    milestones: [],
    notices: [],
    investors: [
      {
        id: investorId,
        key: 'fictional',
        name: 'Fictional Northline',
        url: 'https://example.com/team',
        origin: 'added',
        discoveryEvidenceId: null,
        createdAt: context.capturedAt,
        frequency: 'paused',
        nextAt: null,
        checks: [],
      },
    ],
  });
  state.rehearsals.push(session);
  function event(overrides: Partial<RadarEvent> = {}) {
    const evidence = radarEvidence();
    evidence.mode = 'demo';
    state.evidence.push(evidence);
    const result = radarEventSchema.parse({
      id: randomUUID(),
      resultId: evidence.id,
      dedupeKey: randomUUID(),
      researchRunId: null,
      jobId: null,
      investorId,
      suggestionId: null,
      investorName: 'Fictional Northline',
      profileVersion: 1,
      signal: evidence.signal,
      evidenceId: evidence.id,
      occurredAt: '2026-09-01',
      observedAt: '2026-10-17T13:00:00.000Z',
      committedAt: '2026-10-17T13:00:00.000Z',
      readAt: null,
      dismissedAt: null,
      supersedesEventId: null,
      historical: false,
      fictional: true,
      ...overrides,
    });
    state.radar.events.push(result);
    return result;
  }
  const jobs: Job[] = [];
  const project = () => followupsResponseSchema.parse(projectFollowups(state, jobs));
  const savedEvaluation = session.evaluations[0];
  if (!savedEvaluation) throw new Error('Missing fixture evaluation');
  return { state, session, evaluation: savedEvaluation, investorId, event, project, jobs };
}

describe('transcript and scenario follow-ups', () => {
  it('projects persisted coaching with its quote, exact figures, evidence and success criteria without writes', () => {
    const { state, project } = fixture();
    const before = JSON.stringify(state);
    const first = project().sessions[0];
    expect(first?.fictional).toBe(true);
    expect(first?.tasks[0]).toMatchObject({
      title: 'Explain the credit separately.',
      quote: 'We made CAD 12000 in operating profit.',
      steps: ['Explain the credit separately.'],
      missingInputs: ['Cash-flow data for runway'],
      status: 'open',
      successCriteria: ['Separate operations from the credit.'],
    });
    expect(first?.tasks[0]?.facts[0]?.value).toBe('-18000');
    expect(first?.tasks[0]?.sources[0]?.title).toContain('Fictional.csv');
    expect(project().sessions[0]?.tasks).toEqual(first?.tasks);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('includes only new, current, unsuperseded research for this investor and preserves unknown publication dates', () => {
    const { event, project, state, session } = fixture();
    event({ investorId: randomUUID() });
    event({ historical: true });
    event({ profileVersion: 2 });
    event({ dismissedAt: '2026-10-17T14:00:00.000Z' });
    event({ observedAt: '2026-10-16T00:00:00.000Z' });
    event({ evidenceId: 'unavailable' });
    const old = event();
    const current = event({ supersedesEventId: old.id, occurredAt: null });
    const frozen = event();
    session.evaluationContext?.sources.push({
      id: `investor:${frozen.evidenceId}`,
      kind: 'investor',
      title: 'Already included',
      text: 'Fictional source',
      url: null,
      recordedAt: null,
      origin: 'fictional',
    });
    const before = JSON.stringify(state);
    const updates = project().sessions[0]?.investorUpdates;
    expect(updates).toHaveLength(1);
    expect(updates?.[0]).toMatchObject({ id: current.id, occurredAt: null, fictional: true });
    expect(updates?.[0]?.steps.join(' ')).toContain('do not assume');
    expect(JSON.stringify(state)).toBe(before);
    if (session.evaluationContext) session.evaluationContext.investorId = null;
    expect(project().sessions[0]?.investorUpdates).toEqual([]);
  });

  it('compares research freshness to scenario capture, not the later call, and caps updates transparently', async () => {
    const { state, session, investorId, event, project } = fixture();
    const input = assembleScenarioInput(state, investorId, 'Explain profitability');
    input.capturedAt = '2026-10-16T00:00:00.000Z';
    const output = await new DemoScenarioGenerator().generate(input);
    session.context = practiceContextSchema.parse({
      version: 2,
      mode: 'provided',
      company: null,
      financials: null,
      meetingNotes: [],
      investor: null,
      scenario: output.scenarios[0],
      selection: { generationId: randomUUID(), scenarioId: output.scenarios[0]?.id },
      input,
      investorProfile: output.investorProfile,
      generationMode: 'demo',
      instruction: 'Fictional practice',
    });
    for (let i = 0; i < 5; i++) event({ observedAt: '2026-10-16T13:00:00.000Z' });
    const result = project().sessions[0];
    expect(result?.investorUpdates).toHaveLength(3);
    expect(result?.additionalUpdates).toBe(2);
    expect(result?.contextAt).toBe(input.capturedAt);
    if (session.context.version !== 2) throw new Error('Expected scenario context');
    expect(result?.selection).toEqual(session.context.selection);
  });

  it('does not create tasks for pending or failed evaluations, and does not confuse skipped reviews with success', () => {
    const { session, evaluation, project, jobs } = fixture();
    evaluation.status = 'queued';
    evaluation.report = null;
    expect(project().sessions[0]).toMatchObject({ reviewStatus: 'queued', tasks: [] });
    jobs.push({
      id: 'job',
      kind: `evaluate:${session.id}:${evaluation.id}`,
      status: 'failed',
      attempts: 3,
      createdAt: session.createdAt,
      error: 'failed',
      result: null,
    });
    expect(project().sessions[0]?.reviewStatus).toBe('failed');
    evaluation.status = 'skipped';
    expect(project().sessions[0]?.reviewStatus).toBe('skipped');
    session.evaluations = [];
    session.status = 'awaiting_transcript';
    expect(project().sessions[0]?.reviewStatus).toBe('awaiting_transcript');
  });

  it('tracks retries and dismissal without duplicate tasks or treating submission as improvement', () => {
    const { state, session, evaluation, project, jobs } = fixture();
    const retry = structuredClone(session);
    retry.id = randomUUID();
    retry.evaluations = [structuredClone(evaluation)];
    const next = retry.evaluations[0];
    if (!next) throw new Error('Missing fixture evaluation');
    next.id = randomUUID();
    next.parentEvaluationId = evaluation.id;
    next.parentItemId = 'profit-coaching';
    next.status = 'queued';
    state.rehearsals.push(retry);
    session.evaluationResponses.push({
      id: retry.id,
      evaluationId: evaluation.id,
      itemId: 'profit-coaching',
      kind: 'practice',
      text: 'Fictional retry',
      createdAt: session.createdAt,
      requestKey: randomUUID(),
    });
    expect(project().sessions).toHaveLength(1);
    expect(project().sessions[0]?.tasks[0]?.status).toBe('pending');
    jobs.push({
      id: 'job',
      kind: `evaluate:${retry.id}:${next.id}`,
      status: 'failed',
      attempts: 3,
      createdAt: session.createdAt,
      error: 'failed',
      result: null,
    });
    expect(project().sessions[0]?.tasks[0]?.status).toBe('review_failed');
    next.status = 'completed';
    if (!next.report) throw new Error('Missing fixture report');
    next.report.coaching.comparison = {
      outcome: 'needs_evidence',
      explanation: 'Still missing cash evidence.',
      turnIds: [],
    };
    expect(project().sessions[0]?.tasks[0]?.status).toBe('needs_evidence');
    next.report.coaching.comparison.outcome = 'improved';
    expect(project().sessions[0]?.tasks[0]?.status).toBe('improved');
    // A later clarification about another retry finding cannot change this task's comparison.
    const unrelated = structuredClone(next);
    unrelated.id = randomUUID();
    unrelated.parentEvaluationId = next.id;
    unrelated.status = 'queued';
    retry.evaluations.push(unrelated);
    expect(project().sessions[0]?.tasks[0]?.status).toBe('improved');
    session.evaluationResponses.push({
      id: randomUUID(),
      evaluationId: evaluation.id,
      itemId: 'profit-coaching',
      kind: 'dismissed',
      text: '',
      createdAt: session.createdAt,
      requestKey: randomUUID(),
    });
    expect(project().sessions[0]?.tasks[0]).toMatchObject({
      status: 'dismissed',
      retrySessionId: retry.id,
    });
    expect(evaluation.report?.coaching.comparison).toBeNull();
  });

  it('pages practice history and omits active conversations', () => {
    const { state, session } = fixture();
    for (let i = 0; i < 12; i++)
      state.rehearsals.push({ ...structuredClone(session), id: randomUUID() });
    state.rehearsals.push({ ...structuredClone(session), id: randomUUID(), status: 'active' });
    const first = followupsResponseSchema.parse(projectFollowups(state, [], 0, 10));
    const second = followupsResponseSchema.parse(projectFollowups(state, [], 10, 10));
    expect(first.sessions).toHaveLength(10);
    expect(first.nextOffset).toBe(10);
    expect(second.sessions).toHaveLength(3);
    expect(second.nextOffset).toBeNull();
    expect(new Set([...first.sessions, ...second.sessions].map((s) => s.id)).size).toBe(13);
  });
});
