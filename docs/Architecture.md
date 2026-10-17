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
- `src/infrastructure/Voice.ts` obtains ElevenLabs conversation tokens, retains the legacy brief-context builder and verifies provider webhooks. `src/features/PracticeContextProvider.ts` owns the independent context port and its empty implementation.
- `src/server/Api.ts` owns session authorization, origin checking, rate limits, validated routes and static production assets. Local mode binds to loopback; explicit hosted mode binds to the container interface and Railway port. `HostedAccess.ts` defaults to configured account authentication and shared-workspace membership. Explicit `HOSTED_ACCESS_MODE=public-demo` opens the same workspace without login; API origin/session checks and provider signature verification still apply. See [Railway deployment](RailwayDeployment.md).
- `src/server/Worker.ts` owns queue execution and due schedules. `src/jobs/RadarTasks.ts` optionally invokes the same work from Trigger.dev.
- `src/web` owns all browser state, rendering and ElevenLabs React controls.

## Environment and process ownership

Doppler owns the `june-workspace` project and its development settings. `doppler.yaml` selects `dev` for `doppler setup`; no tokens are committed. `doppler run` injects a configuration snapshot into the launched process. Restarting refreshes that snapshot.

`src/server/Env.ts` owns T3 Env/Zod validation. Its functions require caller-supplied values and do not read or mutate global process state. Separate validators cover server, database tooling, local development ports and optional hosted workflow project settings. Validation errors omit values. Missing research credentials leave the dashboard available with researchReady false. Runtime logs configuration_missing; an attempted check throws a safe configuration error before any network request and is recorded as failed. No fictional fallback exists.

`src/server/LoadEnvironment.ts` selects the input source at process entrypoints. Injected environment values win over local file fallback. When Doppler metadata is present, local files are ignored entirely, so missing hosted secrets cannot accidentally come from `.env`. Prisma, setup, API, worker and optional workflow tasks use this same source policy. Tests inject explicit objects.

`scripts/StartDevelopment.ts` validates settings, starts and waits for the local PostgreSQL container, then runs `pnpm db:generate` and `pnpm db:deploy` sequentially with the backend environment before supervising API, durable worker and Vite processes. A failed preparation step prevents application startup; shutdown during preparation cancels the current child process and skips subsequent steps. The API and worker inherit the supplied settings. `scripts/DevelopmentEnvironment.ts` restricts Vite to OS launch settings and validated local ports. Vite disables dotenv loading and custom client environment exports. Provider and database credentials stay out of the frontend process and browser bundle. On macOS/Linux, shutdown signals reach each child process group, including watchers; a service exit shuts down its siblings. The database container persists independently. When explicitly enabled with `DEV_WEBHOOK_TUNNEL`, the launcher also starts a separate webhook relay and ngrok, and stops both during shutdown.

The local worker owns development workflows. Trigger.dev remains an optional adapter with explicitly supplied project/runtime settings, and is not started by the development launcher. Doppler injection into a local CLI does not provision remote services or synchronize a hosted task environment automatically.

## Storage and consistency

One local workspace is currently supported. Financial snapshots, evidence, brief versions, rehearsals, milestones, notifications, tracked investors and workflow jobs use separate relational tables linked to it. Versioned domain payloads are schema-validated JSON to keep the initial data model small. Financial amounts are decimal strings in those payloads and computed with Decimal.js; presentation may convert to numbers only for formatting and charts.

Workspace writes use an optimistic revision check inside a Prisma transaction. The transaction upserts the aggregate's records while preserving existing snapshots, evidence and brief versions. This aggregate approach is suitable for the small initial sample; large histories should use feature-specific queries and commands rather than loading every record.

Financial snapshots are immutable and keyed by CSV-content/currency hash. Imported raw columns and original row numbers are retained in PostgreSQL; no private object-storage adapter is implemented yet. Company profile currency does not relabel historic financial snapshots. A financial upload uses its own explicitly confirmed currency.

Radar evidence is deduplicated by canonical URL, retrieved-text and extracted-investor hash. Previously saved fictional records retain their labels and IDs for compatibility. The current extractor requires its quoted passage to appear in the retrieved text, then labels the record unverified. Changed retrieved text creates a new immutable evidence version; per-investor checks record newly observed URLs and changed versions of previously seen URLs. Check histories preserve quoted passages and evidence IDs. Cross-page event deduplication and contradictory claim resolution remain future work.

Briefs pin a financial snapshot ID, company profile version and evidence ID. Legacy rehearsals pin a brief ID. Standalone voice rehearsals have a null brief ID and pin a validated context snapshot instead. A completed legacy review appends a brief version while retaining the original. The topic reviewer is deterministic and explicitly does not certify financial correctness or speaking quality.

## Workflows

Manual checks receive a unique request key. Scheduled checks use the saved due timestamp as their idempotency key. The scheduler submits a durable job before advancing the next timestamp, so a crash between those writes results in deduplicated resubmission.

Workers claim jobs with a compare-and-set status/attempt/token update. A six-minute lease permits recovery after a crash. Completion/failure requires the current claim token, preventing an obsolete worker from finalizing a reclaimed job. Provider timeouts bound live runs. Research runs have no application-level daily attempt limit. Three failed attempts make a job terminal; transient failures retry with delay. New manual runs remain possible.

Database workspace revisions prevent lost updates; a stale company profile during research causes retry with current inputs. Input changes can mark an existing brief stale until a rebuild. Notifications are persisted in-app with their originating evidence; founder email delivery uses the optional Resend outbox described below.

Due open milestones are compared with saved financial evidence and create an in-app review notice. This does not mark the underlying business goal achieved. Schedules store timezone, frequency, next execution and last check. The local worker must remain running for schedules to execute. The optional Trigger.dev entrypoint is a deployment adapter, not an automatically provisioned hosted service.

## Investor tracking loop

Pasted URLs are identity hints for public-source search. Canonicalization accepts HTTPS public domain shapes, rejects credentials/local domains and restricts LinkedIn/X links to profiles. The service does not fetch these URLs directly or access authenticated social sessions. Live extraction requires an exact source quote and a model-declared connection to the target; this is an initial filter, not proof of identity. Every result remains unverified. Company financial rows and goals are not included in search or extraction requests.

