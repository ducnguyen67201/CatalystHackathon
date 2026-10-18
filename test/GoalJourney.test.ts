import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { fixtureEvaluationProvider } from './EvaluationFixtures.js';
import { ResearchFixture } from './fixtures/ResearchFixture.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import { ConflictError, type WorkspaceStore } from '../src/features/WorkspaceStore.js';
import {
  rehearsalSchema,
  workspaceSchema,
  type Evidence,
  type Job,
} from '../src/contracts/Workspace.js';
import { trackedInvestorSchema } from '../src/contracts/InvestorTracking.js';
import { preparationGoalInputSchema } from '../src/contracts/FundraisingPreparation.js';
import { goalProgressQuerySchema, type JourneyCommand } from '../src/contracts/GoalJourney.js';
import { investorMandateFactSchema } from '../src/contracts/InvestorMatch.js';
import type { ConnectedPreparationCommand } from '../src/contracts/ConnectedPreparation.js';
import { activePreparationCycle } from '../src/features/ConnectedPreparation.js';
import { projectGoalPosition } from '../src/features/GoalProgress.js';
import { assembleScenarioInput } from '../src/features/ScenarioSources.js';
import { DemoScenarioGenerator } from '../src/infrastructure/ScenarioGeneration.js';
import { practiceContextSchema } from '../src/contracts/PracticeContext.js';

type JourneyAction<T> = T extends object ? Omit<T, 'key' | 'revision'> : never;
type PreparationAction<T> = T extends object ? Omit<T, 'key' | 'version'> : never;

