import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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
import { goalJourneySchema, goalInvestorTargetSchema } from '../src/contracts/GoalJourney.js';
import { ensureTargetPreparation } from '../src/features/ConnectedPreparationService.js';
import {
  connectedPreparationViewSchema,
  type ConnectedPreparationCommand,
} from '../src/contracts/ConnectedPreparation.js';
import {
  preparationRecommendations,
  preparedPitchContext,
  connectedHash,
  activePreparationCycle,
  connectedSourceHash,
} from '../src/features/ConnectedPreparation.js';
import { assembleScenarioInput, scenarioInputHash } from '../src/features/ScenarioSources.js';
import { DemoScenarioGenerator } from '../src/infrastructure/ScenarioGeneration.js';
import { practiceContextSchema } from '../src/contracts/PracticeContext.js';
import { InvestorPreparationRecommendations } from '../src/web/ConnectedPreparation.js';
import { projectPreparationPlan } from '../src/features/PreparationPlanner.js';
import { projectSchedule } from '../src/web/PreparationScheduleModel.js';

type Action<T> = T extends object ? Omit<T, 'version' | 'key'> : never;
function fixture(journey = false) {
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
  const start = async (prepareCycle = true) => {
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
    if (!journey) {
      await service.change((current) => {
        if (current.preparation) delete current.preparation.journey;
      });
    }
    if (journey) {
      await service.change((current) => {
        const goal = current.preparation?.goals.at(-1);
        if (!goal || !current.preparation) throw new Error('Missing goal');
        const now = new Date().toISOString();
        current.preparation.journey = goalJourneySchema.parse({
          id: randomUUID(),
          currentGoalId: goal.id,
          status: 'active',
          createdAt: now,
          revision: 0,
          focusedTargetId: null,
          targets: [],
          assessments: [],
          scopes: [
            {
              id: randomUUID(),
              version: 1,
              targetIds: [],
              createdAt: now,
              reason: 'Fictional test scope',
            },
          ],
          events: [],
          lastSequence: 0,
          lastFingerprint: null,
          commands: [],
        });
      });
    }
    if (prepareCycle) await act({ action: 'start' });
  };
  const throughBrief = async () => {
    await start();
    await act({ action: 'approve_pitch' });
    await act({ action: 'select_investor', investorId });
    await act({ action: 'approve_brief' });
  };
  const addReview = async (hasGaps = true, partial = false, targetId?: string) => {
    const cycle = targetId
      ? activePreparationCycle(state, targetId)
      : state.preparation?.connected?.cycles.at(-1);
    if (!cycle) throw new Error('Missing cycle');
    const input = assembleScenarioInput(
      state,
      cycle.investorId ?? investorId,
      'Explain the approved story',
      cycle.id,
    );
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
  it('previews the first company story without saving a cycle, approval or progress, then starts from that exact draft', async () => {
    const f = fixture(true);
    await f.start(false);
    const before = structuredClone(f.state());
    const saves = f.save.mock.calls.length;
    const preview = await f.service.connected.view();
    expect(preview.cycle).toBeNull();
    expect(preview.pitch).toBeNull();
    expect(preview.storyDraft?.text).toBeTruthy();
    expect(preview.storyDraft?.fictional).toBe(true);
    expect(preview.storyDraft).not.toHaveProperty('id');
    expect((await f.service.connected.view()).storyDraft).toEqual(preview.storyDraft);
    expect(f.state()).toEqual(before);
    expect(f.save).toHaveBeenCalledTimes(saves);
    await f.act({ action: 'start' });
    const started = await f.service.connected.view();
    expect(started.pitch).toMatchObject(preview.storyDraft ?? {});
    expect(started.cycle?.pitchApprovedAt).toBeNull();
    expect(started.storyDraft).toBeNull();
  });

  it('does not invent a story preview without the selected financial evidence', async () => {
    const f = fixture(true);
    await f.start(false);
    await f.service.change((state) => {
      state.snapshots = [];
    });
    const before = structuredClone(f.state());
    const view = await f.service.connected.view();
    expect(view.storyDraft).toBeNull();
    expect(view.pitch).toBeNull();
    expect(view.cycle).toBeNull();
    expect(f.state()).toEqual(before);
  });
  it('opens archived goal artifacts read-only and rejects stale-goal preparation commands', async () => {
    const f = fixture(true);
    await f.throughBrief();
    const prior = await f.service.connected.view();
    const priorJourney = f.state().preparation?.journey;
    const targetId = prior.cycle?.targetId;
    if (!prior.cycle || !priorJourney || !targetId) throw new Error('Missing historical fixture');
    await f.service.change((state) => {
      const saved = state.preparation;
      if (!saved) throw new Error('Missing preparation');
      (saved.journeyHistory ??= []).push({ ...structuredClone(priorJourney), status: 'archived' });
      const now = new Date().toISOString();
      saved.journey = goalJourneySchema.parse({
        id: randomUUID(),
        currentGoalId: priorJourney.currentGoalId,
        status: 'active',
        createdAt: now,
        revision: 0,
        focusedTargetId: null,
        targets: [],
        assessments: [],
        scopes: [
          {
            id: randomUUID(),
            version: 1,
            targetIds: [],
            createdAt: now,
            reason: 'A new fictional objective',
          },
        ],
        events: [],
        lastSequence: 0,
        lastFingerprint: null,
        commands: [],
      });
    });
    const inspected = await f.service.connected.view(targetId, prior.cycle.id);
    expect(inspected).toMatchObject({
      historical: true,
      journeyId: priorJourney.id,
      cycle: null,
      goalId: null,
    });
    expect(inspected.history.some((cycle) => cycle.id === prior.cycle?.id)).toBe(true);
    expect(inspected.briefVersions.some((brief) => brief.id === prior.cycle?.briefVersionId)).toBe(
      true,
    );
    await expect(f.service.connected.view(targetId)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      f.service.connected.command({
        action: 'approve_brief',
        targetId,
        journeyId: priorJourney.id,
        key: randomUUID(),
        version: inspected.version,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(() => preparedPitchContext(f.state(), prior.cycle?.id ?? '')).toThrow(ConflictError);
  });

  it('keeps focused retry evidence separate from the full preparation review gate', async () => {
    const f = fixture();
    await f.throughBrief();
    const { session, evaluation } = await f.addReview(true);
    await f.service.change((state) => {
      const focused = structuredClone(session);
      focused.id = randomUUID();
      focused.createdAt = new Date(Date.parse(session.createdAt) + 1000).toISOString();
      focused.turns = [
        { role: 'agent', text: 'Explain this single finding.' },
        { role: 'user', text: 'A fictional focused retry.' },
      ];
      const focusedEvaluation = structuredClone(evaluation);
      focusedEvaluation.id = randomUUID();
      focusedEvaluation.parentEvaluationId = evaluation.id;
      focusedEvaluation.parentItemId =
        evaluation.report?.coaching.items[0]?.id ?? 'fixture-finding';
      if (!focusedEvaluation.report) throw new Error('Missing focused report');
      focusedEvaluation.report.coaching.items = [];
      focusedEvaluation.report.checks = [];
      focused.evaluations = [focusedEvaluation];
      state.rehearsals.push(focused);
    });
    const current = await f.service.connected.view();
    expect(current.latestSession?.id).toBe(session.id);
    expect(current.latestSession?.hasGaps).toBe(true);
    await f.act({ action: 'review_feedback', sessionId: session.id, evaluationId: evaluation.id });
    await expect(f.act({ action: 'finish_cycle' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('opens an exact older practice cycle without replacing the current command cycle', async () => {
    const f = fixture();
    await f.throughBrief();
    const original = (await f.service.connected.view()).cycle;
    if (!original) throw new Error('Missing original cycle');
    await f.act({
      action: 'save_pitch',
      text: 'A later fictional financial story; earlier evidence remains available.',
    });
    await f.act({ action: 'approve_pitch' });
    await f.act({ action: 'approve_brief' });
    for (let index = 0; index < 10; index++) {
      const { session, evaluation } = await f.addReview(false);
      await f.act({
        action: 'review_feedback',
        sessionId: session.id,
        evaluationId: evaluation.id,
      });
      await f.act({ action: 'finish_cycle' });
      await f.act({ action: 'repeat' });
      await f.act({ action: 'approve_brief' });
    }
    const current = await f.service.connected.view();
    expect(current.history.some((cycle) => cycle.id === original.id)).toBe(false);
    const inspected = await f.service.connected.view(undefined, original.id);
    expect(inspected.cycle).toEqual(current.cycle);
    expect(inspected.history).toHaveLength(10);
    expect(inspected.history.some((cycle) => cycle.id === original.id)).toBe(true);
    expect(inspected.historyPitches.some((pitch) => pitch.id === original.pitchId)).toBe(true);
    await expect(f.service.connected.view(undefined, randomUUID())).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('preserves independent target cycles, immutable briefs and exact practice lineage across focus changes', async () => {
    const f = fixture(true);
    await f.start();
    await f.act({ action: 'approve_pitch' });
    const firstId = randomUUID();
    const secondId = randomUUID();
    const secondInvestorId = randomUUID();
    await f.service.change((state) => {
      const journey = state.preparation?.journey;
      const firstInvestor = state.investors.find((item) => item.id === f.investorId);
      if (!journey || !firstInvestor) throw new Error('Missing fixture records');
      state.investors.push({
        ...structuredClone(firstInvestor),
        id: secondInvestorId,
        key: 'fictional-second',
        name: 'Fictional second investor',
        discoveryEvidenceId: null,
      });
      for (const [id, investorId] of [
        [firstId, f.investorId],
        [secondId, secondInvestorId],
      ]) {
        journey.targets.push(
          goalInvestorTargetSchema.parse({
            id,
            investorId,
            assessmentId: null,
            rationale: 'Fictional target for preparation',
            status: 'active',
            included: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            eventId: null,
          }),
        );
        ensureTargetPreparation(state, id ?? '', investorId ?? '');
      }
      journey.focusedTargetId = firstId;
    });
    await f.act({ action: 'approve_brief', targetId: firstId });
    await f.act({ action: 'approve_brief', targetId: secondId });
    const first = await f.service.connected.view(firstId);
    const second = await f.service.connected.view(secondId);
    if (!first.cycle || !second.cycle) throw new Error('Missing target cycle');
    expect(first.cycle.id).not.toBe(second.cycle.id);
    expect(first.cycle.briefVersionId).toBeTruthy();
    expect(
      first.briefVersions
        .find((brief) => brief.id === first.cycle?.briefVersionId)
        ?.sources.some((source) => source.id === 'loop-source'),
    ).toBe(true);
    await expect(f.service.connected.view(secondId, first.cycle.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const frozen = preparedPitchContext(f.state(), first.cycle.id);
    expect(frozen).toMatchObject({
      targetId: firstId,
      journeyId: f.state().preparation?.journey?.id,
      briefVersionId: first.cycle.briefVersionId,
    });
    await f.service.change((state) => {
      if (state.preparation?.journey) state.preparation.journey.focusedTargetId = secondId;
      state.profile.version++;
      state.profile.watchlist = ['Unrelated investor'];
      const goal = state.preparation?.goals.at(-1);
      if (goal) {
        goal.investorId = secondInvestorId;
        goal.targetDate = '2026-12-01';
      }
    });
    expect(preparedPitchContext(f.state(), first.cycle.id)).toEqual(frozen);
    expect((await f.service.connected.view()).cycle?.id).toBe(second.cycle.id);
    expect((await f.service.connected.view(firstId)).outdated).toBe(false);
    const priorBrief = structuredClone(
      f
        .state()
        .preparation?.connected?.briefVersions.find(
          (brief) => brief.id === first.cycle?.briefVersionId,
        ),
    );
    await f.act({
      action: 'save_pitch',
      targetId: firstId,
      text: 'Investor-specific fictional wording; cash evidence remains unknown.',
    });
    expect((await f.service.connected.view(firstId)).pitch?.scope).toBe('target');
    expect((await f.service.connected.view(secondId)).cycle).toEqual(second.cycle);
    expect(
      f
        .state()
        .preparation?.connected?.briefVersions.find(
          (brief) => brief.id === first.cycle?.briefVersionId,
        ),
    ).toEqual(priorBrief);
    expect(() => preparedPitchContext(f.state(), first.cycle?.id ?? '')).toThrow(ConflictError);
    expect(() => preparedPitchContext(f.state(), second.cycle?.id ?? '')).not.toThrow();
    await f.act({
      action: 'save_pitch',
      targetId: firstId,
      scope: 'shared',
      text: 'Reviewed fictional company story proposed for every investor.',
    });
    expect((await f.service.connected.view(secondId)).outdated).toBe(true);
    await f.service.change((state) => {
      expect(ensureTargetPreparation(state, secondId, secondInvestorId)).toBeNull();
    });
    await f.act({ action: 'approve_pitch', targetId: firstId });
    const rebuiltSecond = await f.service.connected.view(secondId);
    expect(rebuiltSecond.cycle?.id).not.toBe(second.cycle.id);
    expect(rebuiltSecond.cycle?.briefApprovedAt).toBeNull();
    expect(rebuiltSecond.pitch?.text).toContain('for every investor');
    expect(() => z.json().parse(f.state().preparation)).not.toThrow();
  });

  it('ignores incidental profile revisions for prepared source hashes and invalidates only affected investor research', async () => {
    const f = fixture(true);
    await f.throughBrief();
    const view = await f.service.connected.view();
    if (!view.cycle) throw new Error('Missing cycle');
    const cycleId = view.cycle.id;
    const initialHash = connectedSourceHash(f.state());
    const initialInputHash = scenarioInputHash(
      assembleScenarioInput(f.state(), f.investorId, '', cycleId),
    );
    await f.service.change((state) => {
      state.profile.version++;
    });
    expect(connectedSourceHash(f.state())).toBe(initialHash);
    expect(scenarioInputHash(assembleScenarioInput(f.state(), f.investorId, '', cycleId))).toBe(
      initialInputHash,
    );
    await f.service.change((state) => {
      const source = state.evidence.find((item) => item.id === 'loop-source');
      if (source) source.excerpt = 'Changed fictional investor observation.';
    });
    expect((await f.service.connected.view()).outdated).toBe(true);
    expect(() => preparedPitchContext(f.state(), cycleId)).toThrow(ConflictError);
  });

  it('keeps a shortlisted target before story approval and reconciles feedback on an unfocused target', async () => {
    const f = fixture(true);
    await f.start();
    const targetId = randomUUID();
    await f.service.change((state) => {
      const journey = state.preparation?.journey;
      if (!journey) throw new Error('Missing journey');
      journey.targets.push(
        goalInvestorTargetSchema.parse({
          id: targetId,
          investorId: f.investorId,
          assessmentId: null,
          rationale: 'Fictional shortlist before shared-story review',
          status: 'active',
          included: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          eventId: null,
        }),
      );
      expect(ensureTargetPreparation(state, targetId, f.investorId)).toBeNull();
    });
    expect((await f.service.connected.view(targetId)).cycle).toBeNull();
    await f.act({ action: 'approve_pitch' });
    await f.act({ action: 'approve_brief', targetId });
    const { evaluation } = await f.addReview(true, false, targetId);
    await f.service.connected.reconcile();
    expect((await f.service.connected.view(targetId)).cycle?.proposal?.evaluationId).toBe(
      evaluation.id,
    );
    expect((await f.service.connected.view()).cycle?.targetId).toBeUndefined();
  });

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