Tracked investors are company-scoped Prisma records with schema-validated payloads. Each holds origin (user-added or discovered), a canonical identity key, optional originating evidence, frequency, next due time and check history. Name-based discovery avoids exact-name duplicates but does not resolve aliases or disambiguate same-name investors automatically. The watchlist remains separate from the legacy profile's textual watchlist.

`discover-investors` queues candidate discovery from public company criteria. Discovery creates up to three suggestions in the workspace discovery JSON, without creating tracked investors. Only an explicit Track decision creates a daily monitored investor; Dismiss retains the normalized name for suppression. The worker schedules `investor:<id>` jobs, prioritizing user-added targets among due investors. Every check is bounded to one search and at most five extraction requests. A partial PostgreSQL unique index prevents concurrent active checks for the same investor; requests reuse the active job. This is independent of the existing radar schedule and does not require voice or onboarding changes.

Schedules enqueue before advancing the due timestamp, with the due time as the idempotency key. Daily/weekly frequencies mean 24-hour/7-day intervals. Pausing stops future scheduling, while already queued or manual work can finish. Checks compare their starting investor identity before saving and pin the company profile version; stale-profile results retry rather than being saved. Job IDs prevent duplicate history and notices after a committed check is replayed. Provider failures leave the last successful check unchanged and use the existing delayed retry/terminal failure rules. Empty results are recorded explicitly and do not claim that no real-world changes exist. The state endpoint includes the latest job for each investor even beyond its general recent-job window.

Investor source intake does not automatically build a new meeting brief or mutate a voice session. Explicit scenario generation consumes a frozen selection of that evidence. Evidence IDs and profile versions provide the handoff for that separate feature. This keeps parallel voice and onboarding work independent.

## Voice and continuity

```text
Future data adapters (not connected)
  CSV facts / meeting notes / investor research / scenario
                         |
                  PracticeContextProvider
                         |
Today: Noop provider ---> Zod PracticeContext v1 (empty)
                         |
POST /api/voice/sessions -+--> private ElevenLabs token + conversation ID
                         +--> save frozen context in rehearsal JSON
                         |
Browser VoicePractice <--+--- token + context dynamic variables
         |
         +-- microphone / WebRTC --> ElevenLabs --> spoken reply
         |                               |
         +-- live captions (preview)     +-- signed post-call webhook
         |                                              |
         +-- end --> awaiting transcript                v
                                        verify signature + agent + conversation
                                                       |
                                         save turns + transcriptReceivedAt
                                                       |
                                         session history / reopen transcript
```

`POST /api/voice/sessions` accepts an empty object for open conversation or an optional server-resolved scenario selection, never browser-provided facts or prompts. `createApi` injects the context provider and token issuer; the default context provider supplies no company data, CSV facts, notes, investor information, scenario or previous-session summary. The context schema distinguishes empty and provided modes; its future provided shape retains decimal strings, financial source rows, snapshot IDs, note IDs and investor source URLs. The voice path does not run research or financial calculations. Context is validated and saved with each session, so later data changes cannot silently alter its record.

The API obtains a WebRTC token and conversation ID before creating the session. A transactional application check prevents concurrent active voice records. The token goes only to the requesting browser; it is not persisted. `VoicePracticePage.tsx` exposes `/voice` independently of the onboarding gate and uses the same authenticated state API. `VoicePractice.tsx` has its own conversation provider to isolate SDK callbacks from the legacy practice component. It requests microphone permission on Start, offers mute/end, bounds connection startup and duration, stops audio when unmounted, and exposes saved session history. Existing written practice remains independent in the expandable legacy section.

Final transcripts are accepted only through signature-verified webhooks matching the configured agent and a recorded provider conversation. Browser end requests cannot supply authoritative turns. A transcript receipt makes both completed and partial delivery idempotent, including late browser-end requests. Empty and failed conversations are retained as partial records. A missing callback leaves the session awaiting provider evidence; the UI shows temporary live captions separately from the saved transcript and polls the existing state endpoint. After a browser refresh, users can reopen saved turns or close an abandoned active record. This does not remotely terminate audio still running in another tab.

Standalone voice does not run the existing financial topic checker or append a reviewed brief. Automatic evaluation consumes the saved transcript and separately frozen workspace evidence, as described below. Selected scenarios supply their frozen generation context to both the interviewer and evaluator. Legacy brief-based rehearsals keep their existing behavior. Older rehearsal JSON loads with null context and receipt fields; no historical facts or receipt timestamps are invented and no database migration is needed for these additions.

No raw audio is saved by this application. ElevenLabs-side retention must be configured in the provider account. The main voice entrypoint requires API key, agent ID and webhook secret, but cannot prove callback reachability from their presence. Browser controls enforce a ten-minute limit while mounted; configure provider limits separately. Provider configuration and local startup instructions are in README.md.

## Live video interviewer

The browser TypeScript project (`src/web/tsconfig.json`) uses Vite's bundler resolution, including the LiveAvatar SDK's extensionless type exports. Server, worker and scripts retain NodeNext resolution. Both projects inherit the same strict checks, and `pnpm typecheck` checks both.

```text
PracticeContextProvider / saved scenario
        |
POST /api/avatar/sessions
        +--> reserve liveavatar rehearsal + frozen practice context
        +--> LiveAvatar FULL token (avatar + voice + context IDs)
        +--> pin provider session ID; return temporary token
                          |
Browser LiveAvatar SDK <--+
        | microphone               | streamed video + audio
        +--------------------------+-- LiveAvatar built-in agent
                                              |
Finish / disconnect --> server stop ----------+
        |
Server GET stored session's transcript --> validate --> save turns
        |
History / bounded retry / reopen transcript
```

`AvatarProvider.ts` owns token creation, stop and transcript retrieval ports. `LiveAvatar.ts` implements FULL mode with validated responses and request timeouts. `AvatarRoutes.ts` owns authenticated create, stop and transcript-retry endpoints. API keys, avatar, voice and context IDs come from server T3 Env; browsers cannot override them. The provider context is configured once during setup. Open conversations use the configured context; selected scenarios supply their saved context through `dynamic_variables.brief_context`.