function fixture() {
  let state = preparationFixture().state;
  state.profile = {
    ...state.profile,
    goal: 'Fictional seed preparation goal',
    stage: 'Seed',
    sector: 'B2B SaaS',
    geography: 'Canada',
  };
  // Unrelated legacy practice must never be guessed into this new journey.
  const historicalSessionId = state.rehearsals[0]?.id;
  const jobs: Job[] = [];
  const investorIds = [randomUUID(), randomUUID()];
  for (const [index, investorId] of investorIds.entries()) {
    const evidenceId = `fictional-journey-source-${index}`;
    state.investors.push(
      trackedInvestorSchema.parse({
        id: investorId,
        key: `https://fictional-investor-${index}.example/`,
        name: `Fictional investor ${index + 1}`,
        url: `https://fictional-investor-${index}.example/`,
        origin: 'added',
        discoveryEvidenceId: evidenceId,
        createdAt: new Date().toISOString(),
        frequency: 'paused',
        nextAt: null,
        checks: [],
      }),
    );
    state.evidence.push({
      id: evidenceId,
      eventKey: evidenceId,
      mode: 'demo',
      investor: `Fictional investor ${index + 1}`,
      title: 'Fictional historical deal',
      url: `https://fictional-investor-${index}.example/source`,
      excerpt:
        'Fictional historical Seed software investment in Canada. This is not a current mandate.',
      publishedAt: null,
      discoveredAt: new Date().toISOString(),
      stage: 'Seed',
      sector: 'B2B SaaS',
      geography: 'Canada',
      checkMin: null,
      checkMax: null,
      currency: 'unspecified',
      explanation: 'Fictional fixture; mandate remains unverified.',
      verified: false,
    });
  }
  const save = vi.fn<WorkspaceStore['save']>((next, expected) => {
    if (state.revision !== expected) return Promise.reject(new ConflictError());
    state = workspaceSchema.parse({ ...structuredClone(next), revision: expected + 1 });
    return Promise.resolve();
  });
  const enqueue = vi.fn<WorkspaceStore['enqueue']>(() =>
    Promise.reject(new Error('Unexpected workflow from a saved-data journey action.')),
  );
  const research = new ResearchFixture();
  const discover = vi.spyOn(research, 'discover');
  const store: WorkspaceStore = {
    load: () => Promise.resolve(structuredClone(state)),
    save,
    initialize: () => Promise.resolve(),
    enqueue,
    listJobs: () => Promise.resolve(structuredClone(jobs)),
    claimJob: () => Promise.resolve(null),
    finishJob: () => Promise.resolve(),
    failJob: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const service = new WorkspaceService(store, research, fixtureEvaluationProvider);
  const preparation = () => {
    if (!state.preparation) throw new Error('Missing fixture preparation');
    return state.preparation;
  };
  const journey = () => {
    const saved = preparation().journey;
    if (!saved) throw new Error('Missing fixture journey');
    return saved;
  };
  const investorId = (index = 0) => {
    const id = investorIds[index];
    if (!id) throw new Error('Missing fixture investor');
    return id;
  };
  const confirm = async (round = 'Seed') =>
    service.preparation.confirmGoal(
      preparationGoalInputSchema.parse({
        round,
        previousRounds: 0,
        amount: '1000000',
        currency: 'CAD',
        targetDate: null,
        timezone: 'UTC',
        investorId: null,
        desiredCheck: { min: '100000', max: '500000', currency: 'CAD' },
      }),
      state.preparation?.version ?? 0,
      true,
    );
  const command = async (input: JourneyAction<JourneyCommand>) => {
    const current = await service.journey.view();
    return service.journey.command({
      ...input,
      key: randomUUID(),
      revision: current.revision,
      ...(current.journey ? { journeyId: current.journey.id } : {}),
    });
  };
  const prepare = async (input: PreparationAction<ConnectedPreparationCommand>) =>
    service.connected.command({
      ...input,
      key: randomUUID(),
      version: (await service.connected.view()).version,
    });
  const assess = async (index = 0) => {
    await command({ action: 'assess', investorId: investorId(index) });
    const assessment = journey().assessments.findLast(
      (value) => value.investorId === investorId(index),
    );
    if (!assessment) throw new Error('Missing fixture assessment');
    return assessment;
  };
  const shortlist = async (index = 0, included = true) => {
    const assessment = await assess(index);
    await command({
      action: 'shortlist',
      investorId: investorId(index),
      assessmentId: assessment.id,
      rationale:
        'Fictional explicit override: investigate this investor despite unverified mandate.',
      included,
    });
    const target = journey().targets.find((value) => value.investorId === investorId(index));
    if (!target) throw new Error('Missing fixture target');
    return target;
  };
  const addMandate = async (index = 0) =>
    service.change((current) => {
      const investor = current.investors.find((value) => value.id === investorId(index));
      const record = current.evidence.find((value) => value.id === investor?.discoveryEvidenceId);
      if (!investor || !record) throw new Error('Missing source fixture');
      const source: Evidence = {
        ...record,
        id: `fictional-mandate-${index}`,
        eventKey: `fictional-mandate-${index}`,
        title: 'Fictional current mandate',
        mandateFacts: [],
      };
      source.mandateFacts = (['stage', 'sector', 'geography', 'check_size'] as const).map(
        (criterion) =>
          investorMandateFactSchema.parse({
            id: `${source.id}-${criterion}`,
            criterion,
            scope: 'stated_mandate',
            subjectKey: investor.key,
            attribution: 'explicit',
            stance: 'includes',
            exhaustive: true,
            values:
              criterion === 'stage'
                ? ['Seed']
                : criterion === 'sector'
                  ? ['B2B SaaS']
                  : criterion === 'geography'
                    ? ['Canada']
                    : [],
            checkRange:
              criterion === 'check_size' ? { min: '100000', max: '500000', currency: 'CAD' } : null,
            preferenceKey: null,
            validFrom: null,
            validUntil: null,
            supersedesFactIds: [],
            source: {
              evidenceId: source.id,
              researchRunId: null,
              url: source.url,
              quote: 'Fictional explicitly supported mandate.',
              publishedAt: null,
              retrievedAt: source.discoveredAt,
              fictional: true,
            },
          }),
      );
      current.evidence.push(source);
      investor.checks.push({
        jobId: randomUUID(),
        mode: 'demo',
        checkedAt: new Date().toISOString(),
        profileVersion: current.profile.version,
        evidenceIds: [source.id],
        addedIds: [source.id],
        changedIds: [],
        note: 'Fictional source intake.',
      });
    });
  const addPractice = async (targetId: string) => {
    const cycle = activePreparationCycle(state, targetId);
    if (!cycle?.investorId) throw new Error('Missing prepared target cycle');
    const input = assembleScenarioInput(
      state,
      cycle.investorId,
      'Fictional preparation practice',
      cycle.id,
    );
    const output = await new DemoScenarioGenerator().generate(input);
    const scenario = output.scenarios[0];
    if (!scenario) throw new Error('Missing fictional scenario');
    const evaluation = structuredClone(preparationFixture().evaluation);
    evaluation.id = randomUUID();
    evaluation.status = 'completed';
    evaluation.scope = 'complete';
    if (!evaluation.report) throw new Error('Missing fictional report');
    evaluation.report.coaching.items = [];
    evaluation.report.checks = [];
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
      instruction: 'Fictional practice fixture.',
    });
    const session = rehearsalSchema.parse({
      id: randomUUID(),
      briefId: null,
      mode: 'text',
      status: 'completed',
      createdAt: new Date().toISOString(),
      conversationId: null,
      turns: [
        { role: 'agent', text: 'Explain the fictional business.' },
        { role: 'user', text: 'Fictional saved practice answer.' },
      ],
      review: null,
      context,
      evaluationContext: preparationFixture().session.evaluationContext,
      evaluations: [{ ...evaluation, status: 'queued', completedAt: null, report: null }],
    });
    await service.change((current) => current.rehearsals.push(session));
    return { session, evaluation };
  };
  return {
    service,
    state: () => state,
    journey,
    preparation,
    save,
    enqueue,
    discover,
    investorId,
    historicalSessionId,
    confirm,
    command,
    prepare,
    assess,
    shortlist,
    addMandate,
    addPractice,
  };
}

