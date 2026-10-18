import { randomUUID } from 'node:crypto';
import type { WorkspaceService } from './WorkspaceService.js';
import type { Workspace, Job } from '../contracts/Workspace.js';
import { rehearsalSchema } from '../contracts/Workspace.js';
import { preparationStateSchema } from '../contracts/FundraisingPreparation.js';
import { goalInvestorTargetSchema } from '../contracts/GoalJourney.js';
import { updateGoalScope } from './GoalProgress.js';
import {
  connectedPreparationCommandSchema,
  connectedPreparationStateSchema,
  connectedPreparationViewSchema,
  type ConnectedPreparationCommand,
  type PreparationCycle,
  type ConnectedPitch,
} from '../contracts/ConnectedPreparation.js';
import {
  connectedHash,
  connectedSourceHash,
  connectedInvestorHash,
  cycleOutdated,
  investorSources,
  preparationRecommendations,
  preparedPitchContext,
  assertCurrentPreparedPractice,
  latestLoopReview,
  connectedSteps,
  activePreparationCycle,
  currentPreparationCycleById,
  preparationMatchOutdated,
} from './ConnectedPreparation.js';
import { buildPreparationPlan } from './PreparationPlanner.js';
import { ConflictError } from './WorkspaceStore.js';
import { assembleEvaluationContext } from './EvaluationContextAssembler.js';
import { queueEvaluation } from './RehearsalEvaluationService.js';

const emptyState = () =>
  connectedPreparationStateSchema.parse({ version: 0, pitches: [], cycles: [], commands: [] });