New video sessions use the `liveavatar` rehearsal mode. It shares the active-session exclusion with ElevenLabs voice, freezes its context and stores a provider session ID. Token creation failures leave a partial record. Browser end requests cannot supply authoritative turns. After stopping, the server fetches the transcript for its own stored session ID, validates speaker roles and text, and accepts it only when the provider reports the session inactive. Null, empty and still-active responses remain pending. A saved receipt makes repeated retrieval idempotent. Provider failures do not turn a successful stop into a failed stop. Automatic evaluation adds a separate coaching report; these sessions do not append a reviewed brief.

`AvatarPractice.tsx` renders live provider video/audio with an AI simulation label, playback controls, speaking/listening state, mute/end controls and temporary captions. Startup is bounded to 45 seconds; provider and browser duration caps are two minutes. Switching modes requests shutdown. Selected ended sessions retry transcript retrieval five times with a delay and offer manual retry afterward. Unselected sessions do not poll the provider. Browser crashes retain a record that can be stopped from history. No webhook or ElevenLabs credentials are needed for FULL mode.

Legacy connector sessions remain identifiable by their ElevenLabs mode and stored correlation hash. Their signed webhook can still bind a conversation ID using the original nonce verification; it cannot bind a FULL-mode session. The existing JSON storage accepts the additional mode without a database migration. Voice-only behavior remains independent. No automatic avatar creation, likeness scraping, investor voice cloning or financial scoring is implemented.

## Local webhook ingress

`src/server/WebhookRelay.ts` exposes only JSON POSTs at the exact ElevenLabs callback path. It forwards raw bytes and the signature to a fixed localhost API URL, with a bounded body size and timeout. Other methods and paths, including the local session and state APIs, return 404. Public responses contain status only; provider payloads and upstream errors are not logged or echoed. HMAC validation and known-conversation checks remain owned by the API.

`StartWebhookRelay.ts` reads only the launcher's injected tunnel settings. The relay and ngrok receive OS launch settings and local ports, not provider or database credentials. Only ngrok receives an optional `NGROK_AUTHTOKEN`; otherwise it uses its existing local authentication. Request inspection is disabled. The tunnel URL can be pinned via `DEV_WEBHOOK_URL`, and failure to bind it stops the development services. This is local development ingress, not a production deployment.

## Current boundaries

The application has a local session cookie, CSRF/origin checks, body limits and rate limiting. It is intentionally single-user and binds only to localhost. Hosted identity/membership authorization, remote deployment, full cash-flow modeling, June accounting integration and investor outreach are not implemented. Founder email alerts are implemented as described below.

Local session cookies are invalidated when the API restarts. The authorization hook returns `LOCAL_SESSION_REQUIRED` before executing a protected operation. `ApiClient.ts` renews that local session and replays the same request once, sharing pending renewal across concurrent requests. This preserves mounted form drafts without a reload. Other authorization errors, network failures and server failures are not replayed, since an uncertain write outcome must not cause duplicate operations. Origin checks still apply to session creation and every retried request. Dashboard and standalone voice state polling pauses in hidden tabs so idle tabs do not exhaust the local rate limit; it resumes on the next visible polling tick. State reads have a separate rate-limit group at the same request limit, so polling does not consume the write/stop budget.

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

## Founder onboarding and dashboard

`src/contracts/Onboarding.ts` owns the persisted setup steps (the UI completes in two steps) and current meeting context. `ProfileLinks.ts` owns canonical HTTPS identity URLs, rejecting credentials, local/IP hosts and social post/search URLs. LinkedIn and X fields require their respective profile hosts; the firm URL can identify a public team page. These are search hints, not fetched directly or treated as verified evidence.

The additive onboarding migration adds a JSON column to Workspace. Existing rows load as incomplete setup without deleting or reinterpreting financials, investors, briefs or rehearsals. Each Continue action saves a completed step; unfinished text edits stay in the form. The sample route reuses the original fixture by content hash. Financial selection explicitly identifies an existing snapshot. Uploads retain all previous snapshots. Company stage, sector, geography and raise amount can be unknown, and matching returns unknown for those criteria.

Completion atomically saves meeting notes and identity links, upserts one tracked investor, and creates a sourced financial brief. Newly added onboarding investors start paused. Existing tracked investors retain their monitoring setting. Research checks receive the investor name and all saved canonical links; company financials and private meeting notes are excluded from research queries. Editing the same investor preserves its ID and check history. A brief pins the meeting revision, notes and profile links along with its financial snapshot. Older briefs load with null meeting context. Named meetings only attach evidence from that investor’s checks or discovery record, preventing unrelated radar evidence from entering the meeting brief.

`OnboardingPage.tsx` is the first-visit gate at `/`; it supports uploads, sample selection, unknown company details, an optional investor, validation errors, resume and editing. `DashboardPage.tsx` owns the returning overview, meeting context and profile links. Its numbers, activity and practice status come from saved state. The existing financial, investor research, brief, practice and follow-up screens remain reachable from the left sidebar, with page content on the right. Small screens use a horizontally scrollable navigation row. `WorkspaceLayout.tsx` supplies the shared responsive navigation for the dashboard, `/scenarios`, `/practice` and legacy `/voice`. `Main.tsx` always mounts `App`; `WorkspaceNavigation.ts` resolves URLs and browser history without discarding saved scenario parameters. Practice remains accessible before onboarding; the brief-based practice section carries the selected financial brief and meeting notes. No new paid research or voice session starts merely by completing onboarding.

`POST /api/onboarding/restart` reopens setup by setting its step to 1 and clearing its completion timestamp in the normal revision-checked transaction. It retains the selected snapshot, company profile, meeting notes, investor links and all history. Dashboard and setup-header controls invoke this same endpoint. Repeated restarts are safe and the pending setup persists after reload.

## Radar delivery implementation

`RadarDelivery.ts` owns typed classifications, immutable event content, preferences, delivery states, and public projections. `Research.ts` requests optional news classification and an exact supporting quote in the existing extraction call, then attaches its run ID. Missing classification remains source-only in the UI; the consumer never runs a second model.

`RadarResults.ts` publishes supported news inside the existing revision-checked investor check/discovery transaction. The workspace aggregate includes private radar state persisted as `RadarEvent` and `NotificationDelivery` tables plus workspace notification settings. Prisma uniqueness constraints and the existing revision compare-and-set prevent concurrent duplicate writes. We collapse the spec's publication-consumer stage into this single transaction: the event and outbox are already the durable publication, so no crash gap or second enqueue is needed. A failure to commit produces neither event nor email, even if the research archive succeeded.

