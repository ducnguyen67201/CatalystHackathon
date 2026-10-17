# Investor radar result delivery

Status: agreed product scope; engineering proposal, not implemented by this documentation change.

Baseline: remote `main` at `45374a0`, including the merged investor-research work. This spec supersedes any broader implementation scope implied by the [interactive preview](previews/InvestorRadarPreview.html) or its [exploration notes](InvestorRadarPreview.md).

## Outcome and ownership

When the existing research worker commits a newly classified investor result, June shows it in Investor Radar and can email the founder about a meaningful update. Reopening the radar reads saved data; it does not repeat research or classification.

The upstream research workflow owns search, extraction, identity assessment, classification, evidence, and any explanation of relevance. This feature owns validated intake of committed results, feed presentation, duplicate suppression, founder notification preferences, and reliable email delivery. It must not create a second research or classification pipeline.

Email means a notification to the configured founder recipient, not outreach to an investor. SMS, investor outreach, hosted deployment, provider provisioning, extraction replay, and changes to voice/video context are outside this release. The earlier preview's meeting-brief dialog illustrates a possible future handoff; it is not an implementation requirement for this release.

## End-to-end flow

```text
EXISTING RESEARCH WORKFLOW
  Scheduled or manual research
       |
  Search -> extract -> assess identity -> classify
       |
  Save immutable research trace
       |
  Commit workspace result + evidence + result publication record
       |                                (atomic transaction)
       | durable handoff
       v
THIS FEATURE
  Result consumer
       |
       +-- Validate IDs, source references and contract version
       +-- Reuse upstream category and relevance explanation
       +-- Suppress replayed or equivalent updates
       |
  Commit RadarEvent + email outbox entry (atomic transaction)
       |
       +---------------------------+
       |                           |
       v                           v
  Investor Radar             Email delivery worker
  - New leads                - Recheck preferences
  - Related news             - Send with idempotency key
  - What changed             - Save provider receipt
  - Why it matters           - Retry transient failures
  - Evidence / review state  - Surface terminal failure
       |                           |
       +-----------+---------------+
                   v
             Founder reviews

No new result -> no new feed item -> no email
Browser closes -> workers continue while their processes run
```

Use the existing PostgreSQL-backed worker and Prisma persistence. A separate queue product, public webhook, and remote agent are unnecessary for the local release. Extend persistence through narrow ports; domain services should not call Prisma or an email provider directly.

## Committed-result contract

Current main has `ResearchRun`, `InvestorCheck`, `InvestorSuggestion`, and versioned `Evidence`. It does not yet define a general classified-news event envelope. The producer and consumer need the following explicit handoff. Existing evidence intake decisions such as `accepted` or `identity_mismatch` are not news categories.

| Field                                 | Requirement                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                       | Literal version, starting at 1; reject unsupported versions                                             |
| `resultId`                            | Stable producer-assigned ID; preserved across delivery retries                                          |
| `workspaceId`                         | Must resolve to the local workspace; never trust client-selected ownership                              |
| `researchRunId`, `jobId`              | References to the persisted producer attempt and workflow                                               |
| `subject`                             | Exactly one tracked investor ID or candidate suggestion ID; no name-only association                    |
| `profileVersion`                      | Company criteria version used for relevance assessment                                                  |
| `classification`                      | Producer category: `new_candidate`, `investment`, `fund_announcement`, `thesis_change`, or `other_news` |
| `headline`, `summary`, `whyItMatters` | Bounded source-backed producer text; explanation may be absent and displayed as unavailable             |
| `evidenceIds`                         | Nonempty references to immutable source versions in the same workspace                                  |
| `occurredAt`                          | Optional event/publication date; do not invent it from retrieval time                                   |
| `observedAt`, `committedAt`           | Separate retrieval and committed-result timestamps                                                      |
| `reviewStatus`                        | Preserve upstream uncertainty: `unverified` or `needs_review`; never infer verification from success    |
| `notificationEligible`                | Upstream relevance decision; downstream policy may suppress, never upgrade                              |
| `canonicalEventKey`                   | Optional producer identity for one event reported by multiple pages                                     |
| `supersedesResultId`                  | Optional explicit correction reference; retain the original result                                      |