function connected(state: Workspace) {
  state.preparation ??= preparationStateSchema.parse({});
  return (state.preparation.connected ??= emptyState());
}
function currentCycle(state: Workspace, targetId?: string) {
  const cycle = activePreparationCycle(state, targetId);
  if (!cycle || cycle.closedAt || cycleOutdated(state, cycle))
    throw new ConflictError('Preparation changed or cycle ended. Refresh before continuing.');
  return cycle;
}
function addCycle(
  state: Workspace,
  pitch: ConnectedPitch,
  now: string,
  previous?: PreparationCycle,
  keepApproval = false,
  targetId?: string,
) {
  const goal = state.preparation?.goals.at(-1);
  if (!goal) throw new ConflictError('Confirm a preparation goal first.');
  const journey = state.preparation?.journey;
  const resolvedTargetId = targetId ?? previous?.targetId;
  const target = resolvedTargetId
    ? journey?.targets.find((item) => item.id === resolvedTargetId)
    : null;
  if (resolvedTargetId && (!target || target.status !== 'active'))
    throw new ConflictError('Target unavailable. Open an active target before preparing.');
  const cycle: PreparationCycle = {
    ...(journey ? { journeyId: journey.id, scopeVersionId: journey.scopes.at(-1)?.id } : {}),
    ...(target ? { targetId: target.id } : {}),
    ...(target?.assessmentId ? { assessmentId: target.assessmentId } : {}),
    id: randomUUID(),
    goalId: goal.id,
    sourceHash: connectedSourceHash(state),
    pitchId: pitch.id,
    pitchApprovedAt: keepApproval ? now : null,
    investorId: target?.investorId ?? previous?.investorId ?? (journey ? null : goal.investorId),
    investorSourceHash: null,
    brief: null,
    briefApprovedAt: null,
    generationId: null,
    feedback: null,
    proposal: null,
    processedEvaluationId: null,
    outcome: null,
    createdAt: now,
    closedAt: null,
  };
  if (cycle.investorId && state.investors.some((i) => i.id === cycle.investorId))
    cycle.investorSourceHash = connectedInvestorHash(state, cycle.investorId);
  else cycle.investorId = null;
  connected(state).cycles.push(cycle);
  return cycle;
}
function initialPitch(state: Workspace, now: string) {
  const goal = state.preparation?.goals.at(-1);
  if (!goal) throw new ConflictError('Confirm a preparation goal first.');
  if (state.preparation?.journey) {
    const current = connected(state).pitches.findLast(
      (pitch) => pitch.scope !== 'target' && pitch.sourceHash === connectedSourceHash(state),
    );
    if (current) return current;
  }
  const artifact = buildPreparationPlan(state, goal, now).artifacts.find(
    (a) => a.kind === 'financial',
  );
  if (!artifact)
    throw new ConflictError('Select a financial statement before starting preparation.');
  const pitch: ConnectedPitch = {
    ...(state.preparation?.journey ? { scope: 'shared' as const } : {}),
    revision: connected(state).pitches.length + 1,
    id: randomUUID(),
    parentId: null,
    text: artifact.narrative,
    reason: artifact.why,
    sourceHash: connectedSourceHash(state),
    sources: artifact.sources,
    fictional: artifact.fictional,
    createdAt: now,
  };
  connected(state).pitches.push(pitch);
  return pitch;
}
function buildBrief(state: Workspace, cycle: PreparationCycle) {
  const goal = state.preparation?.goals.at(-1);
  const investor = state.investors.find((i) => i.id === cycle.investorId);
  const pitch = connected(state).pitches.find((p) => p.id === cycle.pitchId);
  if (!goal || !investor || !pitch || !cycle.pitchApprovedAt)
    throw new ConflictError('Approve the story and select a saved investor first.');
  cycle.briefApprovedAt = null;
  const observations = investorSources(state, investor.id);
  const focus = observations
    .map((s) => `${s.title}: ${s.excerpt}`)
    .join('\n')
    .slice(0, 1000);
  const match = state.preparation?.journey?.assessments.find(
    (item) => item.id === cycle.assessmentId,
  )?.assessment;
  const desiredCheck = goal.desiredCheck;
  cycle.brief = cycle.journeyId
    ? [
        `Prepare for ${investor.name} for ${goal.round}. ${pitch.fictional || observations.some((source) => source.mode === 'demo') ? 'Includes fictional demo evidence.' : ''}`,
        `Company objective: ${state.profile.goal.slice(0, 250) || 'Not confirmed.'} ${desiredCheck ? `Desired individual check: ${desiredCheck.currency} ${desiredCheck.min}–${desiredCheck.max}.` : 'Desired individual check size is unconfirmed.'}`,
        `Approved company story (revision ${pitch.revision}; full text retained with the brief):\n${pitch.text.slice(0, 1000)}`,
        match
          ? `Why this audience: ${match.status === 'scored' ? `${match.score}/10 match with ${match.coverage} weighted evidence coverage.` : 'Eligibility needs verification; selection is a founder decision.'} ${match.criteria
              .map((item) => `${item.criterion}: ${item.reason}`)
              .join(' ')
              .slice(0, 450)}`
          : 'Why this audience: selected by the founder. No reviewed match assessment establishes current mandate or eligibility.',
        focus
          ? `Saved public-source context (unverified):\n${focus.slice(0, 550)}`
          : 'No saved investor research is available; use limited-context preparation.',
        `Preparation hypotheses: explain use of funds, individual participation, and financial evidence. Questions to ask: confirm current mandate, check range, and decision process. ${match?.unknowns.join(' ').slice(0, 200) ?? ''} Historical activity does not establish eligibility. Cash runway is not established by the income statement.`,
      ]
        .join('\n\n')
        .slice(0, 3000)
    : `Prepare for ${investor.name} for ${goal.round}. ${goal.previousRounds === null ? 'Prior financing is unconfirmed.' : `The founder confirmed ${goal.previousRounds} previous financing round(s).`}\n\n${pitch.text}\n\n${focus ? `Saved public-source context (unverified):\n${focus}` : 'No saved investor research is available; use limited-context preparation.'}\n\nAsk about current mandate, individual participation and evidence requirements. Historical activity does not establish eligibility. Cash runway is not established by the income statement.`.slice(
        0,
        3000,
      );
  cycle.investorSourceHash = connectedInvestorHash(state, investor.id);
  if (cycle.journeyId) {
    const id = randomUUID();
    connected(state).briefVersions.push({
      id,
      cycleId: cycle.id,
      goalId: cycle.goalId,
      snapshotId: state.onboarding.snapshotId,
      ...(cycle.scopeVersionId ? { scopeVersionId: cycle.scopeVersionId } : {}),
      journeyId: cycle.journeyId,
      ...(cycle.targetId ? { targetId: cycle.targetId } : {}),
      ...(cycle.assessmentId ? { assessmentId: cycle.assessmentId } : {}),
      pitchId: pitch.id,
      sourceHash: cycle.sourceHash,
      investorSourceHash: cycle.investorSourceHash,
      text: cycle.brief,
      sources: [
        ...pitch.sources,
        ...observations.map((source) => ({
          id: source.id,
          title: source.title.slice(0, 500),
          excerpt: source.excerpt.slice(0, 16000),
          url: source.url,
          recordedAt: source.discoveredAt,
          fictional: source.mode === 'demo',
        })),
      ],
      fictional: pitch.fictional || observations.some((source) => source.mode === 'demo'),
      createdAt: new Date().toISOString(),
    });
    cycle.briefVersionId = id;
  }
}

