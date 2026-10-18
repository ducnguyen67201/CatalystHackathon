import type { GoalPosition, GoalProgressEvent } from '../contracts/GoalJourney.js';

export const preparationSteps = [
  { id: 'story', label: 'Company story' },
  { id: 'investor', label: 'Investor chosen' },
  { id: 'brief', label: 'Brief approved' },
  { id: 'practice', label: 'Practice saved' },
  { id: 'feedback', label: 'Feedback reviewed' },
  { id: 'revision', label: 'Next work decided' },
] as const;

/** Ignore dates and unrelated investors, but retain changes to work, lineage and planning. */
function visibleState(position: GoalPosition, targetId: string) {
  const tracks = targetId
    ? position.tracks.filter((track) => track.targetId === targetId)
    : position.tracks;
  return JSON.stringify({
    goal: position.goalVersionId,
    scope: position.scopeVersionId,
    completed: targetId ? tracks[0]?.completed : position.completed,
    required: targetId ? tracks[0]?.required : position.required,
    readiness: targetId ? undefined : position.readiness,
    next: targetId ? tracks[0]?.nextAction : position.nextAction,
    tracks: tracks.map(({ href: _href, ...track }) => track),
    practices: position.practices.filter((practice) => !targetId || practice.targetId === targetId),
    remaining: position.remainingHours,
    pace: position.pace ?? 1,
  });
}

export function chartMilestone(
  event: GoalProgressEvent,
  previous: GoalProgressEvent | undefined,
  targetId: string,
) {
  if (!previous) return { label: 'Starting point', detail: event.reason };
  const before = previous.position;
  const after = event.position;
  if (before.goalVersionId !== after.goalVersionId)
    return { label: 'Goal updated', detail: 'Earlier preparation stays in your history.' };
  if (before.scopeVersionId !== after.scopeVersionId || before.required !== after.required)
    return {
      label: 'Plan changed',
      detail: `${before.required} → ${after.required} goal steps. A changed plan can change the percentage.`,
    };
  if ((before.pace ?? 1) !== (after.pace ?? 1))
    return {
      label: 'Planning pace updated',
      detail: 'Your forecast changed; reviewed work did not.',
    };
  const tracks = after.tracks.filter((track) => !targetId || track.targetId === targetId);
  let sharedStoryIncluded = false;
  const completed = tracks.flatMap((track) => {
    const old = before.tracks.find((item) => item.targetId === track.targetId);
    return track.steps
      .filter((step) => step.complete && !old?.steps.find((item) => item.id === step.id)?.complete)
      .filter((step) => {
        if (step.id !== 'story') return true;
        if (sharedStoryIncluded) return false;
        sharedStoryIncluded = true;
        return true;
      })
      .map((step) => ({
        label: preparationSteps.find((item) => item.id === step.id)?.label ?? step.id,
        name: step.id === 'story' ? 'Shared company story' : track.name,
      }));
  });
  const reopened = tracks.some((track) => {
    const old = before.tracks.find((item) => item.targetId === track.targetId);
    return track.steps.some(
      (step) => !step.complete && old?.steps.find((item) => item.id === step.id)?.complete,
    );
  });
  if (reopened) return { label: 'Review reopened', detail: event.reason };
  const first = completed[0];
  if (first)
    return {
      label: first.label + (completed.length > 1 ? ` +${completed.length - 1}` : ''),
      detail: [...new Set(completed.map((item) => item.name))].join(' · '),
    };
  const updated = tracks.find((track) => {
    const old = before.tracks.find((item) => item.targetId === track.targetId);
    return (
      track.sessionId !== old?.sessionId ||
      JSON.stringify(track.steps) !== JSON.stringify(old.steps)
    );
  });
  if (updated) {
    if (updated.steps.some((step) => step.id === 'practice' && step.status === 'running'))
      return { label: 'Call saved · transcript pending', detail: updated.name };
    if (updated.steps.some((step) => step.id === 'feedback' && step.status === 'running'))
      return { label: 'Assessment processing', detail: updated.name };
    if (updated.steps.some((step) => step.id === 'feedback' && step.status === 'needs_review'))
      return { label: 'Feedback ready to review', detail: updated.name };
  }
  return { label: 'Preparation updated', detail: event.reason };
}

/** Visual grouping never alters saved events or the time/denominator used by the line. */
export function chartInsights(events: GoalProgressEvent[], targetId: string, selectedId?: string) {
  const ordered = [...events]
    .sort((a, b) => a.sequence - b.sequence)
    .filter(
      (event) => !targetId || event.position.tracks.some((track) => track.targetId === targetId),
    );
  const signatures = ordered.map((event) => visibleState(event.position, targetId));
  return ordered.map((event, index) => {
    const changed = index === 0 || signatures[index] !== signatures[index - 1];
    return {
      event,
      ...chartMilestone(event, ordered[index - 1], targetId),
      milestone: changed,
      showMarker:
        changed ||
        index === ordered.length - 1 ||
        signatures[index] !== signatures[index + 1] ||
        event.id === selectedId,
    };
  });
}
