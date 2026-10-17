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
- `src/features/InvestorTrackingService.ts` owns profile-link normalization, investor discovery, per-investor schedules, check history and source-version comparisons. `src/server/InvestorRoutes.ts` exposes these commands under the existing API authorization hooks. `src/web/InvestorTrackingPage.tsx` is the independent watchlist UI.
- `src/features/Financials.ts` imports the supplied monthly CSV structure, validates every amount and reconciliation, preserves raw rows and computes exact financial findings with Decimal.js.
- `src/features/InvestorFit.ts` owns explicit criterion matching. Currency must be known and equal before comparing check and raise amounts. Unknown criteria remain unknown.
- `src/features/WorkspaceService.ts` owns profile versions, snapshots, evidence intake, brief history, rehearsal lifecycle, topic checks and follow-up comparisons.
- `src/features/WorkspaceStore.ts` owns the persistence port and concurrency error.
- `src/infrastructure/PrismaStore.ts` maps validated application records to company-scoped tables. Prisma types do not escape the adapter.
- `src/infrastructure/Research.ts` contains fictional and Exa/model-backed research adapters. The application chooses one mode explicitly at startup.
- `src/infrastructure/Voice.ts` obtains ElevenLabs conversation tokens, retains the legacy brief-context builder and verifies provider webhooks. `src/features/PracticeContextProvider.ts` owns the independent context port and its empty implementation.
- `src/server/Api.ts` owns local session authorization, origin checking, rate limits, validated routes and static production assets. It always binds through the loopback entrypoint.
- `src/server/Worker.ts` owns queue execution and due schedules. `src/jobs/RadarTasks.ts` optionally invokes the same work from Trigger.dev.
- `src/web` owns all browser state, rendering and ElevenLabs React controls.

## Environment and process ownership

Doppler owns the `june-workspace` project and its development settings. `doppler.yaml` selects `dev` for `doppler setup`; no tokens are committed. `doppler run` injects a configuration snapshot into the launched process. Restarting refreshes that snapshot.

`src/server/Env.ts` owns T3 Env/Zod validation. Its functions require caller-supplied values and do not read or mutate global process state. Separate validators cover server, database tooling, local development ports and optional hosted workflow project settings. Validation errors omit values. Incomplete live research credentials fail validation before services start.

`src/server/LoadEnvironment.ts` selects the input source at process entrypoints. Injected environment values win over local file fallback. When Doppler metadata is present, local files are ignored entirely, so missing hosted secrets cannot accidentally come from `.env`. Prisma, setup, API, worker and optional workflow tasks use this same source policy. Tests inject explicit objects.

`scripts/StartDevelopment.ts` validates settings, starts and waits for the local PostgreSQL container, then supervises API, durable worker and Vite processes. The API and worker inherit the supplied settings. `scripts/DevelopmentEnvironment.ts` restricts Vite to OS launch settings and validated local ports. Vite disables dotenv loading and custom client environment exports. Provider and database credentials stay out of the frontend process and browser bundle. On macOS/Linux, shutdown signals reach each child process group, including watchers; a service exit shuts down its siblings. The database container persists independently. When explicitly enabled with `DEV_WEBHOOK_TUNNEL`, the launcher also starts a separate webhook relay and ngrok, and stops both during shutdown.

The local worker owns development workflows. Trigger.dev remains an optional adapter with explicitly supplied project/runtime settings, and is not started by the development launcher. Doppler injection into a local CLI does not provision remote services or synchronize a hosted task environment automatically.

## Storage and consistency

One local workspace is currently supported. Financial snapshots, evidence, brief versions, rehearsals, milestones, notifications, tracked investors and workflow jobs use separate relational tables linked to it. Versioned domain payloads are schema-validated JSON to keep the initial data model small. Financial amounts are decimal strings in those payloads and computed with Decimal.js; presentation may convert to numbers only for formatting and charts.

Workspace writes use an optimistic revision check inside a Prisma transaction. The transaction upserts the aggregate's records while preserving existing snapshots, evidence and brief versions. This aggregate approach is suitable for the small initial sample; large histories should use feature-specific queries and commands rather than loading every record.