Define strict Zod schemas at the handoff and API boundaries. Bound text lengths and array sizes, validate public HTTPS source URLs, and reject unknown/mismatched references. Store invalid handoffs with a bounded rejection reason for investigation; do not create feed recommendations or email from them. Render source text as escaped text, never executable markup or instructions.

If the producer cannot supply a category or relevance explanation, expose the existing evidence in research details and record a contract gap. Do not fabricate an investment event, run another model in the consumer, or advertise a result as a qualified lead.

`ResearchRun.status === succeeded` only means provider extraction completed. It does not establish that the later workspace write succeeded. Publish the handoff atomically with the successful workspace/check/suggestion write. A durable publication record must survive a crash before consumer enqueue; the worker can claim pending records after restart. Archival source-only imports remain source-only and cannot use this route to assert classified results.

## Persistence and duplicate handling

Use additive tables/migrations and preserve all financial snapshots, source versions, and historical briefs.

```text
CommittedResearchResult
  workspaceId + resultId (unique)
  payload, payloadHash, committedAt, consumedAt, lastErrorCode

RadarEvent
  id, workspaceId, resultId, subject, classification
  immutable payload + evidence references + timestamps
  dedupeKey (unique per workspace), supersedesEventId
  seenAt, dismissedAt

NotificationPreferences
  workspaceId, emailEnabled (default false)
  confirmedRecipient, recipientRevision
  enabledCategories, updatedAt

NotificationDelivery
  id, workspaceId, eventId, channel=email, recipientRevision
  unique(eventId, channel, recipientRevision)
  status, attempts, nextAttemptAt, leaseToken, leaseExpiresAt
  providerMessageId, lastErrorCode, acceptedAt
```

Consume a result, insert its radar event, create any eligible delivery, and mark its publication consumed in one transaction. A database uniqueness constraint is authoritative under concurrent workers. Replayed `resultId` with the same body is a no-op; a different body is a conflict, not an overwrite.

Use an upstream canonical event key when available. Otherwise deduplicate the subject, category, and sorted immutable evidence IDs. The fallback prevents replay duplicates but cannot guarantee that two different pages about the same event are merged. Do not claim semantic cross-page deduplication unless the producer provides a stable event identity. A changed page alone does not justify an investor-news alert.

Corrections append a new event referencing the earlier event. Deleted, dismissed, superseded, or stale recommendations must not silently return as new leads. Tracking a candidate preserves its event history and links it to the new tracked investor; it does not resend the original candidate notification.

## Email policy and delivery

V1 sends one immediate email for each newly committed, eligible event. It does not implement digests, quiet hours, or SMS. Those were exploration ideas, not requirements for this release. Users can disable email and select categories. Initial history backfill populates the radar without emailing old results; enabling email does not drain historical events into the inbox.

Send only when all conditions hold: the producer marked the result eligible, identity does not need review, references are valid, the relevance profile is current, email is enabled, the recipient is confirmed, and that category is enabled. An unverified but source-backed claim may qualify under producer policy; the email must retain its unverified label. Source-only runs, failed workflows, unknown identity, unchanged checks, and rejected extraction results never generate lead emails.

Before sending, recheck preferences, subject dismissal, correction state, and current profile version. Suppress with a recorded reason if they changed. A recipient change invalidates pending deliveries to the old revision; it does not forward old queued alerts automatically. Turning email off suppresses pending sends, although a request already accepted by the provider cannot be recalled.

```text
pending -> sending -> sent (provider accepted, not proven delivered)
              |
              +-> transient failure -> retry_wait -> sending
              +-> permanent failure ----------------> failed
              +-> uncertain provider outcome -------> unknown

pending / retry_wait -> skipped (preferences or eligibility changed)
```

