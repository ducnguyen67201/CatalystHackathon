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

- `src/contracts/Workspace.ts` and `src/contracts/InvestorTracking.ts` own Zod wire schemas and their inferred types.
- `src/contracts/ProfileLinks.ts` validates canonical public identity URLs. `src/features/InvestorTrackingService.ts` owns investor discovery, per-investor schedules, check history and source-version comparisons. `src/server/InvestorRoutes.ts` exposes these commands under the existing API authorization hooks. `src/web/InvestorTrackingPage.tsx` owns the watchlist UI.
- `src/features/Financials.ts` imports the supplied monthly CSV structure, validates every amount and reconciliation, preserves raw rows and computes exact financial findings with Decimal.js.
- `src/features/InvestorFit.ts` owns explicit criterion matching. Currency must be known and equal before comparing check and raise amounts. Unknown criteria remain unknown.
- `src/features/WorkspaceService.ts` owns profile versions, snapshots, evidence intake, brief history, rehearsal lifecycle, topic checks and follow-up comparisons.
- `src/features/WorkspaceStore.ts` owns the persistence port and concurrency error.
- `src/infrastructure/PrismaStore.ts` maps validated application records to company-scoped tables. Prisma types do not escape the adapter.
- `src/infrastructure/Research.ts` contains only the Exa/OpenAI research adapter. Runtime always injects it. Deterministic research fixtures live under test/fixtures and are excluded from application builds.
- `src/infrastructure/Voice.ts` obtains ElevenLabs conversation tokens, builds brief context and verifies provider webhooks.
- `src/server/Api.ts` owns local session authorization, origin checking, rate limits, validated routes and static production assets. It always binds through the loopback entrypoint.
- `src/server/Worker.ts` owns queue execution and due schedules. `src/jobs/RadarTasks.ts` optionally invokes the same work from Trigger.dev.
- `src/web` owns all browser state, rendering and ElevenLabs React controls.

## Environment and process ownership

Doppler owns the `june-workspace` project and its development settings. `doppler.yaml` selects `dev` for `doppler setup`; no tokens are committed. `doppler run` injects a configuration snapshot into the launched process. Restarting refreshes that snapshot.

`src/server/Env.ts` owns T3 Env/Zod validation. Its functions require caller-supplied values and do not read or mutate global process state. Separate validators cover server, database tooling, local development ports and optional hosted workflow project settings. Validation errors omit values. Missing research credentials leave the dashboard available with researchReady false. Runtime logs configuration_missing; an attempted check throws a safe configuration error before any network request and is recorded as failed. No fictional fallback exists.

`src/server/LoadEnvironment.ts` selects the input source at process entrypoints. Injected environment values win over local file fallback. When Doppler metadata is present, local files are ignored entirely, so missing hosted secrets cannot accidentally come from `.env`. Prisma, setup, API, worker and optional workflow tasks use this same source policy. Tests inject explicit objects.

`scripts/StartDevelopment.ts` validates settings, starts and waits for the local PostgreSQL container, then supervises API, durable worker and Vite processes. The API and worker inherit the supplied settings. `scripts/DevelopmentEnvironment.ts` restricts Vite to OS launch settings and validated local ports. Vite disables dotenv loading and custom client environment exports. Provider and database credentials stay out of the frontend process and browser bundle. On macOS/Linux, shutdown signals reach each child process group, including watchers; a service exit shuts down its siblings. The database container persists independently. When explicitly enabled with `DEV_WEBHOOK_TUNNEL`, the launcher also starts a separate webhook relay and ngrok, and stops both during shutdown.

The local worker owns development workflows. Trigger.dev remains an optional adapter with explicitly supplied project/runtime settings, and is not started by the development launcher. Doppler injection into a local CLI does not provision remote services or synchronize a hosted task environment automatically.

## Storage and consistency

One local workspace is currently supported. Financial snapshots, evidence, brief versions, rehearsals, milestones, notifications, tracked investors and workflow jobs use separate relational tables linked to it. Versioned domain payloads are schema-validated JSON to keep the initial data model small. Financial amounts are decimal strings in those payloads and computed with Decimal.js; presentation may convert to numbers only for formatting and charts.

Workspace writes use an optimistic revision check inside a Prisma transaction. The transaction upserts the aggregate's records while preserving existing snapshots, evidence and brief versions. This aggregate approach is suitable for the small initial sample; large histories should use feature-specific queries and commands rather than loading every record.

Financial snapshots are immutable and keyed by CSV-content/currency hash. Imported raw columns and original row numbers are retained in PostgreSQL; no private object-storage adapter is implemented yet. Company profile currency does not relabel historic financial snapshots. A financial upload uses its own explicitly confirmed currency.

Radar evidence is deduplicated by canonical URL, retrieved-text and extracted-investor hash. Previously saved fictional records retain their labels and IDs for compatibility. The current extractor requires its quoted passage to appear in the retrieved text, then labels the record unverified. Changed retrieved text creates a new immutable evidence version; per-investor checks record newly observed URLs and changed versions of previously seen URLs. Check histories preserve quoted passages and evidence IDs. Cross-page event deduplication and contradictory claim resolution remain future work.

