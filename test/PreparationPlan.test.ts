import { radarEvidence } from './fixtures/RadarFixture.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { fixtureEvaluationProvider } from './EvaluationFixtures.js';
import { ResearchFixture } from './fixtures/ResearchFixture.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import { ConflictError, type WorkspaceStore } from '../src/features/WorkspaceStore.js';
import { workspaceSchema } from '../src/contracts/Workspace.js';
import {
  preparationGoalInputSchema,
  preparationStateSchema,
  preparationViewSchema,
} from '../src/contracts/FundraisingPreparation.js';
import {
  buildPreparationPlan,
  preparationInputs,
  preparationHash,
  projectPreparationPlan,
} from '../src/features/PreparationPlanner.js';

const input = preparationGoalInputSchema.parse({
  round: 'Series A',
  previousRounds: 2,
  amount: '2000000',
  currency: 'CAD',
  targetDate: '2026-11-01',
  timezone: 'America/Toronto',
  investorId: null,
});
function fixture() {
  let state = preparationFixture().state;
  state.rehearsals = [];
  const save = vi.fn<WorkspaceStore['save']>((next, expected) => {
    if (state.revision !== expected) return Promise.reject(new ConflictError());
    state = workspaceSchema.parse({ ...structuredClone(next), revision: expected + 1 });
    return Promise.resolve();
  });
  const store: WorkspaceStore = {
    load: () => Promise.resolve(structuredClone(state)),
    save,
    initialize: () => Promise.resolve(),
    enqueue: () => Promise.reject(new Error('Unexpected enqueue')),
    listJobs: () => Promise.resolve([]),
    claimJob: () => Promise.resolve(null),
    finishJob: () => Promise.resolve(),
    failJob: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return {
    service: new WorkspaceService(store, new ResearchFixture(), fixtureEvaluationProvider),
    save,
    state: () => state,
  };
}

describe('CFO preparation plan', () => {
  it('starts without interviews, preserves exact evidence and never mutates on reads', async () => {
    const { service, state, save } = fixture();
    expect((await service.preparation.view()).goal).toBeNull();
    await service.preparation.confirmGoal(input, 0, true);
    const before = structuredClone(state());
    const calls = save.mock.calls.length;
    const view = preparationViewSchema.parse(await service.preparation.view());
    expect(view.milestones[0]?.status).toBe('complete');
    expect(view.milestones[1]?.status).toBe('needs_review');
    expect(view.plan?.artifacts[0]).toMatchObject({
      fictional: true,
      chart: {
        period: '2026-09',
        operatingIncome: '-18000',
        credit: '30000',
        netIncome: '12000',
      },
    });
    expect(view.plan?.artifacts[0]?.narrative).not.toContain('$');
    expect(save).toHaveBeenCalledTimes(calls);
    expect(state()).toEqual(before);
    await service.preparation.reconcile();
    expect(save).toHaveBeenCalledTimes(calls);
  });

  it('invalidates old-source reviews, preserves history and respects automatic pause', async () => {
    const { service, state } = fixture();
    await service.preparation.confirmGoal(input, 0, true);
    const old = (await service.preparation.view()).plan;
    if (!old?.artifacts[0]) throw new Error('Missing plan');
    await service.change((current) => {
      current.profile.version++;
    });
    expect((await service.preparation.view()).outdated).toBe(true);
    await expect(
      service.preparation.decide(old.id, old.artifacts[0].id, 'accepted', '', randomUUID()),
    ).rejects.toBeInstanceOf(ConflictError);
    await service.preparation.reconcile();
    expect(state().preparation?.plans).toHaveLength(2);
    expect(state().preparation?.plans[0]).toEqual(old);
    const view = await service.preparation.view();
    await service.preparation.setAutomatic(false, view.version);
    await service.change((current) => {
      current.profile.version++;
    });
    await service.preparation.reconcile();
    expect(state().preparation?.plans).toHaveLength(2);
    await service.preparation.reconcile(true);
    expect(state().preparation?.plans).toHaveLength(3);
  });

  it('keeps rejected work open and makes decisions and assessment submissions idempotent', async () => {
    const { service, state } = fixture();
    await service.preparation.confirmGoal(input, 0, true);
    const plan = (await service.preparation.view()).plan;
    const artifact = plan?.artifacts[0];
    if (!plan || !artifact) throw new Error('Missing plan');
    await expect(
      service.preparation.rehearse(plan.id, artifact.id, 'An answer', randomUUID()),
    ).rejects.toThrow('review the financial');
    const key = randomUUID();
    await service.preparation.decide(plan.id, artifact.id, 'rejected', 'Clarify the credit', key);
    await service.preparation.decide(plan.id, artifact.id, 'rejected', 'Clarify the credit', key);
    expect(state().preparation?.decisions).toHaveLength(1);
    expect((await service.preparation.view()).milestones[1]?.status).toBe('needs_review');
    await expect(
      service.preparation.decide(plan.id, artifact.id, 'accepted', '', key),
    ).rejects.toBeInstanceOf(ConflictError);
    await service.preparation.decide(plan.id, artifact.id, 'accepted', '', randomUUID());
    const attempt = randomUUID();
    const id = await service.preparation.rehearse(
      plan.id,
      artifact.id,
      'Our operating income is -59797 unspecified for 2026-07.',
      attempt,
    );
    expect(
      await service.preparation.rehearse(
        plan.id,
        artifact.id,
        'Our operating income is -59797 unspecified for 2026-07.',
        attempt,
      ),
    ).toBe(id);
    expect(state().rehearsals).toHaveLength(1);
    expect(state().rehearsals[0]?.evaluations[0]?.status).toBe('queued');
    expect((await service.preparation.view()).reviews[0]?.status).toBe('pending');
    expect((await service.preparation.view()).milestones[4]?.status).toBe('available');
    await expect(
      service.preparation.rehearse(plan.id, artifact.id, 'Changed answer', attempt),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('creates meaningful updates for selected evidence only, without exposing another investor', () => {
    const { state } = preparationFixture();
    const goal = { ...input, id: randomUUID(), confirmedAt: '2026-10-17T18:00:00.000Z' };
    const original = preparationHash(preparationInputs(state, goal));
    state.notices.push({
      id: 'unrelated',
      title: 'Notice',
      message: '',
      createdAt: goal.confirmedAt,
      read: false,
    });
    expect(preparationHash(preparationInputs(state, goal))).toBe(original);
    const plan = buildPreparationPlan(state, goal, goal.confirmedAt);
    expect(plan.artifacts.some((artifact) => artifact.kind === 'investor')).toBe(false);
    state.onboarding.snapshotId = null;
    const missing = buildPreparationPlan(state, goal, goal.confirmedAt);
    expect(missing.artifacts).toEqual([]);
    expect(missing.summary).toContain('Select a saved');
  });

  it('uses the latest linked assessment and never treats incomplete numerical coverage as success', () => {
    const { state, session, evaluation } = preparationFixture();
    const goal = { ...input, id: randomUUID(), confirmedAt: '2026-10-17T18:00:00.000Z' };
    const plan = buildPreparationPlan(state, goal, goal.confirmedAt);
    const artifact = plan.artifacts[0];
    const template = evaluation.report?.extraction.claims[0];
    if (!artifact?.chart || !evaluation.report || !template) throw new Error('Missing fixture');
    const values = [
      ['operating_income', artifact.chart.operatingIncome],
      ['other_income_credit', artifact.chart.credit],
      ['net_income', artifact.chart.netIncome],
    ];
    evaluation.report.extraction.claims = values.map(([metric, value], index) => ({
      ...template,
      id: `figure-${index}`,
      metric: metric ?? null,
      value: value ?? null,
      period: artifact.chart?.period ?? null,
      supersededByTurnId: null,
    }));
    evaluation.report.checks = evaluation.report.extraction.claims.map((claim) => ({
      claimId: claim.id,
      support: 'supported',
      factIds: [],
      explanation: 'Fixture evidence matches.',
    }));
    evaluation.report.coaching.items = [];
    state.preparation = preparationStateSchema.parse({
      goals: [goal],
      plans: [plan],
      decisions: [
        {
          id: randomUUID(),
          planId: plan.id,
          artifactId: artifact.id,
          kind: 'accepted',
          note: '',
          createdAt: goal.confirmedAt,
        },
      ],
      rehearsals: [
        {
          requestKey: randomUUID(),
          requestHash: 'fixture',
          planId: plan.id,
          artifactId: artifact.id,
          sessionId: session.id,
        },
      ],
    });
    expect(projectPreparationPlan(state, [], null).milestones[4]?.status).toBe('complete');
    evaluation.report.extraction.claims.pop();
    expect(projectPreparationPlan(state, [], null).milestones[4]?.status).toBe('available');
    const pending = structuredClone(session);
    pending.id = randomUUID();
    const pendingReview = pending.evaluations[0];
    if (!pendingReview) throw new Error('Missing evaluation');
    pendingReview.status = 'queued';
    pendingReview.report = null;
    state.rehearsals.push(pending);
    state.preparation.rehearsals.push({
      requestKey: randomUUID(),
      requestHash: 'second',
      planId: plan.id,
      artifactId: artifact.id,
      sessionId: pending.id,
    });
    expect(projectPreparationPlan(state, [], null).reviews[0]?.status).toBe('pending');
    expect(projectPreparationPlan(state, [], null).milestones[4]?.status).toBe('available');
  });

  it('preserves unknown currency and does not claim improvement from unrelated assessment', () => {
    const { state, session } = preparationFixture();
    const snapshot = state.snapshots[0];
    if (!snapshot) throw new Error('Missing snapshot');
    snapshot.currency = 'unspecified';
    const goal = {
      ...input,
      previousRounds: null,
      id: randomUUID(),
      confirmedAt: '2026-10-17T18:00:00.000Z',
    };
    const plan = buildPreparationPlan(state, goal, goal.confirmedAt);
    state.preparation = preparationStateSchema.parse({ goals: [goal], plans: [plan] });
    const view = projectPreparationPlan(state, [], null);
    expect(view.plan?.artifacts[0]?.chart?.currency).toBe('currency not confirmed');
    expect(view.plan?.summary).toContain('not confirmed');
    expect(view.milestones[4]?.status).toBe('blocked');
    expect(state.rehearsals[0]?.id).toBe(session.id);
  });
});

describe('saved preparation scheduling assumptions', () => {
  it('preserves history, rejects stale versions and does not create drafts or verify cash', async () => {
    const { service, state } = fixture();
    await service.preparation.confirmGoal(input, 0, true);
    const view = await service.preparation.view();
    if (!view.plan) throw new Error('Missing plan');
    const assumptions = {
      dailyHours: 2,
      cashExpectedDate: '2026-10-19',
      hours: { financial: 2, investor: 2, brief: 2, rehearse: 4 },
    };
    const snapshots = structuredClone(state().snapshots);
    await service.preparation.saveSchedule(assumptions, view.version, view.plan.id);
    expect((await service.preparation.view()).schedule).toMatchObject(assumptions);
    await expect(
      service.preparation.saveSchedule(assumptions, view.version, view.plan.id),
    ).rejects.toThrow('Preparation changed');
    await service.preparation.saveSchedule(
      { ...assumptions, dailyHours: 1 },
      view.version + 1,
      view.plan.id,
    );
    expect(state().preparation?.schedules).toHaveLength(2);
    expect(state().preparation?.plans).toHaveLength(1);
    expect(state().snapshots).toEqual(snapshots);
    await expect(
      service.preparation.saveSchedule(
        { ...assumptions, dailyHours: 0 },
        view.version + 2,
        view.plan.id,
      ),
    ).rejects.toThrow();
    await service.change((current) => {
      current.profile.version++;
    });
    await expect(
      service.preparation.saveSchedule(assumptions, view.version + 2, view.plan.id),
    ).rejects.toThrow('Preparation changed');
  });
});

describe('goal-first preparation', () => {
  it('prepares from one intent, updates downstream context and rejects stale edits', async () => {
    const { service, state } = fixture();
    const before = structuredClone(state().snapshots);
    await service.preparation.setIntent(
      'I want to raise my next round',
      0,
      state().profile.version,
    );
    const first = await service.preparation.view();
    expect(first.goal).toMatchObject({
      round: 'Next round',
      previousRounds: null,
      targetDate: null,
    });
    expect(first.plan?.artifacts[0]?.kind).toBe('financial');
    expect(first.automatic).toBe(true);
    expect(state().profile.goal).toBe('I want to raise my next round');
    await expect(
      service.preparation.setIntent('Raise growth funding', 0, state().profile.version),
    ).rejects.toThrow('Preparation changed');
    await expect(
      service.preparation.setIntent('   ', first.version, state().profile.version),
    ).rejects.toThrow();
    await service.preparation.setIntent(
      'Prepare for an institutional round',
      first.version,
      state().profile.version,
    );
    expect(state().preparation?.goals).toHaveLength(2);
    expect(state().preparation?.plans[0]).toEqual(first.plan);
    expect(state().snapshots).toEqual(before);
    await service.updateInvestorMeeting({
      name: 'Example Investor',
      firm: 'Fictional Firm',
      date: null,
      notes: 'Ask about retention.',
      links: { linkedin: null, x: null, website: null },
    });
    const next = await service.preparation.view();
    expect(next.goal?.investorId).toBe(state().onboarding.meeting?.investorId);
    expect(next.plan?.artifacts.some((artifact) => artifact.kind === 'investor')).toBe(true);
    expect(state().investors.at(-1)?.frequency).toBe('paused');
  });
  it('creates the same plan from onboarding without a second goal confirmation', async () => {
    const { service, state } = fixture();
    const profile = state().profile;
    await service.saveOnboardingCompany({ ...profile, goal: 'Raise my next round' });
    const view = await service.preparation.view();
    expect(view.goal?.round).toBe('Next round');
    expect(view.plan).not.toBeNull();
    expect(state().onboarding.step).toBe(3);
    await service.completeOnboarding(null);
    expect(state().onboarding.completedAt).not.toBeNull();
    expect((await service.preparation.view()).outdated).toBe(false);
  });
});

describe('automatic position reconciliation', () => {
  it('updates selected-investor evidence while preserving financial position and unchanged reviews', async () => {
    const { service, state } = fixture();
    const investorId = randomUUID();
    await service.change((current) => {
      current.investors.push({
        id: investorId,
        key: 'fixture',
        name: 'Fictional Investor',
        url: null,
        profileLinks: [],
        origin: 'added',
        discoveryEvidenceId: null,
        createdAt: new Date().toISOString(),
        frequency: 'paused',
        nextAt: null,
        checks: [],
      });
    });
    await service.preparation.confirmGoal({ ...input, investorId }, 0, true);
    const initial = await service.preparation.view();
    if (!initial.plan?.artifacts[0]) throw new Error('Missing initial plan');
    await service.preparation.decide(
      initial.plan.id,
      initial.plan.artifacts[0].id,
      'accepted',
      '',
      randomUUID(),
    );
    const evidence = radarEvidence();
    evidence.mode = 'demo';
    evidence.investor = 'Fictional Investor';
    await service.change((current) => {
      current.evidence.push(evidence);
      const investor = current.investors.find((item) => item.id === investorId);
      if (!investor) throw new Error('Missing investor');
      investor.checks.push({
        jobId: 'fixture-check',
        checkedAt: new Date().toISOString(),
        profileVersion: current.profile.version,
        evidenceIds: [evidence.id],
        addedIds: [evidence.id],
        changedIds: [],
        note: 'New fictional source',
      });
    });
    const pending = await service.preparation.view();
    expect(pending.outdated).toBe(true);
    expect(pending.position?.pendingChanges).toContain(
      'Selected investor or supporting research changed.',
    );
    await service.preparation.reconcile();
    const updated = await service.preparation.view();
    expect(updated.outdated).toBe(false);
    expect(updated.plan?.changes).toEqual(['Selected investor or supporting research changed.']);
    expect(updated.position?.financial).toEqual(initial.position?.financial);
    expect(updated.milestones.find((item) => item.id === 'financial')?.status).toBe('complete');
    expect(
      updated.plan?.artifacts.find((item) => item.kind === 'investor')?.sources[0]?.excerpt,
    ).toBe(evidence.excerpt);
    expect(state().preparation?.plans[0]).toEqual(initial.plan);
    const length = state().preparation?.plans.length;
    await service.preparation.reconcile();
    expect(state().preparation?.plans).toHaveLength(length ?? 0);
  });
  it('reacts to completed assessments but remains read-only and respects paused drafting', async () => {
    const { service, state } = fixture();
    await service.preparation.confirmGoal(input, 0, true);
    const initial = await service.preparation.view();
    const { session } = preparationFixture();
    await service.change((current) => {
      current.rehearsals.push(session);
    });
    expect((await service.preparation.view()).position?.pendingChanges).toEqual([
      'Completed assessment feedback changed.',
    ]);
    await service.preparation.setAutomatic(false, (await service.preparation.view()).version);
    const before = structuredClone(state());
    await service.preparation.view();
    await service.preparation.reconcile();
    expect(state()).toEqual(before);
    await service.preparation.reconcile(true);
    const updated = await service.preparation.view();
    expect(updated.plan?.id).not.toBe(initial.plan?.id);
    expect(updated.plan?.changes).toEqual(['Completed assessment feedback changed.']);
  });
});