describe('Goal-led investor journey and durable progress', () => {
  it('keeps worker preparation drafts JSON-safe when investor sources have no archive ID', async () => {
    const f = fixture();
    await f.confirm();
    await f.shortlist();
    await f.service.preparation.reconcile(true);
    expect(z.json().safeParse(f.preparation().plans).success).toBe(true);
  });

  it('saves the simple goal and optional funding details in one versioned change', async () => {
    const f = fixture();
    await f.confirm();
    const target = await f.shortlist();
    const prior = structuredClone(f.journey().events);
    const journeyId = f.journey().id;
    const view = await f.service.preparation.view();
    const profileVersion = f.state().profile.version;
    const details = preparationGoalInputSchema.parse({
      round: 'Seed',
      previousRounds: 0,
      amount: '1500000',
      currency: 'CAD',
      desiredCheck: { min: '150000', max: '300000', currency: 'CAD' },
      targetDate: '2026-12-01',
      timezone: 'America/Toronto',
      investorId: null,
    });
    const saves = f.save.mock.calls.length;
    await f.service.preparation.setIntent(
      'Fictional updated fundraising goal',
      view.version,
      profileVersion,
      details,
    );
    expect(f.save).toHaveBeenCalledTimes(saves + 1);
    expect(f.state().profile.goal).toBe('Fictional updated fundraising goal');
    expect(f.preparation().goals.at(-1)).toMatchObject({
      ...details,
      objective: 'Fictional updated fundraising goal',
    });
    expect(f.journey().id).toBe(journeyId);
    expect(f.journey().targets[0]?.id).toBe(target.id);
    expect(f.journey().events.slice(0, prior.length)).toEqual(prior);
    const current = structuredClone(f.state());
    await expect(
      f.service.preparation.setIntent('Stale edit', view.version, profileVersion, details),
    ).rejects.toThrow(ConflictError);
    expect(f.state()).toEqual(current);
    await expect(
      f.service.preparation.setIntent(
        'Invalid amount',
        f.preparation().version,
        f.state().profile.version,
        { ...details, amount: '0' },
      ),
    ).rejects.toThrow('positive');
    expect(f.state()).toEqual(current);
  });

  it('keeps reads pure before activation and captures only one current baseline after goal confirmation', async () => {
    const f = fixture();
    const original = structuredClone(f.state());
    expect((await f.service.journey.view()).journey).toBeNull();
    expect(f.state()).toEqual(original);
    expect(f.save).not.toHaveBeenCalled();
    await f.confirm();
    const baseline = structuredClone(f.journey().events);
    expect(baseline).toHaveLength(1);
    expect(baseline[0]?.reason).toContain('earlier graph history is unavailable');
    expect(baseline[0]?.position).toMatchObject({ completed: 0, required: 6 });
    expect(baseline[0]?.position.tracks).toEqual([]);
    const stored = structuredClone(f.state());
    const saveCalls = f.save.mock.calls.length;
    await f.service.journey.view();
    await f.service.journey.view();
    await f.service.journey.events(f.journey().id, goalProgressQuerySchema.parse({}));
    expect(f.state()).toEqual(stored);
    expect(f.save).toHaveBeenCalledTimes(saveCalls);
    await f.command({ action: 'activate' });
    expect(f.journey().events).toEqual(baseline);
    expect(f.state().rehearsals.some((session) => session.id === f.historicalSessionId)).toBe(true);
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it('preserves stable journey identity across goal revisions while retaining exact historical goal versions', async () => {
    const f = fixture();
    await f.confirm();
    const id = f.journey().id;
    const firstGoalId = f.journey().currentGoalId;
    const baseline = structuredClone(f.journey().events[0]);
    await f.confirm('Series A');
    expect(f.journey().id).toBe(id);
    expect(f.journey().currentGoalId).not.toBe(firstGoalId);
    expect(f.journey().events[0]).toEqual(baseline);
    expect(f.preparation().goals.map((goal) => goal.id)).toContain(firstGoalId);
    expect(f.journey().events.at(-1)?.reason).toContain('Goal revised');
  });

  it('starts a distinct objective once and preserves replay receipts across the journey boundary', async () => {
    const f = fixture();
    await f.confirm();
    await f.shortlist();
    const prior = structuredClone(f.journey());
    const request: JourneyCommand = {
      action: 'new_goal',
      key: randomUUID(),
      revision: prior.revision,
      journeyId: prior.id,
    };
    await f.service.journey.command(request);
    const replacementId = f.journey().id;
    expect(replacementId).not.toBe(prior.id);
    expect(
      f.preparation().journeyHistory?.find((journey) => journey.id === prior.id)?.events,
    ).toEqual(prior.events);
    const archived = f.preparation().journeyHistory?.find((journey) => journey.id === prior.id);
    expect(archived?.targets).toEqual(prior.targets);
    expect(archived?.assessments).toEqual(prior.assessments);
    expect(archived?.scopes).toEqual(prior.scopes);
    expect(f.state().rehearsals.some((session) => session.id === f.historicalSessionId)).toBe(true);
    await f.service.journey.command(request);
    expect(f.journey().id).toBe(replacementId);
    expect(f.preparation().journeyHistory).toHaveLength(1);
    expect(f.journey().events).toHaveLength(1);
  });

  it('rejects commands for an archived journey even when its stale revision collides with the current revision', async () => {
    const f = fixture();
    await f.confirm();
    const archivedId = f.journey().id;
    await f.command({ action: 'new_goal' });
    const snapshot = structuredClone(f.state());
    const saves = f.save.mock.calls.length;
    await expect(
      f.service.journey.command({
        action: 'assess',
        key: randomUUID(),
        journeyId: archivedId,
        revision: f.journey().revision,
        investorId: f.investorId(),
      }),
    ).rejects.toThrow('active goal changed');
    expect(f.state()).toEqual(snapshot);
    expect(f.save).toHaveBeenCalledTimes(saves);
    expect(f.journey().assessments).toEqual([]);
  });

  it('shortlists an unknown match only with the founder rationale and keeps monitoring paused', async () => {
    const f = fixture();
    await f.confirm();
    const assessment = await f.assess();
    expect(assessment.assessment.status).toBe('needs_verification');
    expect(assessment.assessment.score).toBeNull();
    const target = await f.shortlist();
    expect(target.rationale).toContain('explicit override');
    expect(target.assessmentId).toBe(assessment.id);
    expect(f.state().investors.find((value) => value.id === f.investorId())?.frequency).toBe(
      'paused',
    );
    expect((await f.service.journey.view()).position?.nextAction).toContain('company story');
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(f.discover).not.toHaveBeenCalled();
    await expect(
      f.command({
        action: 'shortlist',
        investorId: f.investorId(1),
        rationale: ' ',
        included: true,
      }),
    ).rejects.toThrow();
  });

  it('saves a sourced score and keeps the exact assessment snapshot after goal inputs change', async () => {
    const f = fixture();
    await f.confirm();
    await f.addMandate();
    const assessment = await f.assess();
    expect(assessment.assessment.score).toBe('10.0');
    const snapshot = structuredClone(assessment);
    await f.command({
      action: 'shortlist',
      investorId: f.investorId(),
      assessmentId: assessment.id,
      rationale: 'Fictional reviewed match.',
      included: true,
    });
    await f.confirm('Series A');
    const target = (await f.service.journey.view()).targets[0];
    expect(target?.matchOutdated).toBe(true);
    expect(target?.assessment).toEqual(snapshot);
    await expect(
      f.command({
        action: 'shortlist',
        investorId: f.investorId(),
        assessmentId: assessment.id,
        rationale: 'Fictional stale selection attempt.',
        included: true,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('marks an assessment stale after a new relevant source without rewriting the prior evidence', async () => {
    const f = fixture();
    await f.confirm();
    const target = await f.shortlist();
    const priorAssessment = structuredClone(f.journey().assessments[0]);
    const priorEvidence = structuredClone(f.state().evidence);
    await f.addMandate();
    expect(
      (await f.service.journey.view()).targets.find((value) => value.id === target.id)
        ?.matchOutdated,
    ).toBe(true);
    expect(f.journey().assessments[0]).toEqual(priorAssessment);
    for (const record of priorEvidence)
      expect(f.state().evidence.find((value) => value.id === record.id)).toEqual(record);
  });

  it('deduplicates targets and payload-bound request replay before checking stale revisions', async () => {
    const f = fixture();
    await f.confirm();
    const assessment = await f.assess();
    const request: JourneyCommand = {
      action: 'shortlist',
      key: randomUUID(),
      revision: f.journey().revision,
      journeyId: f.journey().id,
      investorId: f.investorId(),
      assessmentId: assessment.id,
      rationale: 'Fictional explicit unknown-match override.',
      included: true,
    };
    await f.service.journey.command(request);
    const targetId = f.journey().targets[0]?.id;
    const eventCount = f.journey().events.length;
    await f.service.journey.command(request);
    expect(f.journey().targets).toHaveLength(1);
    expect(f.journey().targets[0]?.id).toBe(targetId);
    expect(f.journey().events).toHaveLength(eventCount);
    await f.command({
      action: 'shortlist',
      investorId: f.investorId(),
      assessmentId: assessment.id,
      rationale: request.rationale,
      included: true,
    });
    expect(f.journey().targets).toHaveLength(1);
    await expect(
      f.service.journey.command({ ...request, rationale: 'Different payload under the same key.' }),
    ).rejects.toThrow(ConflictError);
  });

  it('preserves two investor tracks and does not add graph observations on focus or unrelated reads', async () => {
    const f = fixture();
    await f.confirm();
    await f.prepare({ action: 'start' });
    await f.prepare({ action: 'approve_pitch' });
    const first = await f.shortlist();
    const second = await f.shortlist(1);
    const firstCycle = structuredClone(activePreparationCycle(f.state(), first.id));
    const secondCycle = structuredClone(activePreparationCycle(f.state(), second.id));
    expect(firstCycle?.id).not.toBe(secondCycle?.id);
    const eventCount = f.journey().events.length;
    await f.command({ action: 'focus', targetId: first.id });
    await f.command({ action: 'focus', targetId: second.id });
    await f.service.journey.view();
    expect(f.journey().events).toHaveLength(eventCount);
    expect(activePreparationCycle(f.state(), first.id)).toEqual(firstCycle);
    expect(activePreparationCycle(f.state(), second.id)).toEqual(secondCycle);
    expect((await f.service.journey.view()).position?.required).toBe(11);
  });

  it('separates target membership from scope inclusion and keeps old denominators after archiving', async () => {
    const f = fixture();
    await f.confirm();
    const first = await f.shortlist();
    const second = await f.shortlist(1, false);
    expect(f.journey().targets).toHaveLength(2);
    expect((await f.service.journey.view()).position?.required).toBe(6);
    await f.command({ action: 'include', targetId: second.id });
    const old = structuredClone(f.journey().events.at(-1));
    expect(old?.position.required).toBe(11);
    await f.command({ action: 'archive', targetId: first.id });
    expect((await f.service.journey.view()).position?.required).toBe(6);
    expect(f.journey().events.find((event) => event.id === old?.id)).toEqual(old);
    expect(f.journey().events.at(-1)?.reason).toContain('not an improvement');
    expect(f.journey().targets.find((value) => value.id === first.id)?.status).toBe('archived');
    expect(
      f
        .journey()
        .scopes.some(
          (scope) => scope.targetIds.includes(first.id) && scope.targetIds.includes(second.id),
        ),
    ).toBe(true);
  });

  it('resumes the same archived target when its investor conversation is selected again', async () => {
    const f = fixture();
    await f.confirm();
    const target = await f.shortlist();
    const journeyId = f.journey().id;
    const goalId = f.preparation().goals.at(-1)?.id;
    await f.command({ action: 'archive', targetId: target.id });
    const archivedPoint = structuredClone(f.journey().events.at(-1));
    await f.service.updateInvestorMeeting({
      name: '',
      firm: 'Fictional investor 1',
      date: null,
      notes: 'Fictional conversation selected again.',
      links: { linkedin: null, x: null, website: 'https://fictional-investor-0.example/' },
    });
    expect(f.journey().id).toBe(journeyId);
    expect(f.preparation().goals.at(-1)?.id).toBe(goalId);
    expect(f.journey().targets).toHaveLength(1);
    expect(f.journey().targets[0]).toMatchObject({ id: target.id, status: 'active' });
    expect(f.journey().focusedTargetId).toBe(target.id);
    expect(f.journey().events.find((event) => event.id === archivedPoint?.id)).toEqual(
      archivedPoint,
    );
    expect(
      f.state().investors.find((investor) => investor.id === target.investorId)?.frequency,
    ).toBe('paused');
  });

  it('keeps a fixed history boundary while newer observations are appended', async () => {
    const f = fixture();
    await f.confirm();
    await f.shortlist();
    const firstPage = await f.service.journey.events(
      f.journey().id,
      goalProgressQuerySchema.parse({ limit: 1 }),
    );
    await f.shortlist(1);
    const older = await f.service.journey.events(
      f.journey().id,
      goalProgressQuerySchema.parse({
        limit: 100,
        beforeSequence: firstPage.beforeSequence,
        cursor: firstPage.nextCursor ?? undefined,
      }),
    );
    expect(older.items.every((event) => event.sequence <= firstPage.beforeSequence)).toBe(true);
    expect(older.items.some((event) => event.sequence > firstPage.beforeSequence)).toBe(false);
    expect(older.items.map((event) => event.sequence)).toEqual(
      [...older.items.map((event) => event.sequence)].sort((a, b) => b - a),
    );
  });

  it('records linked practice, assessment availability, founder review, and completion separately', async () => {
    const f = fixture();
    await f.confirm();
    await f.prepare({ action: 'start' });
    await f.prepare({ action: 'approve_pitch' });
    const target = await f.shortlist();
    await f.prepare({ action: 'approve_brief', targetId: target.id });
    const beforePractice = (await f.service.journey.view()).position?.completed;
    const { session, evaluation } = await f.addPractice(target.id);
    const pending = await f.service.journey.view();
    expect(pending.position?.readiness).toBe('assessment_pending');
    expect(pending.position?.completed).toBe((beforePractice ?? 0) + 1);
    expect(pending.targets[0]?.track?.steps.find((step) => step.id === 'feedback')?.complete).toBe(
      false,
    );
    const practicePoint = structuredClone(f.journey().events.at(-1));
    await f.service.change((current) => {
      const stored = current.rehearsals.find((value) => value.id === session.id);
      if (!stored) throw new Error('Missing practice fixture');
      stored.evaluations = [evaluation];
    });
    const assessed = await f.service.journey.view();
    expect(assessed.position?.completed).toBe(pending.position?.completed);
    expect(assessed.targets[0]?.track?.steps.find((step) => step.id === 'feedback')?.status).toBe(
      'needs_review',
    );
    expect(assessed.targets[0]?.track?.evaluationId).toBe(evaluation.id);
    expect(f.journey().events.at(-1)?.id).not.toBe(practicePoint?.id);
    await f.prepare({
      action: 'review_feedback',
      targetId: target.id,
      sessionId: session.id,
      evaluationId: evaluation.id,
    });
    const reviewed = await f.service.journey.view();
    expect(reviewed.targets[0]?.track?.steps.find((step) => step.id === 'feedback')?.complete).toBe(
      true,
    );
    expect(reviewed.targets[0]?.track?.steps.find((step) => step.id === 'revision')?.complete).toBe(
      false,
    );
    await f.prepare({ action: 'finish_cycle', targetId: target.id });
    const complete = await f.service.journey.view();
    expect(complete.position).toMatchObject({
      completed: 6,
      required: 6,
      percentage: '100.0',
      readiness: 'preparation_reviewed',
    });
    expect(complete.targets[0]?.track).toMatchObject({
      sessionId: session.id,
      evaluationId: evaluation.id,
    });
    expect(f.journey().events.find((event) => event.id === practicePoint?.id)).toEqual(
      practicePoint,
    );
    expect(projectGoalPosition(f.state())?.completed).toBe(complete.position?.completed);
  });
});
