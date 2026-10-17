import type { FollowupTask } from './Followups.js';

/** Navigation only: generation still requires the existing source review and explicit action. */
export function preparationScenarioHref(objective: string, investorId?: string | null): string {
  const query = new URLSearchParams({ objective: objective.slice(0, 1000) });
  if (investorId) query.set('investor', investorId);
  return `/scenarios?${query}`;
}

export function followupObjective(
  task: Pick<FollowupTask, 'title' | 'practiceQuestion' | 'missingInputs'>,
): string {
  return `${task.title} ${task.practiceQuestion}${task.missingInputs.length ? ` Evidence to gather: ${task.missingInputs.join('; ')}` : ''}`;
}