Briefs pin a financial snapshot ID, company profile version and evidence ID. Rehearsals pin a brief ID. A completed review appends a brief version while retaining the original. The topic reviewer is deterministic and explicitly does not certify financial correctness or speaking quality.

## Workflows

Manual checks receive a unique request key. Scheduled checks use the saved due timestamp as their idempotency key. The scheduler submits a durable job before advancing the next timestamp, so a crash between those writes results in deduplicated resubmission.

Workers claim jobs with a compare-and-set status/attempt/token update. A six-minute lease permits recovery after a crash. Completion/failure requires the current claim token, preventing an obsolete worker from finalizing a reclaimed job. Provider timeouts bound live runs. Research runs have no application-level daily attempt limit. Three failed attempts make a job terminal; transient failures retry with delay. New manual runs remain possible.

Database workspace revisions prevent lost updates; a stale company profile during research causes retry with current inputs. Input changes can mark an existing brief stale until a rebuild. Notifications are persisted in-app with their originating evidence; no email delivery exists.

Due open milestones are compared with saved financial evidence and create an in-app review notice. This does not mark the underlying business goal achieved. Schedules store timezone, frequency, next execution and last check. The local worker must remain running for schedules to execute. The optional Trigger.dev entrypoint is a deployment adapter, not an automatically provisioned hosted service.

## Investor tracking loop

Pasted URLs are identity hints for public-source search. Canonicalization accepts HTTPS public domain shapes, rejects credentials/local domains and restricts LinkedIn/X links to profiles. The service does not fetch these URLs directly or access authenticated social sessions. Live extraction requires an exact source quote and a model-declared connection to the target; this is an initial filter, not proof of identity. Every result remains unverified. Company financial rows and goals are not included in search or extraction requests.

Tracked investors are company-scoped Prisma records with schema-validated payloads. Each holds origin (user-added or discovered), a canonical identity key, optional originating evidence, frequency, next due time and check history. Name-based discovery avoids exact-name duplicates but does not resolve aliases or disambiguate same-name investors automatically. The watchlist remains separate from the legacy profile's textual watchlist.

`discover-investors` queues candidate discovery from public company criteria. Discovery creates up to three suggestions in the workspace discovery JSON, without creating tracked investors. Only an explicit Track decision creates a daily monitored investor; Dismiss retains the normalized name for suppression. The worker schedules `investor:<id>` jobs, prioritizing user-added targets among due investors. Every check is bounded to one search and at most five extraction requests. A partial PostgreSQL unique index prevents concurrent active checks for the same investor; requests reuse the active job. This is independent of the existing radar schedule and does not require voice or onboarding changes.

Schedules enqueue before advancing the due timestamp, with the due time as the idempotency key. Daily/weekly frequencies mean 24-hour/7-day intervals. Pausing stops future scheduling, while already queued or manual work can finish. Checks compare their starting investor identity before saving and pin the company profile version; stale-profile results retry rather than being saved. Job IDs prevent duplicate history and notices after a committed check is replayed. Provider failures leave the last successful check unchanged and use the existing delayed retry/terminal failure rules. Empty results are recorded explicitly and do not claim that no real-world changes exist. The state endpoint includes the latest job for each investor even beyond its general recent-job window.

Investor source intake does not automatically build a new meeting brief or mutate a voice session. Evidence IDs and profile versions provide the handoff for that separate feature. This keeps parallel voice and onboarding work independent.

## Voice and continuity

ElevenLabs is optional. With credentials, the API obtains a WebRTC token and the provider's conversation ID before creating the live rehearsal. Dynamic variables carry the compact brief and a previous-session answer summary. The browser uses microphone audio only after the user starts a session. Long-lived credentials never reach the browser.

The API accepts final transcripts only through signature-verified webhooks matching a known provider conversation and configured agent. Duplicate completion does not create another reviewed brief. Browser end requests mark a live session awaiting provider evidence; client transcript data does not finalize it. Written practice uses server-stored turns and remains available without provider configuration. The UI offers the scripted example as a separate, labeled mode.

No raw audio is saved by this application. ElevenLabs-side retention must be configured in the provider account. Browser controls include a ten-minute limit; provider-side session limits should also be configured. Disconnects save partial state; summaries and questions persist across new sessions.

## Local webhook ingress

`src/server/WebhookRelay.ts` exposes only JSON POSTs at the exact ElevenLabs callback path. It forwards raw bytes and the signature to a fixed localhost API URL, with a bounded body size and timeout. Other methods and paths, including the local session and state APIs, return 404. Public responses contain status only; provider payloads and upstream errors are not logged or echoed. HMAC validation and known-conversation checks remain owned by the API.

`StartWebhookRelay.ts` reads only the launcher's injected tunnel settings. The relay and ngrok receive OS launch settings and local ports, not provider or database credentials. Only ngrok receives an optional `NGROK_AUTHTOKEN`; otherwise it uses its existing local authentication. Request inspection is disabled. The tunnel URL can be pinned via `DEV_WEBHOOK_URL`, and failure to bind it stops the development services. This is local development ingress, not a production deployment.

