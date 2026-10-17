import type { FollowupTask, FollowupsResponse } from '../contracts/Followups.js';
import type { Coaching, EvaluationRecord } from '../contracts/RehearsalEvaluation.js';
import type { Job, Rehearsal, Workspace } from '../contracts/Workspace.js';
import type { RadarSignal } from '../contracts/RadarDelivery.js';

const updateActions: Record<RadarSignal['category'], { title: string; steps: string[] }> = {
  thesis_change: {
    title: 'Revisit your pitch against the reported investor focus',
    steps: [
      'Verify the reported focus in the linked source.',
      'Prepare one example of how your company fits, and one question to clarify any mismatch.',
    ],
  },
  investment: {
    title: 'Prepare for a question about this portfolio investment',
    steps: [
      'Read the announcement and confirm which company received the investment.',
      'Explain how your company differs or complements it; do not assume the investor will fund a similar company.',
    ],
  },
  fund_announcement: {
    title: 'Check what this fund announcement means for your meeting',
    steps: [
      'Confirm the announced fund mandate and stage in the source.',
      'Prepare a question about fit and deployment timing; fund size does not establish a check size.',
    ],
  },
  other_news: {
    title: 'Prepare a question about this investor update',
    steps: [
      'Verify the source and whether the update affects this meeting.',
      'Write one relevant question and revise your scenario if the update changes your preparation.',
    ],
  },
  new_candidate: {
    title: 'Recheck the investor fit behind this new research',
    steps: [
      'Verify the investor identity and source.',
      'Compare the reported focus with your company and prepare a question about any unknown fit criteria.',
    ],
  },
};

function taskFor(
  state: Workspace,
  jobs: Job[],
  session: Rehearsal,
  evaluation: EvaluationRecord,
  item: Coaching['items'][number],
): FollowupTask {
  const responses = session.evaluationResponses.filter(
    (r) => r.evaluationId === evaluation.id && r.itemId === item.id,
  );
  const response = responses.at(-1);
  const retry =
    response?.kind === 'practice' ? state.rehearsals.find((s) => s.id === response.id) : null;
  const next =
    response?.kind === 'clarification'
      ? session.evaluations.findLast((e) => e.requestKey === response.requestKey)
      : retry?.evaluations.findLast(
          (e) => e.parentEvaluationId === evaluation.id && e.parentItemId === item.id,
        );
  const failed =
    next &&
    jobs.some(
      (j) => j.kind === `evaluate:${retry?.id ?? session.id}:${next.id}` && j.status === 'failed',
    );
  let status: FollowupTask['status'] = 'open';
  if (response?.kind === 'dismissed') status = 'dismissed';
  else if (next?.status === 'queued') status = failed ? 'review_failed' : 'pending';
  else if (next?.status === 'completed')
    status = next.report?.coaching.comparison?.outcome ?? 'not_comparable';
  else if (next?.status === 'skipped') status = 'not_comparable';
  const context = session.evaluationContext;
  const facts = context?.facts.filter((f) => item.factIds.includes(f.id)) ?? [];
  const sourceIds = new Set([
    ...item.sourceIds,
    ...item.investorSourceIds,
    ...facts.flatMap((f) => f.sourceIds),
  ]);
  return {
    id: item.id,
    title: item.suggestion,
    gap: item.gap,
    steps: item.analysis?.preparationSteps ?? [item.suggestion],
    missingInputs: item.missingInputs,
    practiceQuestion: item.practiceQuestion,
    successCriteria: item.successCriteria,
    quote: evaluation.report?.extraction.claims.find((c) => c.id === item.claimId)?.quote ?? '',
    sources: context?.sources.filter((s) => sourceIds.has(s.id)) ?? [],
    facts,
    status,
    comparison: next?.report?.coaching.comparison?.explanation ?? next?.reason ?? null,
    retrySessionId: retry?.id ?? null,
  };
}

/** Read-only projection of saved coaching. No inference, backfill, or mutation of frozen evidence. */
export function projectFollowups(
  state: Workspace,
  jobs: Job[],
  offset = 0,
  limit = 10,
): FollowupsResponse {
  const retries = new Set(
    state.rehearsals.flatMap((s) =>
      s.evaluationResponses.filter((r) => r.kind === 'practice').map((r) => r.id),
    ),
  );
  const sessions = state.rehearsals
    .filter((s) => s.status !== 'active' && !retries.has(s.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const superseded = new Set(
    state.radar.events.flatMap((e) => (e.supersedesEventId ? [e.supersedesEventId] : [])),
  );
  return {
    nextOffset: offset + limit < sessions.length ? offset + limit : null,
    sessions: sessions.slice(offset, offset + limit).map((session) => {
      const context = session.evaluationContext;
      const practice = session.context?.version === 2 ? session.context : null;
      const contextAt = practice?.input.capturedAt ?? context?.capturedAt ?? null;
      const evaluation = session.evaluations.findLast((e) => e.parentEvaluationId === null);
      const frozenIds = new Set(context?.sources.map((s) => s.id) ?? []);
      const updates =
        context?.investorId && contextAt
          ? state.radar.events
              .filter(
                (event) =>
                  event.investorId === context.investorId &&
                  event.profileVersion === state.profile.version &&
                  !event.historical &&
                  !event.dismissedAt &&
                  !superseded.has(event.id) &&
                  Date.parse(event.observedAt) > Date.parse(contextAt) &&
                  !frozenIds.has(`investor:${event.evidenceId}`) &&
                  state.evidence.some((e) => e.id === event.evidenceId),
              )
              .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id))
          : [];
      return {
        id: session.id,
        createdAt: session.createdAt,
        scenario: practice?.scenario.title ?? context?.scenario ?? 'Saved practice',
        selection: practice?.selection ?? null,
        contextAt,
        investorId: context?.investorId ?? null,
        investorName: context?.investorName ?? null,
        fictional:
          evaluation?.legacyDemo === true ||
          practice?.generationMode === 'demo' ||
          (context?.sources.some((s) => s.origin === 'fictional') ?? false),
        partial: session.status === 'partial',
        evaluationId: evaluation?.id ?? null,
        reviewStatus:
          evaluation?.status === 'completed'
            ? 'ready'
            : evaluation?.status === 'skipped'
              ? 'skipped'
              : evaluation
                ? jobs.some(
                    (j) =>
                      j.kind === `evaluate:${session.id}:${evaluation.id}` && j.status === 'failed',
                  )
                  ? 'failed'
                  : 'queued'
                : session.status === 'awaiting_transcript'
                  ? 'awaiting_transcript'
                  : 'unavailable',
        tasks:
          evaluation?.status === 'completed'
            ? (evaluation.report?.coaching.items.map((item) =>
                taskFor(state, jobs, session, evaluation, item),
              ) ?? [])
            : [],
        investorUpdates: updates.slice(0, 3).map((event) => ({
          id: event.id,
          ...updateActions[event.signal.category],
          headline: event.signal.headline,
          summary: event.signal.summary,
          quote: event.signal.supportingQuote,
          url: state.evidence.find((e) => e.id === event.evidenceId)?.url ?? null,
          observedAt: event.observedAt,
          occurredAt: event.occurredAt,
          fictional:
            event.fictional ||
            state.evidence.find((e) => e.id === event.evidenceId)?.mode === 'demo',
          needsReview: event.signal.needsReview,
        })),
        additionalUpdates: Math.max(0, updates.length - 3),
      };
    }),
  };
}