Claim sends with a lease and compare-and-set token; reject finalization by stale workers. Use finite provider timeouts, honor `Retry-After`, and use capped exponential backoff with jitter. Proposed defaults: at most five send attempts, starting at one minute, capped at one hour. Exhaustion creates an in-app delivery failure and a manual retry option for the same delivery ID.

The provider adapter must support a stable delivery idempotency key and a way to reconcile an uncertain response within its retention window. If the provider accepted a request but persistence failed, reconcile or retry with that same key. Do not promise exactly-once email, blindly resend after the provider's deduplication window, or retry an `unknown` outcome without reconciliation. Permanent address/configuration failures require correction before retry.

Email contains a bounded headline, investor/candidate name, summary, source-backed relevance explanation, event date if known, uncertainty label, source links, and a radar deep link. Exclude financial rows, meeting notes, transcripts, credentials, and raw search payloads. Email must remain useful without opening localhost. A local radar link works only on the computer running June; do not expose the app or invent a hosted URL for mobile access.

Keep recipient settings and delivery logs out of public operational logs. Use a provider abstraction and a fake sink in tests. Provider selection, credential setup, sender-domain configuration, and actual email sends are separate authorized operational steps; this documentation PR performs none of them.

## Investor Radar UI

```text
+------------------------------------------------------------------+
| INVESTOR RADAR                         Worker: waiting for next job|
| Last check: <time>                     Next due: <time>            |
+----------------------+-------------------------------------------+
| Following            | Updates                    [Unread] [All] |
|                      |                                           |
| Northline Ventures   | NEW INVESTMENT                            |
|   1 unread           | Northline backs Relayworks                |
|                      | <Published date or "Date unknown">        |
| New candidates       |                                           |
|   2 to review        | What happened                             |
|                      | <Saved research summary>                  |
| Needs review         |                                           |
|   1 unresolved       | Why it matters                            |
|                      | <Producer's relevance explanation>        |
|                      |                                           |
|                      | Unverified | Source | Original passage    |
|                      | Email: sent (provider accepted)           |
|                      |                                           |
|                      | [Open source] [Mark read]                 |
+----------------------+-------------------------------------------+
| Email alerts: Off / On     Recipient: <masked address>            |
| Categories: New candidates / Investments / Funds / Thesis / Other |
+------------------------------------------------------------------+

Names and counts above are fictional UI examples.
```

Show a global recent-updates feed and filter by investor, category, or unread state. New candidates remain suggestions until tracked. Candidate actions reuse existing Track/Dismiss commands; related news uses existing investor IDs. Never attach a result based solely on a matching name. Offer Sources and Check history alongside the news feed; raw-only failures remain inspectable there and in Needs review.

Each update shows what happened, why it matters, source provenance, publication date versus observation time, uncertainty, unread state, and email status. Unknown fields remain unknown. Historical items assessed against an older company profile are labeled accordingly; suppress pending recommendation emails until upstream reassessment.

Email failure does not remove a radar item. Marking an item read only changes unread state; it does not cancel email. A deep link opens the exact saved event, even after newer results arrive. Reading, filtering, and opening details must never start research or send notifications.

Background status must reflect worker evidence. Add a process heartbeat every 15 seconds and label it stale after 60 seconds; store current job and latest completion separately. Show `waiting`, `checking`, `retrying`, `blocked`, `offline`, or user `paused`, with applicable timestamps. Do not infer health from a schedule being enabled. A worker heartbeat proves process liveness, not successful provider access. UI polling pauses in hidden tabs and uses the existing read rate-limit budget. A computer asleep or worker stopped is offline, not continuously researching.

## API and module plan

All paths below are proposed and use existing local-session, origin, validation, and rate-limit controls. No unauthenticated public ingest endpoint is introduced.