Financial snapshots are immutable and keyed by CSV-content/currency hash. Imported raw columns and original row numbers are retained in PostgreSQL; no private object-storage adapter is implemented yet. Company profile currency does not relabel historic financial snapshots. A financial upload uses its own explicitly confirmed currency.

Radar evidence is deduplicated by canonical URL, retrieved-text and extracted-investor hash in live mode and a stable fixture key in demo mode. The current extractor requires its quoted passage to appear in the retrieved text, then labels the record unverified. Changed retrieved text creates a new immutable evidence version; per-investor checks record newly observed URLs and changed versions of previously seen URLs. Check histories preserve quoted passages and evidence IDs. Cross-page event deduplication and contradictory claim resolution remain future work.

Briefs pin a financial snapshot ID, company profile version and evidence ID. Legacy rehearsals pin a brief ID. Standalone voice rehearsals have a null brief ID and pin a validated context snapshot instead. A completed legacy review appends a brief version while retaining the original. The topic reviewer is deterministic and explicitly does not certify financial correctness or speaking quality.

## Workflows

Manual checks receive a unique request key. Scheduled checks use the saved due timestamp as their idempotency key. The scheduler submits a durable job before advancing the next timestamp, so a crash between those writes results in deduplicated resubmission.

Workers claim jobs with a compare-and-set status/attempt/token update. A six-minute lease permits recovery after a crash. Completion/failure requires the current claim token, preventing an obsolete worker from finalizing a reclaimed job. Provider timeouts bound live runs. Research runs have no application-level daily attempt limit. Three failed attempts make a job terminal; transient failures retry with delay. New manual runs remain possible.

Database workspace revisions prevent lost updates; a stale company profile during research causes retry with current inputs. Input changes can mark an existing brief stale until a rebuild. Notifications are persisted in-app with their originating evidence; no email delivery exists.

Due open milestones are compared with saved financial evidence and create an in-app review notice. This does not mark the underlying business goal achieved. Schedules store timezone, frequency, next execution and last check. The local worker must remain running for schedules to execute. The optional Trigger.dev entrypoint is a deployment adapter, not an automatically provisioned hosted service.

## Investor tracking loop

Pasted URLs are identity hints for public-source search. Canonicalization accepts HTTPS public domain shapes, rejects credentials/local domains and restricts LinkedIn/X links to profiles. The service does not fetch these URLs directly or access authenticated social sessions. Live extraction requires an exact source quote and a model-declared connection to the target; this is an initial filter, not proof of identity. Every result remains unverified. Company financial rows and goals are not included in search or extraction requests.

Tracked investors are company-scoped Prisma records with schema-validated payloads. Each holds origin (user-added or discovered), a canonical identity key, optional originating evidence, frequency, next due time and check history. Name-based discovery avoids exact-name duplicates but does not resolve aliases or disambiguate same-name investors automatically. The watchlist remains separate from the legacy profile's textual watchlist.

`discover-investors` queues candidate discovery from public company criteria. Newly discovered candidates become due immediately. The worker schedules `investor:<id>` jobs, prioritizing user-added targets among due investors. Every check is bounded to one search and at most five extraction requests. A partial PostgreSQL unique index prevents concurrent active checks for the same investor; requests reuse the active job. This is independent of the existing radar schedule and does not require voice or onboarding changes.

Schedules enqueue before advancing the due timestamp, with the due time as the idempotency key. Daily/weekly frequencies mean 24-hour/7-day intervals. Pausing stops future scheduling, while already queued or manual work can finish. Checks compare their starting investor identity before saving and pin the company profile version; stale-profile results retry rather than being saved. Job IDs prevent duplicate history and notices after a committed check is replayed. Provider failures leave the last successful check unchanged and use the existing delayed retry/terminal failure rules. Empty results are recorded explicitly and do not claim that no real-world changes exist. The state endpoint includes the latest job for each investor even beyond its general recent-job window.

Investor source intake does not automatically build a new meeting brief or mutate a voice session. Evidence IDs and profile versions provide the handoff for that separate feature. This keeps parallel voice and onboarding work independent.

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

`POST /api/voice/sessions` accepts an empty object, not browser-provided facts or prompts. `createApi` injects the context provider and token issuer; the default context provider supplies no company data, CSV facts, notes, investor information, scenario or previous-session summary. The context schema distinguishes empty and provided modes; its future provided shape retains decimal strings, financial source rows, snapshot IDs, note IDs and investor source URLs. The voice path does not run research or financial calculations. Context is validated and saved with each session, so later data changes cannot silently alter its record.

