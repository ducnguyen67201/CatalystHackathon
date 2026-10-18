import type { FollowupTask } from './Followups.js';
import type { GoalJourneyView } from './GoalJourney.js';

/** Reopening saved preparation is navigation, not a focus or approval command. */
export function targetPreparationHref(
  target: Pick<GoalJourneyView['targets'][number], 'id' | 'track'>,
): string {
  const href = target.track?.href;
  if (href?.startsWith('/') && !href.startsWith('//')) {
    try {
      if (new URL(href, 'https://workspace.local').origin === 'https://workspace.local')
        return href;
    } catch {
      /* Invalid destinations use the target preparation prerequisite. */
    }
  }
  return `/?preparationStep=brief&targetId=${encodeURIComponent(target.id)}`;
}

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