`RadarDeliveryService.ts` owns confirmation, preferences, eligibility, plain-text message snapshots, leases, retry windows, history backfill, and feed projections. A fresh lease is persisted before the provider call; stale workers cannot finalize it. The email worker runs independently of the potentially slow research loop. `EmailNotifications.ts` calls Resend with a stable key and frozen message; no SMTP or other provider dependency is introduced. Only authenticated application actions request confirmation or enable alerts. A challenge is hashed, expires after 15 minutes, and allows five attempts. Original challenge text stays only in its private outbox snapshot and is excluded from browser state and logs.

The current single-workspace aggregate is reused for event/outbox transactions; reads and writes load its history, as other workspace features do. API feed responses are cursor-paginated, but database-level streaming and per-feature query optimization remain scalability work. A small worker heartbeat has its own table and does not rewrite the aggregate. Provider reconciliation within the 23-hour safety window replays the exact idempotent request; after expiration, an unknown outcome requires operator review in Resend and cannot be retried from the UI.

`RadarRoutes.ts` shares session/origin checks, validates input, and uses the existing polling budget. Preferences expose a masked address and safe delivery status. The public workspace omits private radar settings and outbox payloads entirely. `RadarUpdates.tsx` owns Investor Radar's feed, archive inspection, recipient confirmation, notification controls, and deep links. The earlier global radar controls remain in an expandable legacy section; per-investor scheduling remains under Investor research. Legacy global scans without a stable investor/suggestion association do not automatically produce targeted email. Standalone voice/video behavior remains unchanged.

## Post-practice evaluator

Completed reviews begin with a compact Pitch Preparation Report: strengths, financial blind
spots and recommended preparation. `PitchPreparationReport.tsx` renders the saved output;
the detailed evidence and practice review sits in a disclosure below it. The
`claims-coaching-v4-analyst-report` prompt assesses up to three strengths in the existing
coaching call, with claim and founder-turn references. Validation rejects unknown,
contradicted or superseded claim citations, mismatched turns and numerical praise.
Citation validation does not certify the semantic accuracy of model judgments. Blind spots
and preparation reuse the validated coaching gaps, suggestions and missing inputs. No extra
provider call or migration is needed. Earlier reports retain their original data and explicitly
say strengths were not assessed; empty new results do not imply financial correctness.
New coaching responses require an analyst interpretation, a conditional diligence implication
and concrete preparation steps per finding, plus significance for each demonstrated strength.
These fields render directly in the compact report and share the existing numerical provenance
checks. Older reports without analysis remain readable without synthetic backfill. The prompt
sets a professional analytical standard without claiming a CFA credential, certification or audit
opinion; credit recurrence and cash timing remain unknown unless the frozen evidence establishes them.

`RehearsalEvaluation.ts` defines versioned evidence, claim, coaching and report contracts. `EvaluationContextAssembler.ts` freezes a bounded recent-year metric catalog and attributed company/meeting/investor sources. For a selected scenario it uses the company, investor and current financial snapshot saved in that scenario, even if workspace data has since changed; open conversations use the current selected workspace evidence. `EvaluationProvider.ts` owns the two prompts and provider port; `Evaluation.ts` supplies the live structured-output adapter. `EvaluationChecks.ts` checks quotations, references, numerical provenance and exact decimal comparisons.

`RehearsalEvaluationService.ts` queues reviews when authoritative transcripts are saved, orchestrates extraction/checking/coaching, and preserves clarifications and written retries as new records. These records live in existing rehearsal JSON; old records receive empty defaults without a migration. `PrismaStore.save` atomically saves transcripts and queue jobs, and its optional completion claim fences result publication against the current unexpired lease. A queued record plus its latest job determines pending/failure status; no transcript is erased on evaluation failure.

`EvaluationRoutes.ts` exposes local authenticated review, retry and response endpoints. `EvaluationPanel.tsx` is shared by voice and video history and polls only selected pending reviews while visible. The general state endpoint omits evaluation contexts/reports; selected-session reads retrieve them separately. Storage and history reads still follow the small single-workspace aggregate model; larger histories should move to dedicated tables and paginated queries.

`contracts/Followups.ts` validates the private, no-store `GET /api/followups` projection.
`features/Followups.ts` derives up to three next steps from persisted coaching for each
root practice, with frozen claim quotations, facts, cited sources and success criteria.
Written retry sessions are excluded from the top-level history. Existing evaluation
responses preserve dismissals and link retries/clarifications to progress; only a saved
comparison can report improvement. Reads perform no inference and mutate no history.
The paginated endpoint is covered by the normal local session/origin controls and loads
the same small workspace aggregate. `web/Followups.tsx` polls while visible and reuses
the existing response commands and lazily opened evaluation panels.

New investor preparation is a separate section derived from saved classified radar events.
It matches the frozen investor ID and compares observation time against scenario capture
time, falling back to evaluation-context capture for open practice. Sources already in
the review, stale-profile events, historical backfill, dismissed events and superseded
versions are excluded. Bounded results disclose omitted counts; missing publication
dates remain unknown. Category-specific preparation templates cite the original signal
and source, preserve fictional/unverified labels, and link to explicit scenario generation.
They do not claim that new research was present during the call or re-evaluate old answers.
No new model, queue kind, persisted task table or migration is needed; legacy financial
milestones remain accessible separately.

`contracts/EvidenceReview.ts` owns the validated evidence projection; `features/EvidenceReview.ts`
resolves exact transcript spans, validated frozen financial rows, original CSV locators,
fact-to-cell links and Decimal.js comparisons. The session-scoped read route
`GET /api/rehearsals/:id/evaluations/:evaluationId/evidence` returns private, non-cacheable
data without inference or storage mutations. New financial sources include optional structured
CSV location metadata; absent metadata in older contexts remains absent to preserve their
original hashes. Legacy row citations remain readable without inferring a filename from a title.

`web/EvidenceReview.tsx`, `FinancialEvidenceGrid.tsx` and `TranscriptEvidence.tsx` render
the embedded sheet, synchronized inspector, accessible quote previews and whole-turn fallbacks.
The shared evaluation panel keys state by session, supports earlier review selection, and
keeps drafts keyed by review/item. Completed evidence views use a bounded component-local
memory cache; late responses are ignored after selection changes. The sheet is an Excel-style
view of saved CSV evidence, with clearly identified review coordinates; native Excel ingestion
is not implemented. No migration or new provider is required.