## Current boundaries

The application has a local session cookie, CSRF/origin checks, body limits and rate limiting. It is intentionally single-user and binds only to localhost. Hosted identity/membership authorization, remote deployment, full cash-flow modeling, June accounting integration, outbound messages and investor outreach are not implemented.

Every financial explanation preserves the distinction between operating results and other income. Cash runway, currency and founder-segment facts remain unknown until supported. The sample file's July credit is recorded as other income and is not proof that cash was received then.

Operational logs record bounded event categories and workflow stage/attempt. API failures also record the route pattern and error code, without request bodies; use those fields to diagnose parsing and startup failures. They omit credentials, provider bodies, financial rows, transcripts and raw configuration. Setup and verification commands are maintained in README.md.

## Comparable-company discovery

`InvestorDiscoveryService.ts` owns discovery scheduling and suggestion decisions. `InvestorSuggestionRules.ts` contains browser-safe selection rules. `InvestorDiscovery.ts` owns schedule, suggestion status and comparable-deal contracts. An additive Workspace.discovery JSON column persists schedules, profile versions, decisions and suggestion source references; old tracked investors remain unchanged. The migration also adds a partial unique index for active discovery jobs, and the persistence adapter reuses active jobs across manual and scheduled requests.

Weekly discovery starts after the founder edits the seeded company profile and supplies stage, sector and geography. A profile version change triggers another discovery cycle; pausing disables these automatic triggers but permits manual discovery. Tick enqueue keys and persisted next times prevent repeated work on each poll. Full current trays skip provider calls. Completed-job IDs prevent retrying a saved result from creating duplicate notices. Results computed against a stale profile are rejected. Suggestions from older profile versions remain in history but cannot be tracked as current recommendations.

The live adapter searches segment funding announcements and optionally co-investments involving known investors, interleaves unique results, and extracts up to five documents. The model receives only public segment criteria, public investor names and exclusions, not financial records or private goals. Comparable deals require exact participation and company-description passages from the retrieved document. A matching company sector and funding stage are required before suggesting; geography is displayed separately and an investment does not establish the fund's current mandate. One document yields at most one investor candidate. The worker does not guarantee exhaustive news coverage, company alias resolution, competitor detection, or investment suitability.

The UI keeps the monitored watchlist first and places up to three alternatives below it. Each alternative shows the comparable company, dated source where known, whole-round amount, quoted evidence and unknown individual check size. Track starts immediate and daily investor research; Dismiss suppresses that normalized name. Existing monitored investors are excluded from suggestions. No automatic outreach, brief synthesis or voice-context wiring is added by this workflow.

## Research diagnostics

`features/WorkflowLog.ts` defines the injected workflow logging port and a bounded metadata vocabulary. Runtime injects one `WorkflowLogger` into the service and research provider. The infrastructure logger uses AsyncLocalStorage for asynchronous per-job correlation, validates an allowlisted set of metadata fields and writes JSON lines to stdout. `LOG_LEVEL` belongs to server environment validation. Tests inject a sink or use the default silent logger; domain services have no logging-library or filesystem dependency.

Provider boundaries report request status/timing, extraction acceptance/rejection and safe failure categories without serializing arbitrary exceptions or request/response bodies. Worker events wrap claimed jobs, while save events occur after persistence succeeds. New checks always persist live mode. The evidence/check contracts still accept historical demo labels so existing records can be read without relabeling fictional facts as real. Existing check history is preserved. Operational usage is documented in README.

## Research run archives

`contracts/ResearchRun.ts` owns bounded source, input, decision, archive and import schemas. `features/ResearchRunStore.ts` is the workspace-scoped persistence port. The live adapter collects a typed trace of up to two Exa result batches, up to five extraction decisions and accepted evidence. It awaits archive persistence after extraction, including on provider failure, before returning to the caller. Runtime injects the Prisma-backed archive port into both the provider and workspace service. Each attempt receives a fresh archive ID; job ID, attempt, investor ID and profile version preserve lineage without mixing concurrent runs. No full company profile, financial inputs or private meeting context is copied.

Prisma owns the separate ResearchRun table with immutable JSON payload, a content hash for idempotency, and workspace/investor/job indexes. It is excluded from `/api/state` and aggregate workspace writes so source text is not transmitted on every UI poll. The additive migration preserves previous data. Reads always scope to the local workspace. Same-ID/same-payload writes return the original; conflicting replacement is rejected. Retries are separate attempts, while the existing saved-job guard prevents duplicate checks from running again.

`server/ResearchRunRoutes.ts` exposes session-protected summary/detail reads and raw imports. Imports cannot claim workflow origin, job identity, model extraction, accepted evidence or success; these fields are server-controlled. Archives do not automatically promote facts into the Evidence table, a brief or a scenario. API bodies and stored data are validated; arbitrary provider fields and error bodies are not stored. Public source text is retained as untrusted content and must never be interpolated as instructions by future consumers. Research status describes extraction only; the linked workflow and profile version determine whether results were applied and remain current. Partial traces survive caught errors, but not process termination before final save. Setup and endpoint usage remain in README.