/** Provision a target locally without requiring shortlisting to wait for story approval. */
export function ensureTargetPreparation(
  state: Workspace,
  targetId: string,
  investorId: string,
  now = new Date().toISOString(),
): PreparationCycle | null {
  const target = state.preparation?.journey?.targets.find((item) => item.id === targetId);
  if (!target || target.status !== 'active' || target.investorId !== investorId)
    throw new ConflictError('Target investor unavailable.');
  const saved = connected(state);
  const existing = activePreparationCycle(state, targetId);
  if (preparationMatchOutdated(state, target.assessmentId ?? undefined)) return existing ?? null;
  if (
    existing &&
    !cycleOutdated(state, existing) &&
    (existing.pitchApprovedAt || existing.closedAt)
  )
    return existing;
  const sourceHash = connectedSourceHash(state);
  const latestShared = saved.pitches.findLast(
    (pitch) => pitch.scope !== 'target' && pitch.sourceHash === sourceHash,
  );
  const approved = [...saved.cycles]
    .reverse()
    .find(
      (cycle) =>
        !!cycle.pitchApprovedAt &&
        cycle.sourceHash === sourceHash &&
        cycle.pitchId === latestShared?.id,
    );
  const priorPitch = saved.pitches.find((item) => item.id === existing?.pitchId);
  const pitch =
    existing?.pitchApprovedAt &&
    existing.outcome !== 'superseded' &&
    existing.sourceHash === sourceHash &&
    priorPitch?.scope === 'target'
      ? priorPitch
      : saved.pitches.find((item) => item.id === approved?.pitchId);
  if (!pitch) return existing && !cycleOutdated(state, existing) ? existing : null;
  if (existing && !existing.closedAt) {
    existing.closedAt = now;
    existing.outcome = 'superseded';
  }
  const cycle = addCycle(state, pitch, now, undefined, true, targetId);
  buildBrief(state, cycle);
  saved.version++;
  if (state.preparation) state.preparation.version++;
  return cycle;
}