The API obtains a WebRTC token and conversation ID before creating the session. A transactional application check prevents concurrent active voice records. The token goes only to the requesting browser; it is not persisted. `VoicePracticePage.tsx` exposes `/voice` independently of the onboarding gate and uses the same authenticated state API. `VoicePractice.tsx` has its own conversation provider to isolate SDK callbacks from the legacy practice component. It requests microphone permission on Start, offers mute/end, bounds connection startup and duration, stops audio when unmounted, and exposes saved session history. Existing written practice remains independent in the expandable legacy section.

Final transcripts are accepted only through signature-verified webhooks matching the configured agent and a recorded provider conversation. Browser end requests cannot supply authoritative turns. A transcript receipt makes both completed and partial delivery idempotent, including late browser-end requests. Empty and failed conversations are retained as partial records. A missing callback leaves the session awaiting provider evidence; the UI shows temporary live captions separately from the saved transcript and polls the existing state endpoint. After a browser refresh, users can reopen saved turns or close an abandoned active record. This does not remotely terminate audio still running in another tab.

Standalone voice does not run the existing financial topic checker or append a reviewed brief. Evaluation, richer prompting, context assembly and feedback loops are subsequent consumers of the saved context/transcript. Legacy brief-based rehearsals keep their existing behavior. Older rehearsal JSON loads with null context and receipt fields; no historical facts or receipt timestamps are invented and no database migration is needed for these additions.

No raw audio is saved by this application. ElevenLabs-side retention must be configured in the provider account. The main voice entrypoint requires API key, agent ID and webhook secret, but cannot prove callback reachability from their presence. Browser controls enforce a ten-minute limit while mounted; configure provider limits separately. Provider configuration and local startup instructions are in README.md.

## Live video interviewer

The browser TypeScript project (`src/web/tsconfig.json`) uses Vite's bundler resolution, including the LiveAvatar SDK's extensionless type exports. Server, worker and scripts retain NodeNext resolution. Both projects inherit the same strict checks, and `pnpm typecheck` checks both.

```text
Empty context provider
        |
POST /api/avatar/sessions
        +--> reserve rehearsal + nonce hash
        +--> LiveAvatar token (LITE + ElevenLabs connector)
        +--> pin provider session ID; return temporary token
                          |
Browser LiveAvatar SDK <--+
        | microphone               | streamed video + audio
        +--------------------------+-- LiveAvatar / ElevenLabs
                                              |
                            signed ElevenLabs transcript webhook
                                              |
                            validate agent + session nonce hash
                                              |
                            bind conversation ID once; save turns
```

`AvatarProvider.ts` owns the provider port; `LiveAvatar.ts` implements token creation and server-side stop calls with timeouts and validated responses. `AvatarRoutes.ts` owns authenticated create/stop endpoints. API keys, connector secret IDs and avatar selection come from server T3 Env; browsers cannot override them. No provider registration or credential sharing happens automatically. The configured connector owns the ElevenLabs connection and video synchronization; the frontend does not start a second voice session alongside it.

Video sessions reserve the same rehearsal aggregate, including the frozen no-op context. Because the connector creates the ElevenLabs conversation later, the API sends a random nonce and rehearsal ID as connector dynamic variables and stores only the nonce hash. The signed ElevenLabs webhook must return that correlation before a new conversation ID can be bound. Browser events cannot establish the authoritative association. Once bound, existing transcript validation and idempotent completion apply. Correlation is separate from the prompt's company data. Legacy payloads load with null avatar metadata; this feature needs no database migration.

`AvatarPractice.tsx` is lazy-loaded behind the video tab. It renders the real provider media stream with an AI simulation label, optional playback controls, speaking/listening status, mute/end controls, temporary captions and saved transcript history. Switching modes or leaving the component requests provider stop. Connect attempts have a 45-second UI timeout; token creation requests a 600-second provider duration cap. A crashed browser may leave an active record; history exposes a server stop action. Live video cannot be end-to-end verified until provider credentials, a usable avatar and the delegated ElevenLabs connector have been configured. No automatic avatar creation, likeness scraping, investor voice cloning or financial scoring is implemented.

