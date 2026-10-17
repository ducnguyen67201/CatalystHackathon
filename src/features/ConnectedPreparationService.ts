import { randomUUID } from 'node:crypto';
import type { WorkspaceService } from './WorkspaceService.js';
import type { Workspace, Job } from '../contracts/Workspace.js';
import { rehearsalSchema } from '../contracts/Workspace.js';
import { preparationStateSchema } from '../contracts/FundraisingPreparation.js';
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
function currentCycle(state: Workspace) {
  const cycle = state.preparation?.connected?.cycles.at(-1);
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
) {
  const goal = state.preparation?.goals.at(-1);
  if (!goal) throw new ConflictError('Confirm a preparation goal first.');
  const cycle: PreparationCycle = {
    id: randomUUID(),
    goalId: goal.id,
    sourceHash: connectedSourceHash(state),
    pitchId: pitch.id,
    pitchApprovedAt: keepApproval ? now : null,
    investorId: previous?.investorId ?? goal.investorId,
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
  const artifact = buildPreparationPlan(state, goal, now).artifacts.find(
    (a) => a.kind === 'financial',
  );
  if (!artifact)
    throw new ConflictError('Select a financial statement before starting preparation.');
  const pitch: ConnectedPitch = {
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
  const observations = investorSources(state, investor.id);
  const focus = observations
    .map((s) => `${s.title}: ${s.excerpt}`)
    .join('\n')
    .slice(0, 1000);
  cycle.brief =
    `Prepare for ${investor.name} for ${goal.round}. ${goal.previousRounds === null ? 'Prior financing is unconfirmed.' : `The founder confirmed ${goal.previousRounds} previous financing round(s).`}\n\n${pitch.text}\n\n${focus ? `Saved public-source context (unverified):\n${focus}` : 'No saved investor research is available; use limited-context preparation.'}\n\nAsk about current mandate, individual participation and evidence requirements. Historical activity does not establish eligibility. Cash runway is not established by the income statement.`.slice(
      0,
      3000,
    );
  cycle.investorSourceHash = connectedInvestorHash(state, investor.id);
}
function prepareProposal(state: Workspace, jobs: Job[]) {
  const cycle = state.preparation?.connected?.cycles.at(-1);
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
  async view() {
    const [state, jobs] = await Promise.all([this.service.read(), this.service.store.listJobs()]);
    const saved = state.preparation?.connected;
    const cycle = saved?.cycles.at(-1) ?? null;
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
      goalId: state.preparation?.goals.at(-1)?.id ?? null,
      cycle,
      pitch: saved?.pitches.find((p) => p.id === cycle?.pitchId) ?? null,
      outdated: !!cycle && cycleOutdated(state, cycle),
      paused: !state.preparation?.automatic,
      steps: connectedSteps(state, jobs, publicGeneration),
      recommendations: preparationRecommendations(state),
      latestSession: cycle ? (latestLoopReview(state, cycle, jobs)?.public ?? null) : null,
      generation: publicGeneration,
      history: saved?.cycles.slice(-10).reverse() ?? [],
      historyPitches:
        saved?.pitches
          .filter((p) => saved.cycles.slice(-10).some((c) => c.pitchId === p.id))
          .slice(-10) ?? [],
      cycleNumber: saved?.cycles.length ?? 0,
      completedCycles:
        saved?.cycles.filter((c) => c.closedAt && c.outcome !== 'superseded').length ?? 0,
    });
  }
  async command(raw: ConnectedPreparationCommand) {
    const command = connectedPreparationCommandSchema.parse(raw);
    const hash = connectedHash(command);
    const jobs = await this.service.store.listJobs();
    await this.service.change((state) => {
      const saved = connected(state);
      const replay = saved.commands.find((c) => c.key === command.key);
      if (replay) {
        if (replay.hash !== hash) throw new ConflictError('Request key reused.');
        return;
      }
      if (saved.version !== command.version)
        throw new ConflictError('Preparation changed. Refresh before saving.');
      const now = new Date().toISOString();
      let cycle = saved.cycles.at(-1);
      if (command.action === 'start' || command.action === 'refresh') {
        if (cycle && !cycle.closedAt && !cycleOutdated(state, cycle))
          throw new ConflictError('A current cycle already exists. Continue its next action.');
        if (cycle && !cycle.closedAt) {
          cycle.closedAt = now;
          cycle.outcome = 'superseded';
        }
        addCycle(state, initialPitch(state, now), now, cycle);
      } else if (command.action === 'repeat') {
        if (!cycle?.closedAt || cycleOutdated(state, cycle))
          throw new ConflictError('Finish the cycle or refresh changed sources first.');
        const pitch = saved.pitches.find((p) => p.id === cycle?.pitchId);
        if (!pitch) throw new ConflictError('Pitch unavailable.');
        const repeated = addCycle(state, pitch, now, cycle, !!cycle.pitchApprovedAt);
        if (repeated.pitchApprovedAt && repeated.investorId) buildBrief(state, repeated);
      } else {
        cycle = currentCycle(state);
        const pitch = saved.pitches.find((p) => p.id === cycle?.pitchId);
        if (!pitch) throw new ConflictError('Pitch unavailable.');
        switch (command.action) {
          case 'save_pitch': {
            if (command.text !== pitch.text) {
              const edited: ConnectedPitch = {
                ...pitch,
                revision: saved.pitches.length + 1,
                id: randomUUID(),
                parentId: pitch.id,
                text: command.text,
                reason: 'Founder-edited draft; approval is review, not verification of new claims.',
                createdAt: now,
              };
              saved.pitches.push(edited);
              cycle.closedAt = now;
              cycle.outcome = 'superseded';
              addCycle(state, edited, now, cycle);
            }
            break;
          }
          case 'approve_pitch':
            cycle.pitchApprovedAt = now;
            if (cycle.investorId) buildBrief(state, cycle);
            break;
          case 'select_investor': {
            if (!cycle.pitchApprovedAt || !state.investors.some((i) => i.id === command.investorId))
              throw new ConflictError('Approve the story and select a saved investor.');
            if (
              cycle.investorId !== command.investorId &&
              (cycle.briefApprovedAt || cycle.generationId)
            ) {
              cycle.closedAt = now;
              cycle.outcome = 'superseded';
              cycle = addCycle(state, pitch, now, cycle, true);
            }
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
            prepareProposal(state, jobs);
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
              const revised: ConnectedPitch = {
                ...pitch,
                revision: saved.pitches.length + 1,
                id: randomUUID(),
                parentId: pitch.id,
                text: command.text,
                reason:
                  cycle.proposal?.reasons.join('\n').slice(0, 3000) ||
                  'Reviewed preparation revision.',
                createdAt: now,
              };
              saved.pitches.push(revised);
              addCycle(state, revised, now, cycle, true);
              const next = saved.cycles.at(-1);
              if (next?.investorId) buildBrief(state, next);
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
    if (!prepareProposal(structuredClone(state), jobs)) return;
    await this.service.change((current) => {
      if (current.preparation?.automatic && prepareProposal(current, jobs)) {
        connected(current).version++;
        current.preparation.version++;
      }
    });
  }
  async scenarioPreview(cycleId: string) {
    const state = await this.service.read();
    const cycle = currentCycle(state);
    if (cycle.id !== cycleId) throw new ConflictError('Preparation cycle changed.');
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
    if (currentCycle(state).id !== cycleId) throw new ConflictError('Preparation cycle changed.');
    // Scenario service checks the idempotency key before reassembling mutable inputs.
    const generation = await this.service.scenarios.create(
      cycle.investorId,
      'Rehearse the approved financial story, distinguish sourced investor observations and acknowledge missing cash evidence.',
      key,
      expectedInputHash,
      cycle.id,
    );
    await this.service.change((current) => {
      const active = currentCycle(current);
      if (active.id !== cycleId) throw new ConflictError('Preparation cycle changed.');
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
      const cycle = currentCycle(state);
      if (cycle.id !== cycleId) throw new ConflictError('Preparation cycle changed.');
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
    const cycle = currentCycle(initial);
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
      const active = currentCycle(state);
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
