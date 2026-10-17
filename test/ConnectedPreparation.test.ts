import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { fixtureEvaluationProvider } from './EvaluationFixtures.js';
import { ResearchFixture } from './fixtures/ResearchFixture.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import { ConflictError, type WorkspaceStore } from '../src/features/WorkspaceStore.js';
import { workspaceSchema, rehearsalSchema, type Job } from '../src/contracts/Workspace.js';
import { preparationGoalInputSchema } from '../src/contracts/FundraisingPreparation.js';
import { trackedInvestorSchema } from '../src/contracts/InvestorTracking.js';
import {
  connectedPreparationViewSchema,
  type ConnectedPreparationCommand,
} from '../src/contracts/ConnectedPreparation.js';
import {
  preparationRecommendations,
  preparedPitchContext,
  connectedHash,
} from '../src/features/ConnectedPreparation.js';
import { assembleScenarioInput, scenarioInputHash } from '../src/features/ScenarioSources.js';
import { DemoScenarioGenerator } from '../src/infrastructure/ScenarioGeneration.js';
import { practiceContextSchema } from '../src/contracts/PracticeContext.js';
import { InvestorPreparationRecommendations } from '../src/web/ConnectedPreparation.js';
import { projectPreparationPlan } from '../src/features/PreparationPlanner.js';
import { projectSchedule } from '../src/web/PreparationScheduleModel.js';

