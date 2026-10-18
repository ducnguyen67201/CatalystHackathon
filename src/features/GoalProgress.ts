import { randomUUID, createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import {
  goalJourneySchema,
  goalPositionSchema,
  type GoalJourney,
  type GoalPosition,
  type GoalTrackPosition,
  type GoalProgressEvent,
} from '../contracts/GoalJourney.js';
import type { Workspace, Job } from '../contracts/Workspace.js';
import { connectedSourceHash, cycleOutdated, latestLoopReview } from './ConnectedPreparation.js';
import { savedMatchOutdated } from './InvestorMatchInputs.js';
import { projectFollowups } from './Followups.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const panelHref = (targetId: string, step: string, cycleId?: string) =>
  '/?' +
  new URLSearchParams({
    ...(targetId ? { targetId } : {}),
    preparationStep: step,
    ...(cycleId ? { preparationCycleId: cycleId } : {}),
  }).toString();

/** Explicitly enabled on a goal command, never on a read. Older goals stay untouched. */
export function ensureGoalJourney(
  state: Workspace,
  now = new Date().toISOString(),
): GoalJourney | null {
  const saved = state.preparation;
  const goal = saved?.goals.at(-1);
  if (!saved || !goal) return null;
  if (saved.journey) {
    saved.journey.currentGoalId = goal.id;
    return saved.journey;
  }
  saved.journey = goalJourneySchema.parse({
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
        reason: 'Preparation tracking started with one unfilled investor slot.',
      },
    ],
    events: [],
    lastSequence: 0,
    lastFingerprint: null,
    commands: [],
  });
  return saved.journey;
}

export function updateGoalScope(
  journey: GoalJourney,
  reason: string,
  now = new Date().toISOString(),
) {
  const ids = journey.targets.filter((t) => t.status === 'active' && t.included).map((t) => t.id);
  const prior = journey.scopes.at(-1);
  if (prior && JSON.stringify(prior.targetIds) === JSON.stringify(ids)) return;
  journey.scopes.push({
    id: randomUUID(),
    version: (prior?.version ?? 0) + 1,
    targetIds: ids,
    createdAt: now,
    reason,
  });
}

function sharedStoryReviewed(state: Workspace) {
  const saved = state.preparation?.connected;
  const latestShared = saved?.pitches.findLast((pitch) => pitch.scope !== 'target');
  return (
    !!latestShared &&
    !!saved?.cycles.some(
      (cycle) =>
        cycle.pitchId === latestShared.id &&
        cycle.pitchApprovedAt &&
        cycle.sourceHash === connectedSourceHash(state),
    )
  );
}

export function projectGoalTrack(
  state: Workspace,
  targetId: string,
  jobs: Job[] = [],
): GoalTrackPosition | null {
  const journey = state.preparation?.journey;
  const target = journey?.targets.find((t) => t.id === targetId);
  if (!target || !journey) return null;
  const cycle = state.preparation?.connected?.cycles.filter((c) => c.targetId === targetId).at(-1);
  const outdated = !!cycle && cycleOutdated(state, cycle);
  const assessment = journey.assessments.find((a) => a.id === target.assessmentId);
  const matchOutdated = !!assessment && savedMatchOutdated(state, assessment);
  const review = cycle ? latestLoopReview(state, cycle, jobs) : null;
  const feedbackReviewed = !!(
    review?.report &&
    cycle?.feedback?.evaluationId === review.evaluation?.id &&
    cycle?.feedback?.sessionId === review.session.id
  );
  const statuses: GoalTrackPosition['steps'][number]['status'][] = [
    sharedStoryReviewed(state) ? 'complete' : 'needs_review',
    matchOutdated ? 'needs_review' : 'complete',
    cycle?.briefApprovedAt ? 'complete' : cycle?.brief ? 'needs_review' : 'blocked',
    review?.session.status === 'completed' &&
    review.session.turns.some((t) => t.role === 'user' && t.text.trim())
      ? 'complete'
      : review?.public.status === 'awaiting_transcript'
        ? 'running'
        : cycle?.briefApprovedAt
          ? 'ready'
          : 'blocked',
    feedbackReviewed
      ? 'complete'
      : review?.public.status === 'failed'
        ? 'failed'
        : review?.report
          ? 'needs_review'
          : review?.public.status === 'pending'
            ? 'running'
            : 'blocked',
    cycle?.closedAt && cycle.outcome !== 'superseded'
      ? 'complete'
      : feedbackReviewed
        ? 'needs_review'
        : 'blocked',
  ];
  const ids = ['story', 'investor', 'brief', 'practice', 'feedback', 'revision'] as const;
  const reasons = [
    'Review the exact company-story revision.',
    'Target selected; mandate uncertainties remain visible.',
    'Approve the current investor-specific brief.',
    'Save an authoritative practice answer or final transcript.',
    'Review the completed assessment.',
    'Record a revision or no-gap decision.',
  ];
  const steps = ids.map((id, index) => {
    const status =
      outdated && !['investor', 'story'].includes(id) ? 'outdated' : (statuses[index] ?? 'blocked');
    return { id, complete: status === 'complete', status, reason: reasons[index] ?? '' };
  });
  const next = steps.find((s) => !s.complete);
  const pitch = state.preparation?.connected?.pitches.find((p) => p.id === cycle?.pitchId);
  return {
    targetId,
    investorId: target.investorId,
    name: state.investors.find((i) => i.id === target.investorId)?.name ?? 'Saved investor',
    cycleId: cycle?.id ?? null,
    pitchId: cycle?.pitchId ?? null,
    briefVersionId: cycle?.briefVersionId ?? null,
    sessionId: review?.session.id ?? null,
    evaluationId: review?.evaluation?.id ?? null,
    fictional:
      !!pitch?.fictional ||
      (!!review?.session.context &&
        review.session.context.version === 2 &&
        review.session.context.generationMode === 'demo'),
    outdated,
    hasGaps: review?.public.hasGaps ?? false,
    steps,
    completed: steps.filter((s) => s.id !== 'story' && s.complete).length,
    required: 5,
    nextAction: matchOutdated
      ? 'Review the current investor match in Radar.'
      : outdated
        ? 'Review changed preparation sources.'
        : (next?.reason ??
          (review?.public.hasGaps
            ? 'Resolve outstanding feedback or review a retry.'
            : 'Preparation cycle reviewed.')),
    href: matchOutdated
      ? '/?page=radar&targetId=' + encodeURIComponent(targetId)
      : panelHref(
          targetId,
          next?.id ?? (review?.public.hasGaps ? 'feedback' : 'revision'),
          cycle?.id,
        ),
  };
}

