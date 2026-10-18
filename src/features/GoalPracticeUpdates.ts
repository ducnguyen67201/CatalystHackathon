import type { GoalJourneyView, GoalPracticeUpdate } from '../contracts/GoalJourney.js';
import type { Job, Workspace } from '../contracts/Workspace.js';
import { cycleOutdated } from './ConnectedPreparation.js';
import { projectFollowups } from './Followups.js';

/** Saved reports only. A new investor or UI focus never reattributes an earlier call. */
export function projectGoalPracticeUpdates(state: Workspace, jobs: Job[]): GoalPracticeUpdate[] {
  const journey = state.preparation?.journey;
  if (!journey) return [];
  const followups = projectFollowups(state, jobs, 0, state.rehearsals.length).sessions;
  return journey.targets
    .filter((target) => target.status === 'active')
    .flatMap((target) => {
      const sessions = followups.filter((review) => {
        const session = state.rehearsals.find((item) => item.id === review.id);
        const context = session?.context;
        const lineage = context?.version === 2 ? context.input.preparation : null;
        return lineage?.journeyId === journey.id && lineage.targetId === target.id;
      });
      const latest = sessions[0];
      if (!latest) return [];
      const assessed = sessions.find((review) => {
        const session = state.rehearsals.find((item) => item.id === review.id);
        const evaluation = session?.evaluations.find((item) => item.id === review.evaluationId);
        return (
          review.reviewStatus === 'ready' &&
          !review.partial &&
          session?.status === 'completed' &&
          evaluation?.scope === 'complete' &&
          !!evaluation.report &&
          session.turns.some((turn) => turn.role === 'user' && turn.text.trim())
        );
      });
      const session = state.rehearsals.find((item) => item.id === assessed?.id);
      const evaluation = session?.evaluations.find((item) => item.id === assessed?.evaluationId);
      const report = evaluation?.report;
      const lineage = session?.context?.version === 2 ? session.context.input.preparation : null;
      const current = state.preparation?.connected?.cycles.findLast(
        (cycle) => cycle.targetId === target.id,
      );
      const outdated =
        !!lineage && (!current || current.id !== lineage.cycleId || cycleOutdated(state, current));
      const drill = !outdated
        ? assessed?.tasks.find((task) =>
            ['open', 'needs_evidence', 'review_failed', 'not_comparable'].includes(task.status),
          )
        : null;
      const href = (reviewId: string, taskId?: string) =>
        '/?' +
        new URLSearchParams({
          page: 'followups',
          session: reviewId,
          followupsOffset: String(
            Math.floor(
              Math.max(
                0,
                followups.findIndex((item) => item.id === reviewId),
              ) / 10,
            ) * 10,
          ),
          ...(taskId ? { task: taskId } : {}),
        }).toString() +
        '#practice-' +
        encodeURIComponent(reviewId);
      return [
        {
          targetId: target.id,
          name:
            state.investors.find((item) => item.id === target.investorId)?.name ?? 'Saved investor',
          sessionId: latest.id,
          createdAt: latest.createdAt,
          status: latest.reviewStatus,
          assessedSessionId: assessed?.id ?? null,
          assessedAt: evaluation?.completedAt ?? null,
          fictional: latest.fictional || !!assessed?.fictional,
          partial: latest.partial,
          outdated,
          summary: report?.coaching.summary ?? null,
          strengths: report?.coaching.strengths?.map((strength) => strength.statement) ?? [],
          improvements:
            assessed?.tasks
              .filter((task) => task.status === 'improved')
              .map((task) => (task.comparison ?? task.title).slice(0, 3000)) ?? [],
          nextPractice: drill
            ? {
                question: drill.practiceQuestion,
                reason: drill.gap,
                href: href(assessed?.id ?? latest.id, drill.id),
              }
            : null,
          reviewHref: href(assessed?.id ?? latest.id),
        },
      ];
    });
}

/** Leads remain outside plan scope until the founder explicitly chooses them in Radar. */
export function projectGoalRadarOpportunities(
  state: Workspace,
): GoalJourneyView['radarOpportunities'] {
  const journey = state.preparation?.journey;
  if (!journey) return [];
  const names = new Set(
    journey.targets.map((target) =>
      state.investors
        .find((investor) => investor.id === target.investorId)
        ?.name.trim()
        .toLowerCase(),
    ),
  );
  const seen = new Set<string>();
  return [...state.radar.events]
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .filter((event) => {
      const key = event.investorName.trim().toLowerCase();
      if (
        seen.has(key) ||
        names.has(key) ||
        event.dismissedAt ||
        event.historical ||
        event.profileVersion !== state.profile.version ||
        state.radar.events.some((item) => item.supersedesEventId === event.id) ||
        journey.targets.some((target) => target.investorId === event.investorId) ||
        !state.evidence.some((source) => source.id === event.evidenceId)
      )
        return false;
      if (
        event.suggestionId &&
        !state.discovery.suggestions.some(
          (suggestion) =>
            suggestion.id === event.suggestionId &&
            suggestion.status === 'suggested' &&
            suggestion.profileVersion === state.profile.version,
        )
      )
        return false;
      if (
        !event.suggestionId &&
        !state.investors.some((investor) => investor.id === event.investorId)
      )
        return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((event) => ({
      eventId: event.id,
      name: event.investorName,
      headline: event.signal.headline,
      fictional:
        event.fictional ||
        state.evidence.some((source) => source.id === event.evidenceId && source.mode === 'demo'),
      href: '/?page=radar&radarEvent=' + encodeURIComponent(event.id),
    }));
}
