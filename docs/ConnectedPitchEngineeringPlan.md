# Connected pitch preparation

Implemented extension: [Goal investor journey](GoalInvestorJourneySpec.md) extends this
loop with goal-scoped match scoring, independent investor tracks, and a persistent
history/current-position graph. See its [delivery record](GoalInvestorJourneyDelivery.md)
for current ownership, validation and limits.

Status: real-app six-step implementation added; validation is recorded in ConnectedPitchImplementationChecklist.md. The HTML remains a fictional prototype.

Open [the connected mockup](previews/ConnectedPitchPreview.html). All company data, investors, research and practice results in it are fictional. It uses no providers or backend. The mock saves its own state in this browser; Reset clears only that state.

## The product in one picture

```text
                       ONE PREPARATION PLAN
                                |
                       Upload company evidence
                                |
                    June prepares pitch version 1
                                |
                  Review changes + edit + approve
                                |
                   Compare up to three investors
                                |
                         Choose one investor
                                |
                    Review investor-specific pitch
                                |
                  Practise that exact pitch version
                                |
                  Saved transcript + evidence review
                                |
                  June proposes a better pitch (v2)
                                |
                       Founder reviews changes
                                |
                 Approve -> refresh tailored pitch
                                |
                                +------> Practise again
```

The dashboard answers only: **Who am I preparing for? Which pitch am I using? What should I do next?** Research, sources and earlier versions stay available as details.

## What exists and what we add

Baseline: GitHub main `8a60264`, inspected October 17, 2026. The actual source takes precedence over older aspirational sections in existing specs. This plan extends [FundraisingPreparationEngineeringSpec.md](FundraisingPreparationEngineeringSpec.md), rather than replacing the implemented schedule or planner.

| Area                  | Existing owner                                                                                  | Proposed addition                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Company evidence      | `Financials.ts`, immutable snapshots, `EvaluationContextAssembler.ts`                           | Reuse selected snapshot, exact facts, reporting period and currency.                                                                    |
| Preparation dashboard | `PreparationPlanner.ts`, `PreparationPlanService.ts`, `PreparationPlan.tsx`                     | One current pitch, linked investor preparation, one next action. Keep the current schedule.                                             |
| Prepared content      | `FundraisingPreparation.ts` has at most two fixed artifacts; decisions accept/reject with notes | Separate editable pitch revisions with change reasons, source references and review decisions. Do not overload the two-artifact schema. |
| Investor research     | `InvestorTrackingService.ts`, `InvestorDiscoveryService.ts`, saved source versions              | A bounded comparison of saved candidates; sourced tradeoffs and contact/application routes where available.                             |
| Fit assessment        | `InvestorEvaluationWorkflow.ts` compares exact stage/sector/geography labels                    | Show that limited comparison honestly. Add separately sourced current criteria; unknowns remain unknown.                                |
| Scenario creation     | `ScenarioSources.ts`, `ScenarioService.ts`, source preview/review hash                          | Freeze the approved pitch and selected investor into the reviewed scenario input.                                                       |
| Practice              | `PracticeContext.ts`, written rehearsal, voice/avatar routes                                    | All modes carry the same pitch revision and preparation lineage. Keep existing transcript intake.                                       |
| Feedback              | `EvaluationOrchestrator.ts`, saved reports, follow-ups                                          | Propose a new pitch revision tied to specific feedback. Never overwrite the approved revision.                                          |

Paths above are under `src/features`, `src/contracts` or `src/web` as appropriate. Source ownership is described in [Architecture.md](Architecture.md).

## Fit the three features into the current UI

Keep `WorkspaceLayout.tsx` navigation unchanged: Overview, Meetings, Investor radar,
Investor research, Financials, Meeting brief, Practice scenario, Follow-ups. Retain the
72px icon sidebar, current slate/cream styling, compact schedule, tables and review drawers.
The prototype loads the real application CSS from `src/web`; keep the repository beside
it when opening the HTML. Blue labels distinguish proposed connections from existing UI.