type Action<T> = T extends object ? Omit<T, 'version' | 'key'> : never;
function fixture() {
  let state = preparationFixture().state;
  state.rehearsals = [];
  state.profile.stage = 'Seed';
  state.profile.sector = 'Software';
  state.profile.geography = 'Canada';
  const jobs: Job[] = [];
  const investorId = randomUUID();
  state.investors.push(
    trackedInvestorSchema.parse({
      id: investorId,
      key: 'fixture-investor',
      name: 'Fictional seed investor',
      url: 'https://example.com',
      origin: 'added',
      discoveryEvidenceId: 'loop-source',
      createdAt: new Date().toISOString(),
      frequency: 'paused',
      nextAt: null,
      checks: [],
    }),
  );
  state.evidence.push({
    id: 'loop-source',
    eventKey: 'loop-source',
    mode: 'demo',
    investor: 'Fictional seed investor',
    title: 'Fictional historical observation',
    url: 'https://example.com/source',
    excerpt: 'Fictional source: Seed software company in Canada.',
    publishedAt: null,
    discoveredAt: new Date().toISOString(),
    stage: 'Seed',
    sector: 'Software',
    geography: 'Canada',
    checkMin: null,
    checkMax: null,
    currency: 'unspecified',
    explanation: 'Fictional test evidence',
    verified: false,
  });
  const save = vi.fn<WorkspaceStore['save']>((next, expected) => {
    if (state.revision !== expected) return Promise.reject(new ConflictError());
    state = workspaceSchema.parse({ ...structuredClone(next), revision: expected + 1 });
    return Promise.resolve();
  });
  const store: WorkspaceStore = {
    load: () => Promise.resolve(structuredClone(state)),
    save,
    initialize: () => Promise.resolve(),
    enqueue: () => Promise.reject(new Error('Unexpected remote workflow')),
    listJobs: () => Promise.resolve(jobs),
    claimJob: () => Promise.resolve(null),
    finishJob: () => Promise.resolve(),
    failJob: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const service = new WorkspaceService(store, new ResearchFixture(), fixtureEvaluationProvider);
  const act = async (input: Action<ConnectedPreparationCommand>) =>
    service.connected.command({
      ...input,
      version: (await service.connected.view()).version,
      key: randomUUID(),
    });
  const start = async () => {
    await service.preparation.confirmGoal(
      preparationGoalInputSchema.parse({
        round: 'Seed',
        previousRounds: 1,
        amount: null,
        currency: 'CAD',
        targetDate: null,
        timezone: 'UTC',
        investorId: null,
      }),
      0,
      true,
    );
    await act({ action: 'start' });
  };
  const throughBrief = async () => {
    await start();
    await act({ action: 'approve_pitch' });
    await act({ action: 'select_investor', investorId });
    await act({ action: 'approve_brief' });
  };
  const addReview = async (hasGaps = true, partial = false) => {
    const cycle = state.preparation?.connected?.cycles.at(-1);
    if (!cycle) throw new Error('Missing cycle');
    const input = assembleScenarioInput(state, investorId, 'Explain the approved story', cycle.id);
    const output = await new DemoScenarioGenerator().generate(input);
    const scenario = output.scenarios[0];
    if (!scenario) throw new Error('Missing scenario');
    const context = practiceContextSchema.parse({
      version: 2,
      mode: 'provided',
      company: null,
      financials: null,
      meetingNotes: [],
      investor: null,
      scenario,
      selection: { generationId: randomUUID(), scenarioId: scenario.id },
      input,
      investorProfile: output.investorProfile,
      generationMode: 'demo',
      instruction: 'Fictional practice',
    });
    const evaluation = structuredClone(preparationFixture().evaluation);
    evaluation.id = randomUUID();
    evaluation.status = 'completed';
    evaluation.scope = partial ? 'partial' : 'complete';
    if (!evaluation.report) throw new Error('Missing report');
    if (!hasGaps) {
      evaluation.report.coaching.items = [];
      evaluation.report.checks = [];
    }
    const session = rehearsalSchema.parse({
      id: randomUUID(),
      briefId: null,
      mode: 'text',
      status: partial ? 'partial' : 'completed',
      createdAt: new Date().toISOString(),
      conversationId: null,
      turns: [
        { role: 'agent', text: 'Explain the result.' },
        { role: 'user', text: 'Fictional saved answer.' },
      ],
      context,
      evaluationContext: preparationFixture().session.evaluationContext,
      evaluations: [evaluation],
      review: null,
    });
    await service.change((current) => {
      current.rehearsals.push(session);
    });
    return { session, evaluation };
  };
  return {
    service,
    state: () => state,
    save,
    act,
    start,
    throughBrief,
    addReview,
    investorId,
    jobs,
  };
}
describe('Connected six-step preparation', () => {
  it('feeds checklist approvals and feedback into the timeline without losing earlier cycles', async () => {
    const f = fixture();
    await f.throughBrief();
    const project = () => projectPreparationPlan(f.state(), f.jobs, null);
    const today = new Date('2026-10-17T18:00:00Z');
    expect(projectSchedule(project(), 1, today).finish).toBe('2026-10-19');
    expect(
      project()
        .milestones.slice(0, 4)
        .every((item) => item.status === 'complete'),
    ).toBe(true);
    expect(project().milestones[4]).toMatchObject({
      status: 'available',
      preparationStep: 'practice',
    });
    const { session, evaluation } = await f.addReview(false);
    expect(project().milestones[4]).toMatchObject({
      status: 'needs_review',
      preparationStep: 'feedback',
    });
    await f.act({ action: 'review_feedback', sessionId: session.id, evaluationId: evaluation.id });
    expect(project().milestones[4]?.preparationStep).toBe('revision');
    await f.act({ action: 'finish_cycle' });
    expect(project().milestones.every((item) => item.status === 'complete')).toBe(true);
    expect(projectSchedule(project(), 1, today)).toMatchObject({
      finish: '2026-10-17',
      tone: 'complete',
    });
    const completed = structuredClone((await f.service.connected.view()).cycle);
    await f.act({ action: 'repeat' });
    expect(project().milestones[2]?.status).toBe('complete');
    expect(project().milestones[3]?.status).toBe('needs_review');
    expect(projectSchedule(project(), 1, today).finish).toBe('2026-10-20');
    expect(projectSchedule(project(), 0.75, today).finish).toBe('2026-10-21');
    expect(projectSchedule(project(), 1.25, today).finish).toBe('2026-10-20');
    expect((await f.service.connected.view()).history[1]).toEqual(completed);
  });
  it('keeps reads side-effect free and blocks downstream steps until exact approvals', async () => {
    const f = fixture();
    await f.start();
    const before = structuredClone(f.state());
    const calls = f.save.mock.calls.length;
    const view = connectedPreparationViewSchema.parse(await f.service.connected.view());
    expect(view.steps.map((s) => s.status)).toEqual([
      'needs_review',
      'blocked',
      'blocked',
      'blocked',
      'blocked',
      'blocked',
    ]);
    expect(f.state()).toEqual(before);
    expect(f.save).toHaveBeenCalledTimes(calls);
    await expect(f.act({ action: 'approve_brief' })).rejects.toBeInstanceOf(ConflictError);
    await expect(
      f.act({ action: 'select_investor', investorId: f.investorId }),
    ).rejects.toBeInstanceOf(ConflictError);
    await f.act({ action: 'approve_pitch' });
    await f.act({ action: 'select_investor', investorId: f.investorId });
    const selected = await f.service.connected.view();
    expect(selected.cycle?.brief).toContain(selected.pitch?.text);
    expect(selected.steps[2]?.status).toBe('needs_review');
  });
  it('preserves edited versions, rejects stale commands, and replays the same command after changes', async () => {
    const f = fixture();
    await f.start();
    const view = await f.service.connected.view();
    const command = {
      action: 'save_pitch',
      text: 'Founder-edited financial explanation with unknown cash timing.',
      version: view.version,
      key: randomUUID(),
    } satisfies ConnectedPreparationCommand;
    await f.service.connected.command(command);
    const saved = structuredClone(f.state().preparation?.connected);
    await f.service.connected.command(command);
    expect(f.state().preparation?.connected).toEqual(saved);
    expect(saved?.pitches).toHaveLength(2);
    expect(saved?.cycles[0]?.outcome).toBe('superseded');
    await expect(
      f.service.connected.command({ ...command, text: 'Different payload' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      f.service.connected.command({
        action: 'approve_pitch',
        version: view.version,
        key: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it('offers sourced recommendations without treating financing history or unknowns as mandate', async () => {
    const f = fixture();
    await f.start();
    const recommendations = preparationRecommendations(f.state());
    expect(recommendations[0]?.label).toBe('Recommended to review');
    expect(recommendations[0]?.reasons.join(' ')).toContain('1 prior financing');
    expect(recommendations[0]?.unknowns.join(' ')).toContain('Current investment mandate');
    const html = renderToStaticMarkup(
      createElement(InvestorPreparationRecommendations, { view: await f.service.connected.view() }),
    );
    expect(html).toContain('Recommended to review');
    expect(html).toContain('Fictional demo evidence');
    await f.service.change((s) => {
      const e = s.evidence[0];
      if (e) {
        e.stage = null;
        e.sector = null;
        e.geography = null;
      }
    });
    expect(preparationRecommendations(f.state())[0]?.label).toBe('Needs verification');
    await f.service.change((s) => {
      const e = s.evidence[0];
      if (e) e.stage = 'Series B';
    });
    expect(preparationRecommendations(f.state())[0]?.label).toBe('Review tradeoffs');
  });
  it('freezes approved preparation in scenario input, excludes unrelated research, and preserves legacy hashes', async () => {
    const f = fixture();
    await f.throughBrief();
    const cycle = (await f.service.connected.view()).cycle;
    if (!cycle) throw new Error('Missing cycle');
    const legacy = assembleScenarioInput(f.state(), f.investorId, '');
    expect(legacy.preparation).toBeUndefined();
    const frozen = assembleScenarioInput(f.state(), f.investorId, '', cycle.id);
    expect(frozen.preparation?.pitch).toBe((await f.service.connected.view()).pitch?.text);
    const before = scenarioInputHash(frozen);
    await f.service.change((s) => {
      s.profile.goal = 'Changed context';
    });
    expect((await f.service.connected.view()).outdated).toBe(true);
    expect(() => preparedPitchContext(f.state(), cycle.id)).toThrow(ConflictError);
    expect(scenarioInputHash(frozen)).toBe(before);
    expect(connectedHash(legacy)).not.toBe(connectedHash(frozen));
    await f.act({ action: 'refresh' });
    expect(f.state().preparation?.connected?.cycles).toHaveLength(2);
  });
  it('opens the next cycle from an approved proposal without changing earlier evidence or practice', async () => {
    const f = fixture();
    await f.throughBrief();
    const { session, evaluation } = await f.addReview();
    const frozen = structuredClone(f.state().rehearsals[0]);
    await f.service.connected.reconcile();
    const view = await f.service.connected.view();
    expect(view.steps[3]?.status).toBe('complete');
    expect(view.steps[4]?.status).toBe('needs_review');
    expect(view.cycle?.proposal?.evaluationId).toBe(evaluation.id);
    const count = f.save.mock.calls.length;
    await f.service.connected.reconcile();
    expect(f.save).toHaveBeenCalledTimes(count);
    await expect(f.act({ action: 'finish_cycle' })).rejects.toBeInstanceOf(ConflictError);
    await f.act({ action: 'review_feedback', sessionId: session.id, evaluationId: evaluation.id });
    await f.act({
      action: 'accept_revision',
      text: 'Reviewed revision that distinguishes operations from income and keeps cash unknown.',
    });
    const next = await f.service.connected.view();
    expect(next.completedCycles).toBe(1);
    expect(next.steps[0]?.status).toBe('complete');
    expect(next.steps[2]?.status).toBe('needs_review');
    expect(next.steps[3]?.status).toBe('blocked');
    expect(next.cycle?.brief).toContain('Reviewed revision');
    expect(f.state().rehearsals[0]).toEqual(frozen);
    expect(next.history[1]?.outcome).toBe('accepted');
  });
  it('records rejection as a decision, retains the gap, and does not count it as measured improvement', async () => {
    const f = fixture();
    await f.throughBrief();
    const { session, evaluation } = await f.addReview();
    await f.act({ action: 'review_feedback', sessionId: session.id, evaluationId: evaluation.id });
    const before = (await f.service.connected.view()).pitch;
    await f.act({ action: 'reject_revision' });
    const view = await f.service.connected.view();
    expect(view.cycle?.outcome).toBe('rejected');
    expect(view.latestSession?.hasGaps).toBe(true);
    expect(view.pitch).toEqual(before);
    expect(view.steps[5]?.status).toBe('complete');
  });
  it('finishes a no-gap cycle and remains idle until explicit repeat or changed inputs', async () => {
    const f = fixture();
    await f.throughBrief();
    const { session, evaluation } = await f.addReview(false);
    await f.act({ action: 'review_feedback', sessionId: session.id, evaluationId: evaluation.id });
    expect((await f.service.connected.view()).cycle?.proposal).toBeNull();
    await f.act({ action: 'finish_cycle' });
    const count = f.save.mock.calls.length;
    await f.service.connected.reconcile();
    expect(f.save).toHaveBeenCalledTimes(count);
    expect((await f.service.connected.view()).cycle?.outcome).toBe('reviewed');
    await f.act({ action: 'repeat' });
    const repeated = await f.service.connected.view();
    expect(repeated.cycle?.closedAt).toBeNull();
    expect(repeated.cycle?.brief).toContain(repeated.pitch?.text);
    expect(repeated.cycle?.briefApprovedAt).toBeNull();
    await f.act({ action: 'approve_brief' });
    expect((await f.service.connected.view()).cycle?.briefApprovedAt).toBeTruthy();
  });
  it('shows retry progress from the latest evaluation job rather than an older failed attempt', async () => {
    const f = fixture();
    await f.throughBrief();
    const { session, evaluation } = await f.addReview();
    await f.service.change((state) => {
      const record = state.rehearsals.find((item) => item.id === session.id)?.evaluations[0];
      if (!record) throw new Error('Missing evaluation');
      record.status = 'queued';
      record.report = null;
    });
    const kind = `evaluate:${session.id}:${evaluation.id}`;
    f.jobs.push({
      id: randomUUID(),
      kind,
      status: 'failed',
      attempts: 3,
      createdAt: '2026-10-17T10:00:00.000Z',
      result: null,
      error: 'Test failure',
    });
    expect((await f.service.connected.view()).latestSession?.status).toBe('failed');
    f.jobs.push({
      id: randomUUID(),
      kind,
      status: 'queued',
      attempts: 0,
      createdAt: '2026-10-17T10:01:00.000Z',
      result: null,
      error: null,
    });
    expect((await f.service.connected.view()).latestSession?.status).toBe('pending');
  });

  it('rechecks prepared context inside provider session writes and blocks duplicate or stale starts', async () => {
    const f = fixture();
    await f.throughBrief();
    const { session } = await f.addReview(true, true);
    if (!session.context) throw new Error('Missing saved context');
    const voice = await f.service.createRehearsal(
      null,
      'elevenlabs',
      'fictional-provider-id',
      session.context,
    );
    expect(voice.context).toEqual(session.context);
    await expect(
      f.service.createRehearsal(null, 'liveavatar', null, session.context),
    ).rejects.toBeInstanceOf(ConflictError);
    await f.service.change((state) => {
      state.profile.version++;
    });
    await expect(
      f.service.createRehearsal(null, 'elevenlabs', 'another-fictional-id', session.context),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not treat a partial assessment as a completed practice or allow it to close the cycle', async () => {
    const f = fixture();
    await f.throughBrief();
    const { session, evaluation } = await f.addReview(true, true);
    const view = await f.service.connected.view();
    expect(view.latestSession?.status).toBe('unavailable');
    expect(view.steps[3]?.status).not.toBe('complete');
    await expect(
      f.act({ action: 'review_feedback', sessionId: session.id, evaluationId: evaluation.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