`AvatarTranscript.ts` shares authoritative intake between browser/manual fetches and the worker. Ended video sessions enqueue an idempotent transcript job with bounded retries. Abandoned active sessions still require explicit stopping.

Every new session freezes evaluation context, and its final transcript automatically queues a model review. There is no mode toggle or demo execution path. Missing OpenAI credentials fail the review job without losing the transcript. Provider-delivered context, the legacy topic checker and brief mutation rules remain separate. See [Evaluator workflow](EvaluatorWorkflowPlan.md) for ASCII flow, prompt contracts, limitations and extension points.

## Scenario generation and investor preparation

`QuestionWhy.ts` defines public, source-linked teaching explanations. New scenario generation
requires opening and branch explanations in the same structured model output; the persisted
scenario reader accepts older records without inventing those fields. The prompt version is
`scenario-v3-question-why`. `QuestionExplanation.tsx` shows a hover/focus tooltip and a modal
source inspector without inference. The practice room offers live video and voice-only formats and collapses full scenario
details beneath the conversation. `web/LiveGuidance.tsx` is shared by both transports and
shows the latest spoken interviewer turn, answer objective and source-linked Why inspector.
It coalesces caption bursts and retains completed guidance for earlier turns, including
in-flight results that finish after the call ends. Opening the inspector pauses the microphone
and interviewer output; closing it restores the prior microphone state. ElevenLabs receives
repeated user-activity signals while reading; LiveAvatar receives interrupt/stop-listening
commands and resumes listening on close. Provider session duration limits still apply.
`POST /api/rehearsals/:id/live-guidance` uses the existing local-session/origin protection,
a separate bounded rate limit, validated recent captions and server-resolved frozen evaluation
context. `features/LiveGuidance.ts` validates citations and renders numbers only from cited
fact placeholders, with a bounded ten-minute in-memory cache and concurrent-request limit.
`infrastructure/LiveGuidance.ts` makes one structured call using the existing scenario model.
Validated explanations are saved in optional rehearsal JSON through the revision-checked
workspace transaction, keyed by caption payload and turn index. The private no-store
`GET /api/rehearsals/:id/live-guidance` route returns saved explanations plus the session's
frozen context without inference, even when the model is unconfigured. General state polling
omits guidance. Existing sessions require no migration or fabricated backfill.
No guidance call writes browser captions into the authoritative transcript, mutates financial evidence
or supplies a transcript receipt. Failures are isolated from media controls. Guidance is an
inferred preparation aid, not access to the provider's private reasoning. Historical guided
text APIs and saved records remain supported without a separate format tab.

`features/QuestionEvidence.ts` projects scenario financial periods and schema-validated
evaluation source rows into browser-safe evidence rows. Original filenames are used only
when saved locators provide them; malformed legacy rows retain their citation without a
fabricated worksheet. `QuestionEvidenceSheet.tsx` displays exact decimal strings across
periods, source-period selection, cited cells and original CSV locators. The explanation
and worksheet occupy adjacent panes on desktop; mobile uses explicit view switches.
The inspector never modifies snapshots, performs financial arithmetic or calls a provider.

`GuidedPractice.ts` defines a versioned optional rehearsal payload. `PracticeTurnService.ts`
freezes the selected scenario's evaluation evidence, records explicitly submitted answers,
and queues `guided-turn:<session>:<answer>` work through the existing Prisma save transaction.
The durable worker reuses claim extraction and exact decimal checks, then `PracticeTurn.ts`
requests one structured reply/question/Why bundle. `PreparationPolicy.ts` validates current
claim references, selected investor sources, fact citations and pivot requirements. Numerical
prose uses fact placeholders resolved from saved values, units and periods; the model does
not calculate new figures. Reference integrity does not certify semantic correctness.

Bundle publication and job completion share the existing workspace revision and lease fence.
Session revisions, payload-checked request keys and stable question IDs protect answer
replays. Retrying increments a pending operation's generation.
`PracticeInputBudget.ts` checks answer acceptance against the same serialized input
limit while reserving worst-case JSON space for the next reply/question. The UI uses the
same budget check; oversize answers leave no pending record or queued job.
Finish clears pending work, retains the server-accepted text transcript and queues the existing evaluation; no provider
receipt is fabricated. The current local aggregate stores guided state inside rehearsal JSON
instead of the separate tables proposed in the draft spec. No migration or default backfill
is needed; larger histories should move to focused tables. Guided details are excluded from
the polling state projection and read through scoped, private no-store routes. Historical
voice/video transcripts retain their existing authority and behavior.

`ScenarioService` assembles initial company information, selected-investor research, bounded CSV history and linked completed practices through `ScenarioSourceProvider` adapters. `Scenario.ts` owns strict Zod inputs, source provenance, coverage, investor-profile hypotheses and scenario branches. Pitch documents and forecasts are explicitly not connected; unrelated or incomplete practice sessions are excluded. `ScenarioPrompt.ts` owns the versioned instructions; new data kinds require a typed adapter and explicit prompt rules.

`ScenarioGeneration` is a separate workspace-scoped Prisma table. `PrismaStore` atomically creates its input snapshot and a workflow job with kind `scenario`. Request keys are scoped to workspace and operation; changed parameters cannot reuse a key. The worker passes frozen inputs to an injected demo or live generator, validates references, and atomically commits output and job success under the current, unexpired lease. The job owns status. Concurrent or recovered workers cannot overwrite a completed result. A provider retry can incur another provider charge even though local output commits once.

The generation API provides bounded history and source-change detection. Current company fields and matching meeting notes are copied into each input because their original records are mutable. Research IDs and selected excerpts, dates, labels, omitted IDs and input hashes are retained. New source data marks an old view outdated but never rewrites it. Structural and source-reference checks do not certify the semantic truth of generated claims.

`ScenarioPractice.tsx` renders full scenarios and the research-based investor profile together in the Practice scenario library within the shared workspace layout. Source inspection, missing-data coverage, demo labels, generation history and failure states remain visible. Both voice and avatar creation accept an optional saved generation/scenario selection. `PracticeContext` v2 freezes the entire selected scenario, investor profile and source snapshot into the rehearsal. Version 1 sessions and empty-object starts retain their existing behavior. Tokens and provider webhook verification are unchanged. Provider-side prompt configuration must honor the selected scenario; no remote configuration is edited automatically.

