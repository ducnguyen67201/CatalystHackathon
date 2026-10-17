# June implemented architecture

June is one standalone pnpm root using strict TypeScript. The React/Vite client talks to a Fastify API over same-origin `/api` requests. Prisma 7 and its PostgreSQL driver adapter own database access. The separate worker processes durable jobs from the same database.

```text
React UI ----- HTTP -----> Fastify API ----- Prisma -----> PostgreSQL
  |                            |                             ^
  |                            +---- enqueue workflow -------+
  |                                                          |
  +--- WebRTC ---> ElevenLabs             Local / hosted worker
                       |                          |
                       +--- verified webhook ---> API
                                                  |
                                          Review -> brief version
```

## Ownership

- `src/contracts/Workspace.ts` owns Zod wire schemas and their inferred types.
- `src/features/Financials.ts` imports the supplied monthly CSV structure, validates every amount and reconciliation, preserves raw rows and computes exact financial findings with Decimal.js.
- `src/features/InvestorFit.ts` owns explicit criterion matching. Currency must be known and equal before comparing check and raise amounts. Unknown criteria remain unknown.
- `src/features/WorkspaceService.ts` owns profile versions, snapshots, evidence intake, brief history, rehearsal lifecycle, topic checks and follow-up comparisons.
- `src/features/WorkspaceStore.ts` owns the persistence port and concurrency error.
- `src/infrastructure/PrismaStore.ts` maps validated application records to company-scoped tables. Prisma types do not escape the adapter.
- `src/infrastructure/Research.ts` contains fictional and Exa/model-backed research adapters. The application chooses one mode explicitly at startup.
- `src/infrastructure/Voice.ts` obtains ElevenLabs conversation tokens, builds brief context and verifies provider webhooks.
- `src/server/Api.ts` owns local session authorization, origin checking, rate limits, validated routes and static production assets. It always binds through the loopback entrypoint.
- `src/server/Worker.ts` owns queue execution and due schedules. `src/jobs/RadarTasks.ts` optionally invokes the same work from Trigger.dev.
- `src/web` owns all browser state, rendering and ElevenLabs React controls.

## Storage and consistency

One local workspace is currently supported. Financial snapshots, evidence, brief versions, rehearsals, milestones, notifications and workflow jobs use separate relational tables linked to it. Versioned domain payloads are schema-validated JSON to keep the initial data model small. Financial amounts are decimal strings in those payloads and computed with Decimal.js; presentation may convert to numbers only for formatting and charts.

Workspace writes use an optimistic revision check inside a Prisma transaction. The transaction upserts the aggregate's records while preserving existing snapshots, evidence and brief versions. This aggregate approach is suitable for the small initial sample; large histories should use feature-specific queries and commands rather than loading every record.

Financial snapshots are immutable and keyed by CSV-content/currency hash. Imported raw columns and original row numbers are retained in PostgreSQL; no private object-storage adapter is implemented yet. Company profile currency does not relabel historic financial snapshots. A financial upload uses its own explicitly confirmed currency.

Radar evidence is deduplicated by canonical URL hash in live mode and a stable fixture key in demo mode. The current extractor requires its quoted passage to appear in the retrieved text, then labels the record unverified. Cross-page event deduplication, contradictory claim resolution and source change tracking remain future work.

Briefs pin a financial snapshot ID, company profile version and evidence ID. Rehearsals pin a brief ID. A completed review appends a brief version while retaining the original. The topic reviewer is deterministic and explicitly does not certify financial correctness or speaking quality.

## Workflows

Manual checks receive a unique request key. Scheduled checks use the saved due timestamp as their idempotency key. The scheduler submits a durable job before advancing the next timestamp, so a crash between those writes results in deduplicated resubmission.

Workers claim jobs with a compare-and-set status/attempt/token update. A six-minute lease permits recovery after a crash. Completion/failure requires the current claim token, preventing an obsolete worker from finalizing a reclaimed job. Provider timeouts bound live runs. Research attempts are capped per UTC day (ten by default), counted in PostgreSQL. Three failed attempts make a job terminal; transient failures retry with delay. New manual runs remain possible.

Database workspace revisions prevent lost updates; a stale company profile during research causes retry with current inputs. Input changes can mark an existing brief stale until a rebuild. Notifications are persisted in-app with their originating evidence; no email delivery exists.

Due open milestones are compared with saved financial evidence and create an in-app review notice. This does not mark the underlying business goal achieved. Schedules store timezone, frequency, next execution and last check. The local worker must remain running for schedules to execute. The optional Trigger.dev entrypoint is a deployment adapter, not an automatically provisioned hosted service.

## Voice and continuity

ElevenLabs is optional. With credentials, the API obtains a WebRTC token and the provider's conversation ID before creating the live rehearsal. Dynamic variables carry the compact brief and a previous-session answer summary. The browser uses microphone audio only after the user starts a session. Long-lived credentials never reach the browser.

The API accepts final transcripts only through signature-verified webhooks matching a known provider conversation and configured agent. Duplicate completion does not create another reviewed brief. Browser end requests mark a live session awaiting provider evidence; client transcript data does not finalize it. Written practice uses server-stored turns and remains available without provider configuration. The UI offers the scripted example as a separate, labeled mode.

No raw audio is saved by this application. ElevenLabs-side retention must be configured in the provider account. Browser controls include a ten-minute limit; provider-side session limits should also be configured. Disconnects save partial state; summaries and questions persist across new sessions.

## Current boundaries

The application has a local session cookie, CSRF/origin checks, body limits and rate limiting. It is intentionally single-user and binds only to localhost. Hosted identity/membership authorization, remote deployment, full cash-flow modeling, June accounting integration, outbound messages and investor outreach are not implemented.

Every financial explanation preserves the distinction between operating results and other income. Cash runway, currency and founder-segment facts remain unknown until supported. The sample file's July credit is recorded as other income and is not proof that cash was received then.

Operational logs record bounded event categories and workflow stage/attempt. API failures also record the route pattern and error code, without request bodies; use those fields to diagnose parsing and startup failures. They omit credentials, provider bodies, financial rows, transcripts and raw configuration. Setup and verification commands are maintained in README.md.
