import { investorNameKey } from './InvestorSuggestionRules.js';
import { createHash, randomUUID } from 'node:crypto';
import { radarEventSchema, type RadarEvent, type Delivery } from '../contracts/RadarDelivery.js';
import type { Workspace, Evidence } from '../contracts/Workspace.js';

export function pendingDelivery(eventId: string | null, revision: number, now: string): Delivery {
  return {
    id: randomUUID(),
    eventId,
    kind: eventId ? 'event' : 'confirmation',
    recipientRevision: revision,
    status: 'pending',
    attempts: 0,
    uncertain: false,
    createdAt: now,
    nextAt: now,
    firstAttemptAt: null,
    leaseToken: null,
    leaseUntil: null,
    providerMessageId: null,
    acceptedAt: null,
    error: null,
    message: null,
  };
}
export function suppressionReason(state: Workspace, event: RadarEvent): string | null {
  const prefs = state.radar.preferences;
  if (!prefs.enabled || !prefs.recipient) return 'Email alerts are off or no address is confirmed.';
  if (event.historical || event.fictional)
    return 'Historical or fictional evidence is not emailed.';
  if (event.signal.needsReview || !event.signal.notificationEligible)
    return 'Research requires review or is not eligible.';
  if (event.profileVersion !== state.profile.version)
    return 'Company context changed; awaiting new research.';
  if (event.dismissedAt || state.radar.events.some((item) => item.supersedesEventId === event.id))
    return 'Update dismissed or superseded.';
  if (!prefs.categories.includes(event.signal.category)) return 'This email category is disabled.';
  if (event.suggestionId) {
    const suggestion = state.discovery.suggestions.find((item) => item.id === event.suggestionId);
    if (!suggestion || suggestion.status === 'dismissed')
      return 'Candidate was dismissed or is unavailable.';
  }
  if (event.investorId && !state.investors.some((item) => item.id === event.investorId))
    return 'Investor unavailable.';
  if (!state.evidence.some((item) => item.id === event.evidenceId)) return 'Source unavailable.';
  return null;
}
/** Called inside the same revision-checked transaction as check/suggestion persistence. No provider calls. */
export function publishRadarResult(
  state: Workspace,
  evidence: Evidence,
  subject: { investorId: string | null; suggestionId: string | null },
  jobId: string | null,
  historical = false,
  profileVersion = state.profile.version,
): void {
  if (!evidence.signal || !state.evidence.some((item) => item.id === evidence.id)) return;
  if (Boolean(subject.investorId) === Boolean(subject.suggestionId)) return;
  const investor = state.investors.find((item) => item.id === subject.investorId);
  const suggestion = state.discovery.suggestions.find((item) => item.id === subject.suggestionId);
  if (!investor && !suggestion) return;
  if (evidence.url) {
    const url = new URL(evidence.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(url.hostname) ||
      /\.(local|localhost|internal|test|invalid)$/.test(url.hostname)
    )
      return;
  } else return;
  const signal = {
    ...evidence.signal,
    ...(suggestion ? { category: 'new_candidate' as const } : {}),
  };
  const subjectKey = investor?.key ?? `name:${investorNameKey(suggestion?.name ?? '')}`;
  // Quote identity also suppresses unrelated edits to the rest of an already observed page.
  const dedupeKey = createHash('sha256')
    .update(
      JSON.stringify([
        state.id,
        subjectKey,
        signal.category,
        signal.canonicalEventKey ?? [evidence.url, signal.supportingQuote],
      ]),
    )
    .digest('hex');
  if (state.radar.events.some((item) => item.dedupeKey === dedupeKey)) return;
  if (
    investor &&
    state.radar.events.some(
      (item) =>
        item.investorId === investor.id &&
        item.suggestionId &&
        item.signal.supportingQuote === signal.supportingQuote &&
        state.evidence.find((e) => e.id === item.evidenceId)?.url === evidence.url,
    )
  )
    return;
  const now = new Date().toISOString();
  const event = radarEventSchema.parse({
    id: randomUUID(),
    resultId: dedupeKey,
    dedupeKey,
    researchRunId: evidence.researchRunId ?? null,
    jobId,
    ...subject,
    investorName: investor?.name ?? suggestion?.name,
    profileVersion,
    signal,
    evidenceId: evidence.id,
    occurredAt: evidence.publishedAt,
    observedAt: evidence.discoveredAt,
    committedAt: now,
    readAt: null,
    dismissedAt: null,
    supersedesEventId: evidence.supersedesEvidenceId
      ? (state.radar.events.find(
          (item) =>
            item.evidenceId === evidence.supersedesEvidenceId &&
            item.investorId === subject.investorId &&
            item.suggestionId === subject.suggestionId,
        )?.id ?? null)
      : null,
    historical,
    fictional: evidence.mode === 'demo',
  });
  state.radar.events.push(event);
  if (!suppressionReason(state, event))
    state.radar.deliveries.push(
      pendingDelivery(event.id, state.radar.preferences.recipientRevision, now),
    );
}