The Practice scenario library (`/scenarios`, also in the workspace navigation) lists each
saved scenario as a table row. Selecting a row opens an accessible modal drawer with the
full scenario, inferred investor profile, coverage and frozen source snapshot. Start
Practicing navigates to `/practice?generationId=…&scenarioId=…`. The room reloads and
validates that saved selection before enabling a session; invalid or unavailable selections
never fall back to an open conversation. `/practice` and the legacy `/voice` URL support
open conversations. Navigation itself does not create a provider session. Both voice
transports send the saved IDs to the server, which resolves the immutable practice context.

Scenario generation now has a read-only `POST /api/scenario-generations/preview` step.
It uses the same server-side assembly as creation, returning input plus a review hash.
The UI submits that hash with its idempotency key; changed sources or prior-scenario
summaries cause a conflict instead of silently sending different data. Replays of an
already-created key return its saved generation even after workspace changes.
Source freshness excludes prior generated scenarios to avoid immediately marking a
new generation outdated. The prompt version is scenario-v2. Sources include bounded
financial history and investor-linked completed practice; source snapshots remain immutable.
CSV amounts are copied as exact decimal strings and no LLM financial arithmetic is requested.

## Peer comparison snapshots

`contracts/PeerComparison.ts` validates founder-entered monthly peer statements, source
metadata, comparison projections and saved report insights. `features/PeerComparison.ts`
selects the latest active evidence version per peer and calculates revenue growth, gross
margin and operating margin with an 80-digit Decimal context, rounding only derived
percentages to eight decimal places. Each metric retains the company snapshot/CSV rows,
selected peer evidence versions, exact source values and exclusion reasons. Group membership
is an explicit founder judgment; entered public sources are not fetched or verified.

The additive `Workspace.peers` JSON column stores append-only evidence revisions within the
existing revision-checked Prisma transaction. `server/PeerRoutes.ts` uses existing API access
hooks, expected peer versions and a 20-active-peer bound; archives append evidence rather than
erase history. The private no-store dashboard endpoint returns active peers and a comparison
for the selected financial statement. `web/PeerDashboard.tsx` owns the evidence form and group
management; `PeerCharts.tsx` shares accessible SVG and source disclosures with the report.

New evaluation contexts optionally capture a peer comparison. Scenario inputs freeze it at
creation; evaluation contexts for older scenarios do not attach current evidence. Optional
fields have no defaults, preserving old context hashes. Scenario freshness ignores the peer
comparison's capture time but includes its content. `withoutPeerComparison` excludes peer
snapshots from model evaluation/guidance and written-practice budgets; `scenarioDataPrompt`
also excludes them. The ordinary extraction/coaching prompts remain unchanged.

After validated extraction, `PeerInsights.ts` links at most three locally calculated insights
to actual, non-superseded founder claims matching the metric topic and latest reporting month.
It preserves claim/turn references, the captured comparison and preparation template in the
saved report under the existing worker lease transaction. Missing or unrelated comparisons
produce an empty list; historical reports remain absent rather than backfilled. Numerical
context does not establish claim support, causation, investor preference or pitch quality.

## Parent evaluation and child workflows

`EvaluationOrchestrator.ts` runs three focused workflows inside the existing durable
`evaluate:<session>:<evaluation>` job. `PeerEvaluationWorkflow.ts` projects all frozen peer
metrics independently of transcript coverage. `InvestorEvaluationWorkflow.ts` compares
company stage, sector and geography with source-linked observations captured by
`EvaluationContextAssembler.ts`. `AnswerEvaluationWorkflow.ts` retains existing numerical
checks and validated model coaching after the parent's single validated extraction step.
`EvaluationSynthesis.ts` joins existing coaching actions to matching claim-linked peer
metrics and selected investor observations; it performs no additional inference.

`CombinedEvaluation.ts` validates business results and synthesis. Optional context, progress
and report fields preserve old records and hashes. `withoutPeerComparison` also removes the
new structured investor assessment from model inputs; existing attributed investor sources
continue to inform coaching. Peer arithmetic and investor label matching remain local.
The investor result is deliberately limited: extracted historical research attributes are not
confirmed fund criteria, semantic stage/geography matching, check-size assessment or
qualitative thesis analysis. Manual peer selection and its existing definitions remain in use.

The parent saves extraction, business children and answer output as checkpoints in rehearsal
JSON. `WorkspaceStore.save` accepts a separate optional checkpoint lease guard; Prisma locks
the workspace then the current unexpired job in the same transaction without completing it.
Final publication uses the existing completion lease fence and removes transient progress.
Generation and input-integrity checks prevent superseded work from publishing. Retries reuse
validated completed children; provider failure does not turn into an empty successful report.
Report construction is deterministic and requires no separate model call or migration.

`EvaluationWorkflows.tsx` renders saved business results, source disclosures, missing data
and connected preparation actions inside `PitchPreparationReport.tsx`. Older reports keep
their original claim-linked peer layout. Existing coaching items still drive follow-ups and
written retries; business-only gaps are displayed as preparation guidance without claiming
that an unasked question was answered poorly. No research runs merely by viewing a report.

## Meeting brief table and review drawer

`web/MeetingBriefs.tsx` replaces the expanded brief page with searchable brief/practice tables
and a native modal dialog styled as a right-side drawer. Table rows use semantic buttons;
close/Escape and the browser's modal focus handling retain keyboard navigation. Brief details
preserve their snapshot, source, notes and existing commands. Explicit brief IDs associate
practice records; reviewed predecessor links are followed only while investor, financial
snapshot and profile version match. Ordinary refreshed briefs and open practices are not
silently grouped. The practice table exposes all conversations without guessing associations.

The selected practice mounts `EvaluationPanel` with its public saved turns as fallback.
Existing private evaluation reads load full reports, versions and evidence only on demand.
`PracticeReviewTranscript.tsx` projects cited strengths and preparation gaps onto validated
founder-turn references, highlights uniquely located quotes, and scrolls/focuses the full
turn when feedback is selected. Superseded claims are excluded; repeated quotations fall
back to whole-turn selection. Transcript text is rendered as React text. Old/unreviewed
sessions show their transcript without fabricated feedback. Source-linked financial evidence,
written retries, clarification and evaluation history remain in the shared panel. The table itself introduces no model call or schema migration; optional provider playback is described below.