/** Pure projection; never creates observations or provider work. */
export function projectGoalPosition(
  state: Workspace,
  jobs: Job[] = [],
  now = new Date(),
): GoalPosition | null {
  const journey = state.preparation?.journey;
  const goal = state.preparation?.goals.at(-1);
  const scope = journey?.scopes.at(-1);
  if (!journey || !goal || !scope) return null;
  const tracks = scope.targetIds.flatMap((id) => {
    const target = journey.targets.find((t) => t.id === id && t.status === 'active');
    const track = target ? projectGoalTrack(state, id, jobs) : null;
    return track ? [track] : [];
  });
  const story = sharedStoryReviewed(state);
  const required = 1 + 5 * Math.max(1, scope.targetIds.length);
  const completed = Number(story) + tracks.reduce((sum, t) => sum + t.completed, 0);
  const needsWork = (track: GoalTrackPosition) =>
    track.completed < track.required || track.hasGaps || track.outdated;
  const focus =
    tracks.find((t) => t.targetId === journey.focusedTargetId && needsWork(t)) ??
    tracks.find(needsWork) ??
    tracks[0];
  const hasGaps = tracks.some((t) => t.hasGaps);
  const pending = tracks.some((t) => t.steps.some((s) => s.status === 'running'));
  const outdated = tracks.some((t) => t.outdated);
  const missingTarget = !tracks.length;
  const nextAction = !story
    ? 'Review your company story.'
    : missingTarget
      ? 'Review investor matches and add a target investor.'
      : (focus?.nextAction ?? 'Preparation reviewed.');
  const href = !story
    ? panelHref(focus?.targetId ?? '', 'story', focus?.cycleId ?? undefined)
    : missingTarget
      ? '/?page=radar'
      : (focus?.href ?? '/');
  const schedule =
    state.preparation?.schedules.findLast((s) => s.goalId === goal.id) ??
    state.preparation?.schedules.at(-1);
  const hours = schedule?.hours ?? { financial: 2, investor: 2, brief: 2, rehearse: 4 };
  let remaining = new Decimal(story ? 0 : hours.financial);
  if (missingTarget)
    remaining = remaining.plus(hours.investor).plus(hours.brief).plus(hours.rehearse);
  for (const track of tracks) {
    if (!track.steps.find((s) => s.id === 'brief')?.complete)
      remaining = remaining.plus(hours.brief);
    if (track.steps.some((s) => ['practice', 'feedback', 'revision'].includes(s.id) && !s.complete))
      remaining = remaining.plus(hours.rehearse);
    else if (track.hasGaps) remaining = remaining.plus(hours.rehearse);
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: goal.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const waitDate = schedule?.cashExpectedDate;
  const days = remaining
    .div(schedule?.dailyHours ?? 2)
    .ceil()
    .toNumber();
  const start = Date.parse(today + 'T00:00:00Z');
  const dependencyStart =
    waitDate && waitDate >= today ? Math.max(start, Date.parse(waitDate + 'T00:00:00Z')) : start;
  const estimate =
    outdated || (remaining.isZero() && pending)
      ? null
      : new Date(dependencyStart + days * 86400000).toISOString().slice(0, 10);
  const followups = projectFollowups(state, jobs, 0, state.rehearsals.length).sessions;
  const practices: GoalPosition['practices'] = state.rehearsals
    .flatMap((session) => {
      const lineage = session.context?.version === 2 ? session.context.input.preparation : null;
      if (!lineage?.targetId || lineage.journeyId !== journey.id) return [];
      const evaluation = session.evaluations.at(-1);
      const report = evaluation?.status === 'completed' ? evaluation.report : null;
      const checks =
        report?.checks.filter(
          (check) =>
            !report.extraction.claims.find((claim) => claim.id === check.claimId)
              ?.supersededByTurnId,
        ) ?? [];
      const followup = followups.find((item) => item.id === session.id);
      return [
        {
          sessionId: session.id,
          evaluationId: evaluation?.id ?? null,
          targetId: lineage.targetId,
          createdAt: session.createdAt,
          fictional: lineage.fictional,
          partial: session.status === 'partial' || evaluation?.scope === 'partial',
          status: report
            ? ('assessed' as const)
            : followup?.reviewStatus === 'failed'
              ? ('failed' as const)
              : evaluation?.status === 'queued' || session.status === 'awaiting_transcript'
                ? ('pending' as const)
                : ('unavailable' as const),
          assessed: checks.length,
          supported: checks.filter((c) => c.support === 'supported').length,
          contradicted: checks.filter((c) => c.support === 'contradicted').length,
          unresolved: checks.filter((c) => !['supported', 'contradicted'].includes(c.support))
            .length,
          improved: followup?.tasks.filter((task) => task.status === 'improved').length ?? 0,
        },
      ];
    })
    .slice(-100);
  return goalPositionSchema.parse({
    projectionVersion: 'goal-progress-v1',
    goalVersionId: goal.id,
    scopeVersionId: scope.id,
    scopeVersion: scope.version,
    completed,
    required,
    percentage: new Decimal(completed).div(required).mul(100).toDecimalPlaces(1).toFixed(1),
    readiness: outdated
      ? 'outdated'
      : completed === required
        ? hasGaps
          ? 'reviewed_with_gaps'
          : 'preparation_reviewed'
        : pending
          ? 'assessment_pending'
          : !state.preparation?.automatic
            ? 'paused'
            : 'in_progress',
    nextAction,
    href,
    tracks,
    practices,
    remainingHours: remaining.toString(),
    estimatedReadyDate: estimate,
    estimateReason:
      (schedule
        ? 'Using saved effort and daily availability. '
        : 'Suggested estimates: 2 hours/day; shared story 2h, selection 2h; each brief 2h and practice/feedback 4h. ') +
      (waitDate && waitDate >= today
        ? 'Includes the assumed evidence delivery date. '
        : 'Work-only estimate; external waiting is excluded. ') +
      'Preparation estimate, not a funding prediction.',
  });
}

/** Called before the same workspace save that commits the originating state change. */
export function recordGoalProgress(
  state: Workspace,
  jobs: Job[] = [],
  now = new Date(),
): GoalProgressEvent | null {
  const journey = state.preparation?.journey;
  if (!journey) return null;
  const goal = state.preparation?.goals.at(-1);
  if (goal) journey.currentGoalId = goal.id;
  const position = projectGoalPosition(state, jobs, now);
  if (!position) return null;
  const fingerprint = hash({
    ...position,
    href: undefined,
    nextAction: undefined,
    estimatedReadyDate: undefined,
    tracks: position.tracks.map((t) => ({ ...t, href: undefined })),
    assessments: journey.assessments.map((a) => a.id),
    targets: journey.targets.map((t) => ({
      id: t.id,
      status: t.status,
      included: t.included,
      assessmentId: t.assessmentId,
    })),
    schedule: state.preparation?.schedules.at(-1)?.id,
  });
  if (journey.lastFingerprint === fingerprint) return null;
  const previous = journey.events.at(-1);
  let reason = 'Preparation position updated from saved work.';
  if (!journey.lastFingerprint || !previous)
    reason = 'Current baseline captured from saved records; earlier graph history is unavailable.';
  else if (previous.position.goalVersionId !== position.goalVersionId)
    reason = 'Goal revised; previous preparation history is preserved.';
  else if (previous.position.scopeVersionId !== position.scopeVersionId)
    reason = journey.scopes.at(-1)?.reason ?? 'Preparation scope changed.';
  else if (position.completed < previous.position.completed)
    reason = 'Current preparation reopened for a new cycle or changed sources.';
  else if (position.completed > previous.position.completed)
    reason = 'A preparation step was recorded or reviewed.';
  else if (position.readiness === 'assessment_pending')
    reason = 'Practice saved; assessment is pending.';
  const event: GoalProgressEvent = {
    id: randomUUID(),
    journeyId: journey.id,
    sequence: ++journey.lastSequence,
    recordedAt: now.toISOString(),
    reason,
    fingerprint,
    position,
  };
  journey.events.push(event);
  journey.lastFingerprint = fingerprint;
  journey.revision++;
  return event;
}
