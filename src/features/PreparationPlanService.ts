import { synchronizePreparationIntent } from './PreparationIntent.js';
import { ensureGoalJourney } from './GoalProgress.js';
import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { WorkspaceService } from './WorkspaceService.js';
import { ConflictError } from './WorkspaceStore.js';
import { rehearsalSchema } from '../contracts/Workspace.js';
import {
  preparationGoalInputSchema,
  preparationIntentSchema,
  preparationScheduleInputSchema,
  type PreparationScheduleInput,
  preparationStateSchema,
  type PreparationGoalInput,
} from '../contracts/FundraisingPreparation.js';
import { assembleEvaluationContext } from './EvaluationContextAssembler.js';
import { queueEvaluation } from './RehearsalEvaluationService.js';
import {
  buildPreparationPlan,
  preparationHash,
  preparationInputs,
  preparationState,
  projectPreparationPlan,
} from './PreparationPlanner.js';

/** Local, deterministic drafting. Reads never generate work; the worker watches saved input versions. */
export class PreparationPlanService {
  constructor(private readonly service: WorkspaceService) {}
  async view() {
    const [state, jobs, heartbeat] = await Promise.all([
      this.service.read(),
      this.service.store.listJobs(),
      this.service.store.readHeartbeat?.(),
    ]);
    return projectPreparationPlan(state, jobs, heartbeat?.at ?? null);
  }
  async setIntent(intent: string, version: number, profileVersion: number) {
    const objective = preparationIntentSchema.parse(intent);
    await this.service.change((state) => {
      const saved = preparationState(state);
      if (saved.version !== version || state.profile.version !== profileVersion)
        throw new ConflictError('Preparation changed. Refresh before editing your goal.');
      state.profile = { ...state.profile, goal: objective, version: state.profile.version + 1 };
      synchronizePreparationIntent(state);
    });
  }
  async confirmGoal(input: PreparationGoalInput, version: number, automatic: boolean) {
    const goal = preparationGoalInputSchema.parse(input);
    if (goal.amount !== null && new Decimal(goal.amount).lte(0))
      throw new Error('Preparation: raise amount must be positive.');
    await this.service.change((state) => {
      const saved = (state.preparation ??= preparationStateSchema.parse({}));
      if (saved.version !== version) throw new ConflictError('Preparation changed.');
      if (goal.investorId && !state.investors.some((item) => item.id === goal.investorId))
        throw new Error('Preparation: selected investor is unavailable.');
      const confirmed = {
        ...goal,
        objective: state.profile.goal,
        id: randomUUID(),
        confirmedAt: new Date().toISOString(),
      };
      saved.goals.push(confirmed);
      ensureGoalJourney(state, confirmed.confirmedAt);
      saved.automatic = automatic;
      saved.plans.push(buildPreparationPlan(state, confirmed, confirmed.confirmedAt));
      saved.version++;
    });
  }
  async saveSchedule(input: PreparationScheduleInput, version: number, planId: string) {
    const assumptions = preparationScheduleInputSchema.parse(input);
    await this.service.change((state) => {
      const saved = (state.preparation ??= preparationStateSchema.parse({}));
      const goal = saved.goals.at(-1);
      const plan = saved.plans.at(-1);
      if (
        saved.version !== version ||
        !goal ||
        !plan ||
        plan.id !== planId ||
        plan.inputHash !== preparationHash(preparationInputs(state, goal))
      )
        throw new ConflictError('Preparation changed. Refresh before saving assumptions.');
      saved.schedules.push({
        ...assumptions,
        id: randomUUID(),
        goalId: goal.id,
        planId: plan.id,
        confirmedAt: new Date().toISOString(),
      });
      saved.version++;
    });
  }
  async setAutomatic(automatic: boolean, version: number) {
    await this.service.change((state) => {
      const saved = (state.preparation ??= preparationStateSchema.parse({}));
      if (saved.version !== version) throw new ConflictError('Preparation changed.');
      saved.automatic = automatic;
      saved.version++;
    });
  }
  async reconcile(manual = false) {
    const initial = await this.service.read();
    const saved = preparationState(initial);
    const goal = saved.goals.at(-1);
    if (!goal || (!manual && !saved.automatic)) return;
    const hash = preparationHash(preparationInputs(initial, goal));
    if (saved.plans.at(-1)?.inputHash === hash) return;
    await this.service.change((state) => {
      const current = (state.preparation ??= preparationStateSchema.parse({}));
      const latest = current.goals.at(-1);
      if (!latest || (!manual && !current.automatic)) return;
      const plan = buildPreparationPlan(state, latest, new Date().toISOString());
      if (current.plans.at(-1)?.inputHash === plan.inputHash) return;
      current.plans.push(plan);
      current.version++;
    });
  }
  async decide(
    planId: string,
    artifactId: string,
    kind: 'accepted' | 'rejected',
    note: string,
    requestKey: string,
  ) {
    await this.service.change((state) => {
      const saved = (state.preparation ??= preparationStateSchema.parse({}));
      const replay = saved.decisions.find((item) => item.id === requestKey);
      if (replay) {
        if (
          replay.planId !== planId ||
          replay.artifactId !== artifactId ||
          replay.kind !== kind ||
          replay.note !== note
        )
          throw new ConflictError('Request key reused.');
        return;
      }
      const goal = saved.goals.at(-1);
      const plan = saved.plans.at(-1);
      if (
        !goal ||
        !plan ||
        plan.id !== planId ||
        plan.inputHash !== preparationHash(preparationInputs(state, goal))
      )
        throw new ConflictError('Preparation sources changed.');
      if (!plan.artifacts.some((item) => item.id === artifactId))
        throw new Error('Preparation: artifact unavailable.');
      saved.decisions.push({
        id: requestKey,
        planId,
        artifactId,
        kind,
        note,
        createdAt: new Date().toISOString(),
      });
      saved.version++;
    });
  }
  async rehearse(planId: string, artifactId: string, answer: string, requestKey: string) {
    return this.service.change((state) => {
      const saved = (state.preparation ??= preparationStateSchema.parse({}));
      const requestHash = preparationHash({ planId, artifactId, answer });
      const replay = saved.rehearsals.find((item) => item.requestKey === requestKey);
      if (replay) {
        if (replay.requestHash !== requestHash) throw new ConflictError('Request key reused.');
        return replay.sessionId;
      }
      const goal = saved.goals.at(-1);
      const plan = saved.plans.at(-1);
      if (
        !goal ||
        !plan ||
        plan.id !== planId ||
        plan.inputHash !== preparationHash(preparationInputs(state, goal))
      )
        throw new ConflictError('Preparation sources changed.');
      const artifact = plan.artifacts.find(
        (item) => item.id === artifactId && item.kind === 'financial',
      );
      if (
        !artifact ||
        saved.decisions.findLast((item) => item.artifactId === artifactId)?.kind !== 'accepted'
      )
        throw new Error('Preparation: review the financial explanation before rehearsing.');
      // Exclude unrelated meeting/investor context, then attach only this goal's saved sources.
      const sourceState = { ...state, onboarding: { ...state.onboarding, meeting: null } };
      const context = assembleEvaluationContext(sourceState, null);
      const investorArtifact = plan.artifacts.find((item) => item.kind === 'investor');
      context.investorId = goal.investorId;
      context.investorName =
        state.investors.find((item) => item.id === goal.investorId)?.name ?? null;
      context.scenario = artifact.question;
      for (const source of investorArtifact?.sources ?? [])
        context.sources.push({
          id: `investor:${source.id}`,
          kind: 'investor',
          title: source.title || 'Investor source',
          text: source.excerpt,
          url: source.url,
          recordedAt: source.recordedAt,
          origin: source.fictional ? 'fictional' : 'public_unverified',
        });
      if (context.investorAssessment) {
        const ids = new Set(investorArtifact?.sources.map((source) => source.id) ?? []);
        context.investorAssessment.observations = state.evidence
          .filter((source) => ids.has(source.id))
          .map((source) => ({
            sourceId: `investor:${source.id}`,
            stage: source.stage,
            sector: source.sector,
            geography: source.geography,
          }));
      }
      context.sources.push({
        id: 'preparation-goal',
        kind: 'company',
        title: 'Founder-confirmed preparation goal',
        text: JSON.stringify(goal),
        url: null,
        recordedAt: goal.confirmedAt,
        origin: 'founder',
      });
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
            text: `${artifact.question} Success criteria: ${artifact.criteria.join(' ')}`,
          },
          { role: 'user', text: answer },
        ],
        review: null,
        evaluationContext: context,
      });
      queueEvaluation(session, this.service.evaluations.provider);
      state.rehearsals.push(session);
      saved.rehearsals.push({ requestKey, requestHash, sessionId: session.id, planId, artifactId });
      saved.version++;
      return session.id;
    });
  }
}