## On-demand recording playback

`RecordingRoutes.ts` exposes private authenticated/rate-limited playback metadata and audio
reads scoped to a stored rehearsal. Only completed provider-receipted ElevenLabs sessions with
a stored conversation ID and configured backend key qualify. `ElevenLabsRecording.ts` uses
fixed provider endpoints with redirects disabled and bounded timeouts. Audio MIME types are
allowlisted and declared/streamed sizes are bounded to 20 MiB. Provider failures expose safe
messages. No browser-provided provider ID, URL or credentials are accepted.

`RecordingPlayback.ts` validates optional playback metadata independently of saved transcripts
and evaluation hashes. `describe` supplies timings only after matching the full provider
speaker/text sequence to the saved receipt. Nonmonotonic or out-of-duration timestamps remove
alignment rather than attaching a wrong passage. Written/unsupported sessions return an
explicit unavailable result. Audio is read on demand, never archived or backfilled.

`web/RecordingPlayback.tsx` requests data only after Load recording, decodes bounded audio
into waveform peaks, and creates a transient object URL for native playback. Cleanup aborts
in-flight work, closes decoding contexts and revokes the URL. The waveform, seek slider and
assessment markers navigate a shared audio element. `PracticeReviewTranscript.tsx` displays
assertion details and synchronizes selected findings with matched timestamps; missing timing
retains exact turn/quote navigation. Transcript text stays below the waveform. Fictional preview
audio uses explicitly labeled synthesized tones and is isolated under test fixtures.

## Preparation progress on the dashboard

`contracts/PreparationProgress.ts` validates the private, no-store
`GET /api/preparation-progress` projection. `features/PreparationProgress.ts` reads the
full saved root-practice history and existing follow-up comparisons. It groups claim
checks by their saved metric into six preparation areas; unclassified metrics remain
under Evidence & explanation. Superseded claims are excluded from claim counts.
Root practices are counted once; linked written retries contribute follow-up progress,
not additional independent practice counts. Missing, pending and failed reviews remain
separate. Dismissal preserves the retry history but does not count as improvement.

The dashboard shows checked claims, submitted retries and saved improvement outcomes,
not a skill/mastery score or a comparable cross-session rating. Up to three follow-ups
per area prioritize unresolved work; strengths preserve saved quotations and fictional
and partial-session labels. Five recent root sessions provide history, while counts
cover all stored root practices. No inference, provider calls, new storage or backfill
occurs on reads. This uses the current small workspace aggregate and should move to
focused queries if history grows substantially.

Current statement metrics reuse the evaluation evidence assembler and its exact decimal
arithmetic. They are explicitly separated from historical reviews' frozen evidence.
Cash runway and forecasts remain unavailable without their required documents. Source
filename, CSV row, period and fictional labels stay visible. The founder selects a topic,
inspects saved feedback/evidence, and can open the exact follow-up (including older
history pages) or carry an editable objective into the existing scenario source review.
Generating a scenario remains an explicit action after that review; opening the dashboard
or a drill link never triggers research, scenario generation or a paid practice session.

The preparation detail panel uses keyboard-accessible Feedback, Financial data and Next
drill tabs. Status, practice, source/date, partial-session and fictional-evidence tags
keep summaries compact; methodology and source explanations remain in disclosures.
Tabs change presentation only and retain the existing evidence and generation controls.

## Continuous fundraising preparation

`contracts/FundraisingPreparation.ts` owns strict goal, plan, artifact, decision and public
projection schemas. `PreparationPlanner.ts` creates deterministic financial explanations
and investor briefs from selected statement rows, founder-confirmed context and only the
selected investor's saved research. Public-source observations do not establish mandate or
eligibility; missing inputs stay unknown. Exact source amounts are retained, with numeric
conversion only for chart geometry. Prepared financial periods stay within the evaluator's
latest-twelve-period evidence window.

`PreparationPlanService.ts` confirms goals, records append-only review decisions and creates
completed written rehearsals with frozen evaluation evidence. Submission and evaluation
queue intent commit in the existing revision-checked Prisma workspace transaction. The new
session has no invented provider receipt; its server-accepted text is its transcript.
Unrelated meeting context is excluded. Existing evaluator jobs, lease fences, failure/retry
controls and follow-up comparisons handle subsequent assessment. A limited numerical
coverage gate can mark a financial rehearsal assessed; it is not a mastery score or proof
of a qualitative understanding of cash. Unresolved coaching remains visible separately.

The existing worker calls preparation reconciliation on each tick. It compares a content
hash of relevant saved inputs, excludes ordinary notices/scheduling bookkeeping, and appends
a plan only when inputs change and automatic drafting is enabled. No model, research or paid
session is started by reconciliation. Explicit manual refresh works while paused. Source
freshness is also checked inside decision and rehearsal transactions. Existing decisions
remain attached to exact artifact content; material changes require a new review. Completed
practice reviews update the next plan; read projections never write or run inference.

For this first small single-workspace release, an additive `Workspace.preparation` JSONB
column holds schema-validated goal/plan/decision history and rehearsal links inside the
existing optimistic transaction. This intentionally reuses aggregate consistency rather
than adding the focused tables proposed in the engineering spec. History is append-only;
large histories should migrate to dedicated, paginated storage. `/api/state` excludes this
payload. `PreparationRoutes.ts` provides a private/no-store projection and protected commands;
written assessments have a separate bounded submission rate. Repeated request keys cannot
create duplicate decisions or rehearsals or be reused with changed content.

`web/PreparationPlan.tsx` puts the compact preparation schedule and next action above dashboard details.
It supports confirmed goals, explicit review decisions, unverified founder notes, a native
review dialog, source passages, accessible charts with exact-value tables and written
rehearsal. Current/past assessments and outstanding saved feedback return to the same plan.
The existing heartbeat reports whether the worker is online. Goal changes, new statement
selection and selected-investor research invalidate stale plans without altering original
snapshots. Investor comparison, freeform artifact rewriting and
artifact-linked voice/video scenarios remain later increments; existing scenario navigation
is available separately and does not claim to complete this plan's rehearsal milestone.