function supersedeSharedDependents(state: Workspace, now: string) {
  for (const cycle of connected(state).cycles) {
    if (cycle.closedAt) continue;
    cycle.closedAt = now;
    cycle.outcome = 'superseded';
  }
}
function prepareProposal(state: Workspace, jobs: Job[], cycle: PreparationCycle | undefined) {
  if (!cycle || cycle.closedAt || cycleOutdated(state, cycle)) return false;
  const review = latestLoopReview(state, cycle, jobs);
  if (!review?.report || !review.evaluation || cycle.processedEvaluationId === review.evaluation.id)
    return false;
  const pitch = connected(state).pitches.find((p) => p.id === cycle.pitchId);
  if (!pitch) return false;
  const items = review.report.coaching.items;
  cycle.processedEvaluationId = review.evaluation.id;
  if (review.public.hasGaps) {
    cycle.proposal = {
      sessionId: review.session.id,
      evaluationId: review.evaluation.id,
      basePitchId: pitch.id,
      text: items[0]?.exampleAnswer.trim() || pitch.text,
      reasons: items.length
        ? items.map((i) => `${i.gap}\n${i.suggestion}`.slice(0, 3000))
        : [
            'Some claims remain unsupported or unchecked. Review the saved checks and edit the draft; no improved wording has been inferred.',
          ],
      itemIds: items.map((i) => i.id),
    };
  } else cycle.proposal = null;
  return true;
}
export class ConnectedPreparationService {
  constructor(private readonly service: WorkspaceService) {}
  async view(targetId?: string, cycleId?: string) {
    const [state, jobs] = await Promise.all([this.service.read(), this.service.store.listJobs()]);
    const saved = state.preparation?.connected;
    const journey = state.preparation?.journey;
    const archivedJourney = targetId
      ? state.preparation?.journeyHistory?.find((item) =>
          item.targets.some((target) => target.id === targetId),
        )
      : null;
    const currentTarget = targetId ? journey?.targets.find((item) => item.id === targetId) : null;
    const requestedHistory = cycleId ? saved?.cycles.find((item) => item.id === cycleId) : null;
    if (cycleId && (!requestedHistory || (targetId && requestedHistory.targetId !== targetId)))
      throw new ConflictError('Preparation history unavailable for this target.');
    const historical =
      (!!archivedJourney && !currentTarget) || currentTarget?.status === 'archived';
    const historicalJourney =
      archivedJourney ?? (currentTarget?.status === 'archived' ? journey : null);
    if (
      targetId &&
      (!currentTarget || historical) &&
      !(
        historical &&
        requestedHistory?.targetId === targetId &&
        requestedHistory.journeyId === historicalJourney?.id
      )
    )
      throw new ConflictError(
        'Target unavailable. Open its exact saved history to inspect an archived goal.',
      );
    const cycle = historical ? null : (activePreparationCycle(state, targetId) ?? null);
    const trackCycles =
      saved?.cycles.filter((item) =>
        targetId
          ? item.targetId === targetId
          : cycle?.targetId
            ? item.targetId === cycle.targetId
            : !item.targetId,
      ) ?? [];
    const recentHistory = trackCycles.slice(-10).reverse();
    const history =
      requestedHistory && !recentHistory.some((item) => item.id === requestedHistory.id)
        ? [requestedHistory, ...recentHistory.slice(0, 9)]
        : recentHistory;
    const generation =
      cycle?.generationId && this.service.scenarios
        ? await this.service.scenarios.store.getGeneration(cycle.generationId)
        : null;
    const publicGeneration = generation
      ? {
          id: generation.id,
          status: generation.status,
          error: generation.error,
          scenarios:
            generation.output?.scenarios.map(({ id, title, objective }) => ({
              id,
              title,
              objective,
            })) ?? [],
        }
      : null;
    return connectedPreparationViewSchema.parse({
      version: saved?.version ?? 0,
      journeyId: historical ? (historicalJourney?.id ?? null) : (journey?.id ?? null),
      historical,
      goalId: historical ? null : (cycle?.goalId ?? state.preparation?.goals.at(-1)?.id ?? null),
      cycle,
      pitch: saved?.pitches.find((p) => p.id === cycle?.pitchId) ?? null,
      outdated: !!cycle && cycleOutdated(state, cycle),
      paused: !state.preparation?.automatic,
      steps: connectedSteps(state, jobs, publicGeneration, targetId),
      recommendations: preparationRecommendations(state),
      latestSession: cycle ? (latestLoopReview(state, cycle, jobs)?.public ?? null) : null,
      generation: publicGeneration,
      history,
      briefVersions:
        saved?.briefVersions
          .filter((brief) => history.some((item) => item.briefVersionId === brief.id))
          .slice(-10) ?? [],
      historyPitches:
        saved?.pitches.filter((p) => history.some((c) => c.pitchId === p.id)).slice(-10) ?? [],
      cycleNumber: trackCycles.length,
      completedCycles: trackCycles.filter((c) => c.closedAt && c.outcome !== 'superseded').length,
    });
  }
  async command(raw: ConnectedPreparationCommand) {
    const command = connectedPreparationCommandSchema.parse(raw);
    const hash = connectedHash(command);
    const jobs = await this.service.store.listJobs();
    await this.service.change((state) => {
      const saved = connected(state);
      if (command.journeyId && command.journeyId !== state.preparation?.journey?.id)
        throw new ConflictError(
          'The active fundraising goal changed. Reopen this preparation track.',
        );
      const replay = saved.commands.find((c) => c.key === command.key);
      if (replay) {
        if (replay.hash !== hash) throw new ConflictError('Request key reused.');
        return;
      }
      if (saved.version !== command.version)
        throw new ConflictError('Preparation changed. Refresh before saving.');
      const now = new Date().toISOString();
      const targetId = command.targetId ?? state.preparation?.journey?.focusedTargetId ?? undefined;
      const target = targetId
        ? state.preparation?.journey?.targets.find((item) => item.id === targetId)
        : null;
      if (targetId && (!target || target.status !== 'active'))
        throw new ConflictError('Target unavailable. Open an active target before preparing.');
      let cycle = activePreparationCycle(state, targetId);
      if (command.action === 'start' || command.action === 'refresh') {
        if (target && preparationMatchOutdated(state, target.assessmentId ?? undefined))
          throw new ConflictError(
            'Review the current investor match before refreshing preparation.',
          );
        if (cycle && !cycle.closedAt && !cycleOutdated(state, cycle))
          throw new ConflictError('A current cycle already exists. Continue its next action.');
        if (cycle && !cycle.closedAt) {
          cycle.closedAt = now;
          cycle.outcome = 'superseded';
        }
        const prepared =
          targetId && target
            ? ensureTargetPreparation(state, targetId, target.investorId, now)
            : null;
        if (!prepared || prepared.closedAt)
          addCycle(state, initialPitch(state, now), now, cycle, false, targetId);
      } else if (command.action === 'repeat') {
        if (!cycle?.closedAt || cycleOutdated(state, cycle))
          throw new ConflictError('Finish the cycle or refresh changed sources first.');
        const pitch = saved.pitches.find((p) => p.id === cycle?.pitchId);
        if (!pitch) throw new ConflictError('Pitch unavailable.');
        const repeated = addCycle(state, pitch, now, cycle, !!cycle.pitchApprovedAt);
        if (repeated.pitchApprovedAt && repeated.investorId) buildBrief(state, repeated);
      } else {
        cycle = currentCycle(state, targetId);
        const pitch = saved.pitches.find((p) => p.id === cycle?.pitchId);
        if (!pitch) throw new ConflictError('Pitch unavailable.');
        switch (command.action) {
          case 'save_pitch': {
            if (command.text !== pitch.text) {
              const scope =
                command.scope ?? (cycle.targetId && cycle.pitchApprovedAt ? 'target' : 'shared');
              const edited: ConnectedPitch = {
                ...pitch,
                ...(cycle.journeyId ? { scope } : {}),
                revision: saved.pitches.length + 1,
                id: randomUUID(),
                parentId: pitch.id,
                text: command.text,
                reason: 'Founder-edited draft; approval is review, not verification of new claims.',
                createdAt: now,
              };
              delete edited.targetId;
              if (scope === 'target' && cycle.targetId) edited.targetId = cycle.targetId;
              saved.pitches.push(edited);
              if (cycle.journeyId && scope === 'shared') supersedeSharedDependents(state, now);
              cycle.closedAt = now;
              cycle.outcome = 'superseded';
              addCycle(state, edited, now, cycle);
            }
            break;
          }
          case 'approve_pitch':
            if (cycle.pitchApprovedAt) break;
            cycle.pitchApprovedAt = now;
            if (cycle.investorId) buildBrief(state, cycle);
            if (pitch.scope !== 'target') {
              for (const item of state.preparation?.journey?.targets ?? []) {
                if (item.status === 'active' && item.id !== cycle.targetId)
                  ensureTargetPreparation(state, item.id, item.investorId, now);
              }
            }
            break;
          case 'select_investor': {
            if (!cycle.pitchApprovedAt || !state.investors.some((i) => i.id === command.investorId))
              throw new ConflictError('Approve the story and select a saved investor.');
            const journey = state.preparation?.journey;
            if (journey) {
              let selected = journey.targets.find((item) => item.investorId === command.investorId);
              if (!selected) {
                selected = goalInvestorTargetSchema.parse({
                  id: randomUUID(),
                  investorId: command.investorId,
                  assessmentId: null,
                  rationale:
                    'Selected for preparation; current investor mandate requires verification.',
                  included: true,
                  status: 'active',
                  eventId: null,
                  createdAt: now,
                  updatedAt: now,
                });
                journey.targets.push(selected);
              }
              selected.status = 'active';
              selected.included = true;
              selected.updatedAt = now;
              updateGoalScope(journey, 'Investor selected for preparation.', now);
              journey.revision++;
              journey.focusedTargetId = selected.id;
              if (!cycle.targetId) {
                cycle.targetId = selected.id;
                cycle.journeyId = journey.id;
                cycle.scopeVersionId = journey.scopes.at(-1)?.id;
                if (selected.assessmentId) cycle.assessmentId = selected.assessmentId;
                else delete cycle.assessmentId;
              } else if (cycle.targetId !== selected.id) {
                const selectedCycle = activePreparationCycle(state, selected.id);
                const next =
                  selectedCycle ??
                  ensureTargetPreparation(state, selected.id, selected.investorId, now);
                if (!next)
                  throw new ConflictError(
                    'Review the shared company story for this investor first.',
                  );
                // Selecting a previously prepared target resumes its own exact state.
                if (selectedCycle) break;
                cycle = next;
              }
            }
            if (
              cycle.investorId !== command.investorId &&
              (cycle.briefApprovedAt || cycle.generationId)
            ) {
              cycle.closedAt = now;
              cycle.outcome = 'superseded';
              cycle = addCycle(state, pitch, now, cycle, true);
            }
            if (cycle.investorId === command.investorId && cycle.brief) break;
            cycle.investorId = command.investorId;
            cycle.briefApprovedAt = null;
            buildBrief(state, cycle);
            break;
          }
          case 'approve_brief':
            if (!cycle.pitchApprovedAt || !cycle.investorId || !cycle.brief)
              throw new ConflictError('Review the financial story and select an investor first.');
            cycle.briefApprovedAt = now;
            break;
          case 'review_feedback': {
            const review = latestLoopReview(state, cycle, jobs);
            if (
              !review?.report ||
              !review.evaluation ||
              review.session.id !== command.sessionId ||
              review.evaluation.id !== command.evaluationId
            )
              throw new ConflictError('A completed current assessment is required.');
            prepareProposal(state, jobs, cycle);
            cycle.feedback = { sessionId: command.sessionId, evaluationId: command.evaluationId };
            break;
          }
          case 'accept_revision':
          case 'reject_revision':
          case 'finish_cycle': {
            const review = latestLoopReview(state, cycle, jobs);
            if (
              !review?.report ||
              !review.evaluation ||
              cycle.feedback?.sessionId !== review.session.id ||
              cycle.feedback.evaluationId !== review.evaluation.id
            )
              throw new ConflictError('Review the completed current assessment first.');
            if (command.action === 'finish_cycle' && review.public.hasGaps)
              throw new ConflictError('Decide on the proposed revision; unresolved gaps remain.');
            if (
              command.action !== 'finish_cycle' &&
              (!cycle.proposal ||
                cycle.proposal.evaluationId !== review.evaluation.id ||
                cycle.proposal.basePitchId !== pitch.id)
            )
              throw new ConflictError('Current revision proposal unavailable.');
            if (command.action === 'accept_revision' && command.text === pitch.text)
              throw new ConflictError('Edit the proposed wording or keep the current version.');
            cycle.outcome =
              command.action === 'accept_revision'
                ? 'accepted'
                : command.action === 'reject_revision'
                  ? 'rejected'
                  : 'reviewed';
            cycle.closedAt = now;
            if (command.action === 'accept_revision') {
              const scope = command.scope ?? (cycle.targetId ? 'target' : 'shared');
              const revised: ConnectedPitch = {
                ...pitch,
                ...(cycle.journeyId ? { scope } : {}),
                revision: saved.pitches.length + 1,
                id: randomUUID(),
                parentId: pitch.id,
                text: command.text,
                reason:
                  cycle.proposal?.reasons.join('\n').slice(0, 3000) ||
                  'Reviewed preparation revision.',
                createdAt: now,
              };
              delete revised.targetId;
              if (scope === 'target' && cycle.targetId) revised.targetId = cycle.targetId;
              saved.pitches.push(revised);
              if (cycle.journeyId && scope === 'shared') supersedeSharedDependents(state, now);
              const next = addCycle(state, revised, now, cycle, true);
              if (next.investorId) buildBrief(state, next);
            }
            break;
          }
        }
      }
      saved.commands.push({ key: command.key, hash });
      saved.version++;
      if (state.preparation) state.preparation.version++;
    });
  }
  async reconcile() {
    const state = await this.service.read();
    if (!state.preparation?.automatic || !state.preparation.connected?.cycles.length) return;
    const jobs = await this.service.store.listJobs();
    // Read-only preflight avoids a write on every unchanged worker tick.
    const updateProposals = (current: Workspace) => {
      let changed = false;
      for (const cycle of current.preparation?.connected?.cycles ?? []) {
        if (prepareProposal(current, jobs, cycle)) changed = true;
      }
      return changed;
    };
    if (!updateProposals(structuredClone(state))) return;
    await this.service.change((current) => {
      if (current.preparation?.automatic && updateProposals(current)) {
        connected(current).version++;
        current.preparation.version++;
      }
    });
  }
  async scenarioPreview(cycleId: string) {
    const state = await this.service.read();
    const cycle = currentPreparationCycleById(state, cycleId);
    preparedPitchContext(state, cycleId);
    if (!this.service.scenarios || !cycle.investorId)
      throw new ConflictError('Scenario generation unavailable.');
    return this.service.scenarios.preview(
      cycle.investorId,
      'Rehearse the approved financial story, distinguish sourced investor observations and acknowledge missing cash evidence.',
      cycle.id,
    );
  }
  async createScenario(cycleId: string, key: string, expectedInputHash: string) {
    const state = await this.service.read();
    const cycle = state.preparation?.connected?.cycles.find((c) => c.id === cycleId);
    if (!cycle || !this.service.scenarios || !cycle.investorId)
      throw new ConflictError('Preparation cycle unavailable.');
    const existing = await this.service.scenarios.store.getGenerationByRequestKey(key);
    if (existing)
      return this.service.scenarios.create(
        cycle.investorId,
        'Rehearse the approved financial story, distinguish sourced investor observations and acknowledge missing cash evidence.',
        key,
        expectedInputHash,
        cycle.id,
      );
    currentPreparationCycleById(state, cycleId);
    // Scenario service checks the idempotency key before reassembling mutable inputs.
    const generation = await this.service.scenarios.create(
      cycle.investorId,
      'Rehearse the approved financial story, distinguish sourced investor observations and acknowledge missing cash evidence.',
      key,
      expectedInputHash,
      cycle.id,
    );
    await this.service.change((current) => {
      const active = currentPreparationCycleById(current, cycleId);
      if (active.generationId && active.generationId !== generation.id)
        throw new ConflictError(
          'This cycle already has a scenario generation. Retry that workflow.',
        );
      if (!active.generationId) {
        active.generationId = generation.id;
        connected(current).version++;
      }
    });
    return generation;
  }
  async retryScenario(cycleId: string, generationId: string) {
    const generation = await this.service.scenarios?.store.getGeneration(generationId);
    if (
      !generation ||
      generation.status !== 'failed' ||
      generation.input.preparation?.cycleId !== cycleId
    )
      throw new ConflictError('Only a failed generation can be retried.');
    await this.service.change((state) => {
      const cycle = currentPreparationCycleById(state, cycleId);
      if (cycle.generationId === null) return;
      if (cycle.generationId !== generationId) throw new ConflictError('Generation changed.');
      cycle.generationId = null;
      connected(state).version++;
    });
  }
  async submitWritten(cycleId: string, scenarioId: string, answer: string, key: string) {
    if (!this.service.scenarios) throw new ConflictError('Scenario generation unavailable.');
    const initial = await this.service.read();
    const requestHash = connectedHash({ cycleId, scenarioId, answer });
    const existing = initial.preparation?.connected?.commands.find((c) => c.key === key);
    if (existing) {
      if (existing.hash !== requestHash) throw new ConflictError('Request key reused.');
      const session = initial.rehearsals.find((r) => r.id === existing.resultId);
      if (!session) throw new ConflictError('Saved rehearsal unavailable.');
      return session.id;
    }
    const cycle = currentPreparationCycleById(initial, cycleId);
    if (cycle.id !== cycleId || !cycle.generationId)
      throw new ConflictError('Choose a current completed scenario.');
    const context = await this.service.scenarios.loadContext({
      generationId: cycle.generationId,
      scenarioId,
    });
    const hash = connectedHash({ cycleId, scenarioId, answer });
    return this.service.change((state) => {
      const saved = connected(state);
      const replay = saved.commands.find((c) => c.key === key);
      if (replay) {
        if (replay.hash !== hash) throw new ConflictError('Request key reused.');
        const prior = state.rehearsals.find((r) => r.id === replay.resultId);
        if (!prior) throw new ConflictError('Saved rehearsal unavailable.');
        return prior.id;
      }
      const active = currentPreparationCycleById(state, cycleId);
      if (active.id !== cycleId || active.generationId !== cycle.generationId)
        throw new ConflictError('Preparation cycle changed.');
      preparedPitchContext(state, cycleId);
      assertCurrentPreparedPractice(state, context);
      const session = rehearsalSchema.parse({
        id: randomUUID(),
        briefId: null,
        mode: 'text',
        status: 'completed',
        createdAt: new Date().toISOString(),
        conversationId: null,
        turns: [
          {
            role: 'agent',
            text: context.scenario?.openingQuestion ?? 'Explain the approved financial story.',
          },
          { role: 'user', text: answer },
        ],
        review: null,
        context,
        evaluationContext: assembleEvaluationContext(state, context),
      });
      queueEvaluation(session, this.service.evaluations.provider);
      state.rehearsals.push(session);
      saved.commands.push({ key, hash, resultId: session.id });
      saved.version++;
      return session.id;
    });
  }
}