```text
1. OVERVIEW (current dashboard and preparation schedule)
   Review prepared work -> financial explanation drawer
                           evidence + edit + approve
                                       |
                                       v
2. INVESTOR RESEARCH (current watchlist)
   Compare investors drawer -> select investor
                                       |
                                       v
   MEETING BRIEF (current table + review drawer)
   approve tailored brief using exact pitch version
                                       |
                                       v
3. PRACTICE SCENARIO (current source review + scenario table)
   review sources -> saved scenario -> existing practice room
                                       |
                                       v
   FOLLOW-UPS / MEETING BRIEF PRACTICE REVIEW
   saved transcript + report -> proposed pitch edit
                                       |
                                       +--> OVERVIEW financial story drawer
                                            approve next version
                                                  |
                                                  +--> refresh investor brief
                                                       practise again
```

| Existing screen/component                              | Where proposed functionality belongs                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DashboardPage.tsx`, `PreparationPlan.tsx`             | Keep “Make your next conversation count”, the operating-position strip, schedule and recommended action. Add a compact 1/2/3 connection strip inside the plan. Open editable pitch revisions in the existing prepared-work review surface, not a new Pitch page. |
| `InvestorTrackingPage.tsx`                             | Keep suggestions, watchlist and selected source detail. Add Compare and Prepare for this investor actions; comparison opens a drawer.                                                                                                                            |
| `MeetingBriefs.tsx`                                    | Reuse brief/practice table and right-side review drawer. Display tailored pitch lineage and approve-to-scenario action. Earlier approved briefs remain visible.                                                                                                  |
| `ScenarioPractice.tsx`, `ScenarioGenerationReview.tsx` | Reuse investor/objective controls, source review and scenario table. Add exact approved pitch/brief references to the source snapshot.                                                                                                                           |
| `ScenarioRoom.tsx`, existing transport components      | Keep room, question evidence and text/voice/video controls. Carry frozen preparation lineage into the session.                                                                                                                                                   |
| `Followups.tsx`, `PitchPreparationReport.tsx`          | Keep transcript-linked feedback and recommended preparation. Add a proposed edit that opens the original financial-story drawer on Overview.                                                                                                                     |
| Financials, Investor radar, Meetings                   | Remain supporting evidence/research/context screens with links into preparation; no new primary wizard.                                                                                                                                                          |

The dashboard still answers one next action. Navigation does not complete a step, generate
content or start a provider session. Do not show all implementation stages as new sidebar
entries or impose a new full-page Evidence -> Pitch -> Investor wizard.

## Delivered persistence increment

The real app now uses optional `Workspace.preparation.connected` JSON inside the existing
Prisma revision-checked transaction. This deliberately defers the focused tables below:
small-workspace consistency and compatibility are retained without a migration. Cycles,
pitch versions and command receipts are validated by `ConnectedPreparation.ts`; the current
read model bounds history to ten cycles. Dedicated tables/pagination remain a later scaling
increment, not a completed feature. Scenario creation binds its generation pointer atomically
under the workspace lock. Existing practice context v2 carries an optional preparation input;
its absence preserves old hashes without introducing a parallel context version.

The new real-app routes live at `/api/preparation-loop`, `/commands`, `/scenario-preview`,
`/scenarios`, `/scenario-retry` and `/rehearsals`. Draft revision proposals reuse saved model
coaching and its example answer, with explicit founder editing/approval; no additional drafting
model or financial verification is claimed. The detailed future design below remains useful
for a later extraction into focused persistence/providers.

## The connection: immutable version references

```text
Workspace
  |
  +-- Existing preparation goal + plan
  |
  +-- PitchDraft (one editable story identity)
        |
        +-- PitchRevision v1 ----> snapshot + profile + fact references
        |       |
        |       +-- ReviewDecision: approved v1
        |                         |
        |                         v
        |                InvestorComparison snapshot
        |                         |
        |                         v
        |                Tailored PitchRevision t1
        |                         |
        |                         v
        |                PracticeLink -> existing rehearsal
        |                                     |
        |                                     v
        |                              Existing evaluation
        |                                     |
        +-- PitchRevision v2 <---- RevisionProposal
                |
                +-- founder approval -> new tailored revision -> next practice

