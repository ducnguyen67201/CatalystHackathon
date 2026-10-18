import { randomUUID } from 'node:crypto';
import type { Workspace } from '../contracts/Workspace.js';
import {
  preparationStateSchema,
  preparationGoalSchema,
} from '../contracts/FundraisingPreparation.js';
import type { PreparationGoalInput } from '../contracts/FundraisingPreparation.js';
import { buildPreparationPlan } from './PreparationPlanner.js';
import { ensureGoalJourney } from './GoalProgress.js';

/** Explicit goal edits prepare local work in the same transaction as company context. */
export function synchronizePreparationIntent(
  state: Workspace,
  now = new Date().toISOString(),
  investorId?: string | null,
  details?: PreparationGoalInput,
) {
  if (!state.profile.goal.trim()) return;
  const saved = (state.preparation ??= preparationStateSchema.parse({}));
  const previous = saved.goals.at(-1);
  const goal = preparationGoalSchema.parse({
    id: randomUUID(),
    confirmedAt: now,
    objective: state.profile.goal,
    round: previous?.round ?? 'Next round',
    previousRounds: previous?.previousRounds ?? null,
    amount: previous?.amount ?? state.profile.raiseTarget,
    currency: previous?.currency ?? state.profile.currency,
    targetDate: previous?.targetDate ?? null,
    timezone: previous?.timezone ?? state.schedule.timezone,
    investorId:
      investorId !== undefined
        ? investorId
        : (previous?.investorId ?? state.onboarding.meeting?.investorId ?? null),
    ...(previous?.desiredCheck !== undefined ? { desiredCheck: previous.desiredCheck } : {}),
    ...details,
  });
  saved.goals.push(goal);
  ensureGoalJourney(state, now);
  if (!previous) saved.automatic = true;
  saved.plans.push(buildPreparationPlan(state, goal, now));
  saved.version++;
}