## Local webhook ingress

`src/server/WebhookRelay.ts` exposes only JSON POSTs at the exact ElevenLabs callback path. It forwards raw bytes and the signature to a fixed localhost API URL, with a bounded body size and timeout. Other methods and paths, including the local session and state APIs, return 404. Public responses contain status only; provider payloads and upstream errors are not logged or echoed. HMAC validation and known-conversation checks remain owned by the API.

`StartWebhookRelay.ts` reads only the launcher's injected tunnel settings. The relay and ngrok receive OS launch settings and local ports, not provider or database credentials. Only ngrok receives an optional `NGROK_AUTHTOKEN`; otherwise it uses its existing local authentication. Request inspection is disabled. The tunnel URL can be pinned via `DEV_WEBHOOK_URL`, and failure to bind it stops the development services. This is local development ingress, not a production deployment.

## Current boundaries

The application has a local session cookie, CSRF/origin checks, body limits and rate limiting. It is intentionally single-user and binds only to localhost. Hosted identity/membership authorization, remote deployment, full cash-flow modeling, June accounting integration, outbound messages and investor outreach are not implemented.

Local session cookies are invalidated when the API restarts. The authorization hook returns `LOCAL_SESSION_REQUIRED` before executing a protected operation. `ApiClient.ts` renews that local session and replays the same request once, sharing pending renewal across concurrent requests. This preserves mounted onboarding drafts without a reload. Other authorization errors, network failures and server failures are not replayed, since an uncertain write outcome must not cause duplicate operations. Origin checks still apply to session creation and every retried request.

Every financial explanation preserves the distinction between operating results and other income. Cash runway, currency and founder-segment facts remain unknown until supported. The sample file's July credit is recorded as other income and is not proof that cash was received then.

Operational logs record bounded event categories and workflow stage/attempt. API failures also record the route pattern and error code, without request bodies; use those fields to diagnose parsing and startup failures. They omit credentials, provider bodies, financial rows, transcripts and raw configuration. Setup and verification commands are maintained in README.md.

## Founder onboarding and dashboard

`src/contracts/Onboarding.ts` owns the three-step setup and current meeting context. `ProfileLinks.ts` owns canonical HTTPS identity URLs, rejecting credentials, local/IP hosts and social post/search URLs. LinkedIn and X fields require their respective profile hosts; the firm URL can identify a public team page. These are search hints, not fetched directly or treated as verified evidence.

The additive onboarding migration adds a JSON column to Workspace. Existing rows load as incomplete setup without deleting or reinterpreting financials, investors, briefs or rehearsals. Each Continue action saves a completed step; unfinished text edits stay in the form. The sample route reuses the original fixture by content hash. Financial selection explicitly identifies an existing snapshot. Uploads retain all previous snapshots. Company stage, sector, geography and raise amount can be unknown, and matching returns unknown for those criteria.

Completion atomically saves meeting notes and identity links, upserts one tracked investor, and creates a sourced financial brief. Newly added onboarding investors start paused. Existing tracked investors retain their monitoring setting. Research checks receive the investor name and all saved canonical links; company financials and private meeting notes are excluded from research queries. Editing the same investor preserves its ID and check history. A brief pins the meeting revision, notes and profile links along with its financial snapshot. Older briefs load with null meeting context. Named meetings only attach evidence from that investor’s checks or discovery record, preventing unrelated radar evidence from entering the meeting brief.

`OnboardingPage.tsx` is the first-visit gate at `/`; it supports uploads, sample selection, unknown company details, an optional investor, validation errors, resume and editing. `DashboardPage.tsx` owns the returning overview, meeting context and profile links. Its numbers, activity and practice status come from saved state. The existing financial, investor research, brief, practice and follow-up screens remain reachable from the new top navigation. Standalone `/voice` remains independent; the brief-based practice section carries the selected financial brief and meeting notes. No new paid research or voice session starts merely by completing onboarding.

`POST /api/onboarding/restart` reopens setup by setting its step to 1 and clearing its completion timestamp in the normal revision-checked transaction. It retains the selected snapshot, company profile, meeting notes, investor links and all history. Dashboard and setup-header controls invoke this same endpoint. Repeated restarts are safe and the pending setup persists after reload.