v1, t1, transcript and evaluation stay unchanged after v2 exists.
```

Proposed additive Prisma records, accessed through a `PitchPreparationStore` port:

| Record                    | Required contents                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PitchDraft`              | Workspace/goal identity, draft kind (general or tailored), selected investor when tailored, current revision pointer.                                                                                                       |
| `PitchRevision`           | Parent revision, general-pitch parent for tailored drafts, bounded content blocks, source snapshot/hash, profile/goal version, citations, change reasons, fictional label, creator and creation time. Content is immutable. |
| `PitchReviewDecision`     | Exact revision and content hash, approved/rejected decision, founder note, request key and time. Approval is a human decision, not proof of accounting truth.                                                               |
| `InvestorComparison`      | Up to three investor IDs, frozen source versions, criterion provenance, observations, tradeoffs and unknowns. Selection is revision-checked.                                                                                |
| `PreparationPracticeLink` | Plan/goal, general and tailored revision IDs, investor/comparison IDs, reviewed input hash and existing rehearsal ID. Unique rehearsal reference.                                                                           |
| `PitchRevisionProposal`   | Exact session/evaluation and target base revision, linked coaching item IDs, suggested blocks/reasons, job state and resulting revision.                                                                                    |

Use focused tables for this new growing revision history. Keep existing preparation JSON and historical artifacts intact. Do not add these records to aggregate upserts or the unbounded `/api/state` response. Join small bounded summaries into the preparation projection. List history with cursor pagination.

## Commands and background work

Proposed routes, all under existing workspace/session/origin controls, with strict Zod inputs and private/no-store reads:

| Route                                           | Purpose                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/pitch-preparation`                    | Current draft, approvals, selection, freshness and next action. No generation on reads. |
| `POST /api/pitch-drafts`                        | Freeze inputs and create initial draft generation job.                                  |
| `POST /api/pitch-drafts/:id/revisions`          | Save founder edits as a new revision with expected base revision.                       |
| `POST /api/pitch-revisions/:id/decisions`       | Approve/reject exact current content after source checks.                               |
| `POST /api/investor-comparisons`                | Assemble comparison from saved research. No new search implicitly.                      |
| `POST /api/pitch-drafts/:id/investor-selection` | Save selection and queue a tailored draft using the approved general pitch.             |
| `POST /api/pitch-preparation/practice-preview`  | Return the exact frozen practice input and review hash.                                 |
| Existing scenario/session creation routes       | Accept optional preparation selection + reviewed hash; resolve IDs on server.           |
| `POST /api/pitch-revision-proposals`            | Explicitly request a revision from one saved evaluation and base revision.              |
| `GET /api/pitch-drafts/:id/history`             | Paginated revisions, decisions and related practice.                                    |

Every mutation has an idempotency key, expected version/base and content hash. Same key + same payload replays; changed payload returns 409. Cross-workspace/missing IDs return 404, invalid inputs 400, stale transitions 409. Reads never create drafts, research or provider sessions.

```text
Browser command
      |
      v
Zod + workspace access + freshness check
      |
      v
Prisma transaction: freeze inputs + enqueue existing durable job
      |
      v
Existing worker -> structured draft provider -> output/citation checks
      |
      v
Prisma transaction: current lease fence + save revision + complete job
      |
      v
Browser shows "Ready for your review"
```

Reuse the existing queue, bounded provider calls, retries and lease fences. Obsolete workers cannot publish. Store failure separately from empty content. A delayed result can be retained historically but cannot replace a newer revision. Wire through `Runtime.ts` and `Worker.ts`; no additional worker service.

Initial/tailored drafts and feedback revision proposals can use a new structured `PitchDraftProvider` adapter. Financial amounts come from existing Decimal calculations. Prefer structured fact references rendered as exact strings; validate every cited ID against frozen inputs. Freeform founder/model prose remains unverified where claim support is unknown. Saving an unsupported edit is allowed; it cannot become an evidence-supported claim through founder approval. Never rewrite financial source data.

## How practice closes the loop

1. Resolve the approved general and tailored revisions server-side; freeze their content, sources, investor comparison and success criteria in the scenario preview.
2. Include that snapshot in the review hash. Any material change before creation requires a new review.
3. Introduce a version 3 practice context for preparation-linked sessions; retain v1/v2 parsing and hashes exactly. Extend scenario and evaluation schemas with optional lineage without defaults on historical records.
4. Written practice, ElevenLabs and LiveAvatar consume the same preparation context through existing session paths. Voice provider prompts must be verified to honor the supplied snapshot before claiming live completion; do not automatically change provider settings.
5. Keep authoritative written acceptance and provider-receipted transcripts unchanged. Feed the frozen context into the existing evaluator.
6. From a completed evaluation, create a proposed revision with explicit feedback-item/turn references and a parent pitch revision. A proposal based on an old parent becomes a historical suggestion requiring rebase/review.
7. Founder approval advances the current pitch. The old investor brief becomes outdated; regenerate and approve it before targeted practice. Prior sessions stay readable.
8. A second assessment can show improvement only for comparable saved evidence/criteria. New evidence or a different investor may require a new baseline. No universal mastery or funding score.

Proposals begin as explicit actions. Later, founder opt-in can automatically queue a proposal after a completed evaluation, with one deduplicated job per evaluation/base revision and a configured cost budget. Automatic preparation never means automatic approval or outbound contact.

## State and recovery rules

```text
Draft -> Saved revision -> Approved -> Tailored -> Approved brief
                                                    |
                                                    v
                                                Practice
                                                    |
                         pending / failed <---- Evaluation
                                                    |
                                                    v
                                             Proposed revision
                                                    |
                                                    +----> Draft