### Financial statement comparison and preparation actions

`contracts/FinancialPerformance.ts` validates reporting-period queries and the comparison
projection. `features/FinancialPerformance.ts` derives a financial bridge from reconciled
rows in the selected snapshot. Exact server-side Decimal arithmetic calculates services
revenue, current-minus-comparison variances and percentages using the absolute prior value.
Percentages round to two places; zero bases remain unavailable. The previous calendar month
is the default; missing periods are disclosed without silently selecting another month.
Explicit comparisons must exist and precede the current period. The API route inherits
workspace/session/origin controls and is private/no-store; reads perform no generation.

`web/FinancialPerformanceStatement.tsx` renders aligned current/comparison bridges, amount
and percentage variances, exact-value labels and source references in an accessible HTML
table. SVG conversion to numbers is presentation geometry only. Both statement columns
share a scale; variance columns use separate centered scales, with clipping arrows and
actual labels for large percentages. Expenses use lower-is-favorable accounting direction;
credits remain distinct from operating results. Color interpretation, formulas and limitations
are explicit. Line-item buttons expose source columns; period selection is read-only.
Financial evidence keeps its fictional label and unknown currency is never inferred.

The earlier ECharts dependency graph has been removed in favor of the financial statement
visual. `PreparationJourney.tsx` retains compact keyboard-accessible preparation actions and
prerequisite routing below it, backed by existing milestones. Selecting an action still
opens the goal, investor context, prepared explanation or rehearsal; stale-plan actions route
through refresh. Neither the financial comparison nor preparation progress claims a future
funding date or a business outcome from completing tasks. The chart requires no new provider
or chart-library dependency and preserves all saved financial and rehearsal history.

### Compact dashboard schedule

`PreparationSchedule.tsx` replaces the dashboard's expanded preparation journey with a compact
current/expected position strip, accessible timeline table, scenario pace and review actions.
`PreparationScheduleModel.ts` projects founder-confirmed effort and daily capacity using Decimal
arithmetic and date-only UTC calendar arithmetic after selecting today in the goal timezone.
Work is sequential and the brief waits for assumed cash delivery; this is a planning model,
not a cash forecast or funding prediction. Overdue explicit delivery or changed source inputs
suppress future dates. Missing delivery stays an unresolved cash gap, not a prerequisite for
preparing a brief that discloses that gap. Targetless plans have no on-track assertion. Review activity counts
unique current accepted artifacts in seven days and is never extrapolated into velocity.

`POST /api/preparation-plan/schedule` validates bounded estimates with Zod, checks optimistic
version, current plan and source freshness, then appends an assumption record in the existing
Prisma-backed preparation aggregate. Reads expose the latest record without writing history.
Older records and financial snapshots remain unchanged. New plans/goals use labeled suggested estimates until customized;
temporary slower/faster controls never mutate saved assumptions. Standard workspace/session,
origin and cache controls apply. No provider calls or new worker are introduced.

### Goal-first preparation and conversation context

`PreparationIntent.ts` synchronizes an explicit company objective into a versioned preparation
goal and local draft in the same workspace transaction. Onboarding/company edits and the
version-checked `POST /api/preparation-plan/intent` share this function; no parser guesses round,
amount or financing history from free text. Existing goal detail and history are preserved.
The worker continues to reconcile saved evidence; this edit starts no provider calls.

`PreparationIntentForm.tsx` exposes a single goal input; detailed round controls stay optional.
`PreparationScheduleModel.ts` uses disclosed template effort and 0.5 hours/day when no current
custom schedule exists. This makes the timeline usable without a required assumption form.
Current custom plans remain supported. Real accepted-review activity stays separate from
suggested availability and cash/runway is not inferred.

`InvestorMeetingContext.tsx` embeds current conversation editing in Radar through protected
`PUT /api/investor-meeting`. The selected investor follows this explicit edit and the current
preparation draft is regenerated locally. Legacy Meetings URLs resolve to Radar. Existing
brief, rehearsal and recording snapshots are preserved. The onboarding UI completes the
existing persisted company/meeting transitions without forcing a separate conversation screen.

`PreparationRecommendationBasis.tsx` exposes the current recommendation's review dependency,
exact financial baseline, frozen source excerpts, timestamps and uncertainty. Its rationale
selects the actual next review/investor/rehearsal gate and discloses stale inputs. Schedule
explanations reuse `projectSchedule` and exact Decimal effort sums; template estimates never
claim to be measured or derived from financial performance. No alternative raise amount is
generated from an income statement. Existing source/decision history is unchanged.

### Exact preparation source inspection

New financial snapshots retain optional `sourceCsv` in the existing immutable JSON payload.
Original text is excluded from `/api/state` and loaded only through authenticated, private/no-store
`GET /api/preparation-plan/:planId/sources/:artifactId`. The route resolves a saved plan and
financial artifact to its frozen snapshot, returns exact parsed cells and supporting record/
column locators, and discloses missing original text for historical uploads. It never
reconstructs old files or changes historical snapshots. No database migration is needed.

`PreparationSourceEvidence.tsx` renders CSV records with supporting cells highlighted and an
optional unchanged-text view. Investor source panels distinguish publication/retrieval dates,
original quoted passages and model interpretation. Saved research context comes from the
existing protected research-run endpoint; only a literal matching substring is highlighted.
Missing speaker identity and absent context stay explicit. Planner version 2 adds optional
publication, research-run and interpretation metadata to new artifacts while retaining old plans.

### Position freshness and change manifests

`PreparationPosition.ts` projects the currently selected financial snapshot and investor check
status alongside pending change reasons. `PreparationPlanner` version 3 persists optional hashes
of goal/context, financial identity, selected-investor evidence, and relevant completed reviews
in each append-only plan. Its change labels compare manifests; schedule bookkeeping, unchanged
checks, heartbeat and display timestamps are excluded from input identity. Legacy plans disclose
that no comparable manifest exists. Reads remain pure; reconciliation writes only new inputs.

`PreparationPosition.tsx` exposes source timestamps, synchronization state, monitoring status and
manual recovery controls. Dashboard figures use the same preparation projection as freshness;
visibility-aware serialized polling preserves open drafts and announces meaningful changes.
Network failure retains prior state with explicit stale-view messaging. Provider work is never
started by rendering or polling; manual investor checks reuse existing protected routes.