| Surface                                       | Responsibility                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `contracts/RadarDelivery.ts`                  | Result envelope, feed event, preference and delivery-status schemas                            |
| `features/RadarResultService.ts`              | Validate committed references, deterministic deduplication, feed/outbox transaction            |
| `features/NotificationDeliveryService.ts`     | Eligibility recheck, leases, retries, status transitions                                       |
| `infrastructure/PrismaStore.ts`               | Implement narrow persistence ports and atomic publication/outbox operations                    |
| `infrastructure/EmailNotifications.ts`        | Provider adapter, safe template rendering, idempotency and reconciliation                      |
| `server/Worker.ts`                            | Consume durable result publications and due email deliveries; heartbeat                        |
| `server/RadarRoutes.ts`                       | Authenticated feed, read state, preferences and retry commands                                 |
| `web/InvestorTrackingPage.tsx`                | Investor-scoped updates, sources, review state and delivery status                             |
| `GET /api/radar/events`                       | Bounded cursor pagination; optional subject/category/unread filters                            |
| `GET /api/radar/events/:id`                   | Exact saved event with accessible evidence references                                          |
| `PATCH /api/radar/events/:id/read`            | Idempotent read/unread update                                                                  |
| `GET /api/radar/status`                       | Heartbeat, active job, last completed check, next due, safe failure category                   |
| `GET/PUT /api/notification-preferences`       | Confirmed founder destination, enablement and categories; recipient confirmation flow required |
| `POST /api/notification-deliveries/:id/retry` | Recheck policy and retry an eligible failed send; never blindly resend an unknown outcome      |

The application still serves one local workspace. Adding hosted operation requires account/membership authorization and a deployment design before exposing these routes. Preserve current loopback bindings. Existing archive APIs continue to return original research traces; they do not authorize promotional events or email.

## Acceptance and rollout

1. A committed, classified investment update creates one radar event and one eligible email delivery with the original evidence references and relevance text. An eligible new-candidate result behaves the same way without auto-tracking it.
2. A run archived successfully but followed by a failed/stale workspace write creates no event or email. Restarting between workspace commit and consumption recovers the durable publication.
3. Concurrent/repeated delivery of the same producer result creates no duplicates. Changed content with the same ID is rejected. A canonical event key suppresses repeat reporting across source pages when supplied.
4. Source-only imports, missing extraction, identity mismatches, stale relevance, and unchanged checks do not generate lead emails. The supplied Duc sample remains inspectable with zero extracted claims.
5. Corrections preserve older records and suppress pending superseded recommendations. Tracking a candidate keeps its previous news without resending it.
6. With email disabled, the radar still receives new updates. Enabling alerts, changing recipients, dismissing candidates, and changing company context follow the explicit suppression rules above.
7. Simulate crashes before send, after provider acceptance, and before final persistence. Recover using leases/idempotency/reconciliation without falsely claiming delivery or blindly duplicating mail.
8. Simulate throttling, timeouts, permanent address failures, exhausted retries, stale lease finalization, and unknown outcomes. Surface bounded status in the UI without leaking provider bodies or recipient addresses into logs.
9. The radar supports empty, loading, no-news, populated, needs-review, offline, retrying, and delivery-failed states. Source links and dates are readable, keyboard controls work, and mobile layouts do not overflow.
10. Opening the feed, source details, history, or an email deep link makes no research/model call and schedules no email. Old financial snapshots, evidence, and brief versions remain unchanged.

Implement contract/publication support first, then radar persistence/UI, then disabled-by-default email delivery and preferences. Backfill saved events with email suppressed. Test with fictional fixtures and a fake email adapter; run integration tests against the repository's temporary PostgreSQL database. Complete `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:integration` before handing off implementation.

Release gate: confirm the producer's category/relevance contract and commit boundary, select an email adapter meeting the idempotency/reconciliation requirements, and implement recipient confirmation before enabling outbound delivery. Shipping this spec and preview does not activate that delivery path.