New evidence ----> current approvals need review; history preserved
New investor ----> tailored brief needs review; general pitch preserved
Edit general ----> old tailored brief outdated; history preserved
Model failure ---> previous approved pitch stays available; retry available
```

Opening a screen never performs a paid action. A failed or pending review cannot complete a preparation task. Dismissing a suggestion does not count as improvement. Unknown mandate, currency, cash runway or contact route stays visible. An investor's historical deal is not its current mandate; whole-round totals are not individual checks. Contact links are displayed only with saved evidence and remain user-opened; no outreach is sent.

## Delivery order and acceptance

| Slice                 | Work                                                                            | Done when                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Versioned pitch    | Add schema/store, draft generation, editor, source/change review and decisions. | A founder saves v2, approves it, refreshes, and can still read v1. Conflicting edits return 409.                                |
| 2. Investor handoff   | Add bounded comparison, selection and tailored revisions.                       | Choosing any of three candidates changes the tailored content and source set. Unknown criteria stay visible.                    |
| 3. Written loop       | Add preview/hash, lineage, written session and evaluation-linked proposals.     | Approved brief -> answer -> saved review -> revised draft -> approval -> next practice works end to end.                        |
| 4. Voice/video parity | Reuse lineage through existing provider session paths.                          | Saved receipt, evaluation and proposed revision point to the exact approved pitch. Failure/retry preserves the last good state. |
| 5. Dashboard polish   | One next action, stale-input recovery and compact history.                      | New upload creates a review requirement without changing any historical draft/session.                                          |

Ship slices 1–3 as the first complete release. Investor discovery, schedule controls and existing reports remain available. Deck import, financial forecasting, auto outreach, new integrations and a redesign of onboarding are outside this change.

Validation should cover stale approval, concurrent edit, duplicate command/job, current lease publication, unrelated investor-source exclusion, unsupported figures, precise decimal/currency handling, old context compatibility, missing transcripts, rejected revisions, changed evidence and second-practice lineage. Integration checks use provider doubles and a disposable database. UI checks cover keyboard operation, dialog focus, mobile layout, saved state and failure recovery.

After implementation edits finish, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:integration`. Live providers are a separate explicitly authorized check. The HTML prototype simulates the journey only; it does not validate answers or demonstrate provider behavior.

## Prototype walkthrough

1. On Overview, use Review prepared work to open the financial explanation drawer. Inspect the real repository fixture values, edit and approve the story.
2. Investor research opens with a comparison drawer. Choose an investor to open the Meeting brief screen and tailored-brief drawer.
3. Approve the brief to reach Practice scenario. Review its saved sources, create the fictional scenario and open the existing-style room.
4. Use a written example, or select the voice/video layout, and finish the simulated conversation. All modes remain fictional and make no provider calls.
5. Follow-ups opens the saved report beside its transcript. Review the proposed pitch edit to return to the Overview drawer.
6. Approve the next version, refresh the investor brief and practise again. Meeting brief retains previous records; Overview history retains drafts and sessions.
7. Financials, Investor radar and Meetings each link into the same shared preparation state. Simulating a new source snapshot invalidates current approvals while preserving history.
8. The top preview toolbar offers the ASCII screen map and Reset. All data stays in the browser under a prototype-only storage key.
