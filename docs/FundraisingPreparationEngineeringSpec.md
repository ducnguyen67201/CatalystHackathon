# Fundraising preparation dashboard engineering spec

Implemented extension: [Goal investor journey](GoalInvestorJourneySpec.md) specifies the agreed
Goal → Investor match → Add target investor → Tailored brief → Practice → Review progress
flow and persistent history/current graph. Its
[delivery record](GoalInvestorJourneyDelivery.md) and
[checklist](GoalInvestorJourneyImplementationChecklist.md) describe current behavior and limits.

Status: first implementation delivered; the full design below includes later increments.

Implemented: goal confirmation, five-milestone dashboard, deterministic sourced financial
and investor drafts, automatic worker reconciliation, append-only review decisions,
written assessment through the existing evaluator and saved feedback on the same dashboard.
The first release uses validated `Workspace.preparation` JSONB within the existing optimistic
transaction instead of the focused tables below. Founder notes can accompany fixed factual
drafts; freeform artifact rewriting, three-investor comparison, conditional scheduling and
artifact-linked voice/video scenarios remain proposed. Automatic drafting makes no model
calls. See [Architecture](Architecture.md#continuous-fundraising-preparation) for actual ownership.

## Outcome and basis

June should answer: **Where am I, what am I preparing for, what is the next action,
and what has June already prepared for my review?**

The primary dashboard becomes a visual preparation plan. Company evidence and the
founder's confirmed goal create the initial plan before an interview. Investor research
refines preparation; authoritative practice feedback adds or updates gaps. Completing
preparation is distinct from improving business performance or securing investment.

Basis: [Investor prep: AI coaching, October 17, 2026](https://notes.granola.ai/d/265c8bc9-87b4-4f8b-b8ff-73078b71ae43).
The judge explicitly requested fewer features, visual positioning and comparisons,
stage-aware investor context, an A-to-Z preparation experience, and completed proposed
changes with reasons. The goal model, task rules and scheduling below are product and
engineering interpretations of that feedback. He did not request a funding probability
score or promise that completing tasks produces investment by a date.

## Scope and delivery priority

**P0: one complete preparation loop.** Confirm a goal, show deterministic company gaps,
prepare one evidence-backed financial explanation, let the founder review it, rehearse
that explanation, and return to an updated dashboard. Support an optional selected
investor using existing research and scenarios. The full loop must also work through a
written retry without buying a voice/video session.

**P1: compare investor paths.** Compare up to three saved candidates, assemble a tailored
brief for the selected candidate, and show sourced application/contact routes when known.
Provide a conditional preparation schedule after task estimates and availability exist.

Defer business forecasting, valuation, funding probability, automatic outreach, deck
editing/import, new notifications and additional provider integrations. Preserve existing
screens and URLs; move broad charts and practice history below the primary plan rather
than deleting evidence or functionality. Do not add provider configuration or deployment
work to this feature.

## Current implementation and reuse

| Existing owner                                                                | Reuse and limit                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/web/DashboardPage.tsx`                                                   | Returning dashboard and selected statement context; add the preparation plan above existing detail.                                                     |
| `src/contracts/PreparationProgress.ts`, `src/features/PreparationProgress.ts` | Existing six-area practice projection. Retain counts and saved outcomes; this does not currently describe a fundraising goal or pre-interview plan.     |
| `src/features/Financials.ts`, `src/features/EvaluationContextAssembler.ts`    | Reconciled statements, exact financial findings and source-linked metric facts. Extract shared pure rules where needed.                                 |
| `src/features/Followups.ts`, `src/contracts/Followups.ts`                     | Existing coaching actions and written-retry comparisons. Reference their stable session/evaluation/item identities rather than copying their lifecycle. |
| `src/features/InvestorFit.ts`                                                 | Existing criterion comparisons. Its `suitable` flag permits unknowns and is insufficient to establish current mandate or eligibility.                   |
| `src/features/ScenarioService.ts`, `src/server/ScenarioRoutes.ts`             | Reviewed input snapshots, explicit generation, durable jobs and frozen practice context.                                                                |
| `src/web/EvidenceReview.tsx`, `src/web/QuestionEvidenceSheet.tsx`             | Source inspection and exact CSV evidence. Reuse primitives; pre-interview findings have no transcript claim.                                            |
| `src/server/Worker.ts`, `src/infrastructure/PrismaStore.ts`                   | Existing queue, leases, revision checks and atomic publication patterns. No additional worker service.                                                  |

Read [Architecture](Architecture.md), [Investor preparation plan](InvestorPreparationPlan.md)
and [Evidence review spec](EvidenceReviewEngineeringSpec.md) alongside this document.
The supplement's `docs/CODEX-NAVIGATION-GUIDE.md` is absent in this checkout.

## Dashboard experience

The first viewport contains the goal, a short current-position summary, five milestones,
one recommended action and at most two additional priority actions. Details open on demand.

```text
Prepare for your next institutional investor conversation
Goal: founder-confirmed round, amount/currency and intended preparation date
Current position: selected statement date; known context; unresolved inputs

Confirm strategy -> Review financial story -> Select investors
                 -> Approve investor brief -> Rehearse and review

NEXT: Review July's operating-performance explanation
WHY: Positive net income includes a credit while operations show a loss.
PREPARED: Proposed talking point + comparison chart + likely follow-up question
[Review prepared explanation]
```

This is a dependency graph presented as a path, not a forced wizard. Financial review
and investor selection may proceed in parallel. Financial correction does not require
an investor. The tailored brief requires a selected investor and reviewed narrative;
targeted rehearsal pins the selected artifact and scenario versions.

Milestones display blocked, available, in progress, needs review, or complete, with a
text reason and completion evidence. Avoid a single readiness percentage. Show
"3 of 5 preparation milestones complete" only against the current plan revision,
and explain changed requirements when a later revision changes the denominator.
Completion describes this plan, not investment eligibility or financial health.

Selecting an action opens a panel with: why now, evidence, what June prepared,
proposed changes, missing inputs, completion criteria and the next button. Pending and
failed work retain the last saved result with its status. Closing the panel loses no
saved review decisions; unsaved edits warn before dismissal.

The path is an accessible ordered list with text statuses, keyboard-operable buttons
and no color-only meaning. Stack milestones vertically on small screens. Charts include
an equivalent table and source links. Return focus to the initiating action after closing.

## Goal and current situation

Store a versioned goal separately from historical company profile payloads:

- Goal type: investor-conversation preparation for the initial release.
- Intended round label, raise amount and currency: independently nullable/unknown.
- Financing history: founder-confirmed prior rounds with dates and amounts when known;
  retain provenance and confirmation time. No prior record means unknown, not never raised.
- Desired preparation date and IANA timezone, optional selected investor IDs, and optional
  founder availability. Never infer availability from a target date.
- Selected financial snapshot, profile version and goal revision.

Prefill existing stage/raise fields as suggestions for confirmation. Company stage, number
of previous rounds and intended round are separate concepts. Do not assert that a second
round excludes every angel or guarantees a larger VC is appropriate.

Current situation uses the selected reconciled statement and typed findings. A company
can be prepared to explain an operating loss without the operating loss being resolved.
Cash runway, retention and ROAS remain unavailable without their required inputs.

## Where actions come from

Assemble inputs in this order, preserving each source's authority:

1. Confirmed goal, company profile, financing history and selected financial evidence.
2. Saved research for the selected investor, with dates, verification and uncertainty.
3. Relevant completed practice reviews and linked follow-up comparisons.

Use deterministic P0 rules for missing goal context, the operating-loss/credit distinction,
missing investor-fit criteria and review/rehearsal dependencies. Models may draft language
and propose investor emphasis; they do not assign financial truth, task completion or
funding likelihood. Existing unknown/contradicted findings outrank cosmetic pitch emphasis.

Every action has a stable logical key, origin references, topic, dependency IDs, owner
(`founder` or `june`), explanation, success criteria and required evidence. Deduplicate by
goal identity, topic and investor scope; retain links to all contributing findings. Source
version changes create an action revision rather than an unrelated duplicate.

Priority order: invalid or missing required context; unsupported central financial
conclusions; evidence blockers; required review decisions; investor emphasis; rehearsal.
Within a priority class, use dependency availability and stable creation order. Show
blocked high-priority work with its blocker and recommend the next actionable item.

Manual completion is allowed for a confirmation/review decision, not financial verification
or demonstrated speaking improvement. Dismissal records a reason and remains separate
from completion. A founder's unsupported edited claim may be saved as a draft but cannot
pass the evidence gate.

## Prepared artifact and review loop

P0 artifact: a financial explanation with a chart and targeted rehearsal objective.

Persist the original statement when supplied, proposed talking point, concise rationale,
fact references, chart specification, question and success criteria. Before an interview,
an original pitch claim may be absent: label the result "Suggested explanation" and do
not manufacture a founder quote or imply an uploaded deck was edited.

For the fictional Tidewell case, plot operating income, credit and reported net income
for the selected period, with adjacent months only where comparable rows exist. Treat
these as source series, not an invented accounting bridge. Any bridge requires the exact
validated reconciliation formula and all components. Preserve unknown currency and show
"currency not confirmed"; never add a dollar sign by assumption. Decimal.js calculates
derived figures on the server; charts may convert validated values for geometry only.

The founder can accept, edit or reject a specific artifact version. Acceptance means
"reviewed preparation", not approval of an accounting change. Edits create a new version
and are checked against existing facts; unsupported figures remain flagged. Never mutate
financial snapshots, original transcripts, scenario inputs or earlier brief versions.

Start rehearsal through the existing source-review flow. Extend new scenario inputs with
an optional artifact reference and frozen contents; validate the artifact belongs to the
workspace and goal, and include it in the source-review hash. Extend the scenario provider
adapter/prompt rather than trusting browser-supplied artifact text. Optional fields preserve
older payload hashes and records; active sessions never acquire changed preparation.

Reuse existing written follow-up retry comparisons when an evaluation item exists. Add
optional plan/action/artifact lineage for new rehearsals. A general completed voice session
does not resolve an action. P0 pre-interview rehearsal completion requires a saved assessment
against that action's success criteria; if comparable before/after evidence is absent,
display "assessed" rather than "improved". Missing transcripts or failed reviews leave it pending.

## Investor path comparison (P1)

For up to three candidates display stage, sector, geography, participation/check context,
reported priorities, tradeoffs and missing information. Each criterion is aligned,
mismatch, unknown or conflicting and links to source passages and dates. Separate
historical deal observations from current stated mandate. Do not reuse the existing
`suitable` boolean as a definitive recommendation.

Round size is not individual check size; a check smaller than the total raise can still
represent participation. Compare currencies only when known and equal. Unknown fit must
stay visible. A founder can choose a candidate with unknowns; create a verification action
instead of claiming eligibility. No opaque numerical ranking is required.

The selected brief contains reviewed company talking points, sourced investor context,
questions to clarify fit and a public application/contact URL only when supported. Label
source URL and retrieval date; otherwise show "route not confirmed". Opening a link does
not mean outreach was sent. Generation and outreach remain separate actions.

## Preparation timing

P0 displays the founder's desired preparation date and pending work; it predicts no finish
date without estimates. P1 accepts explicit duration estimates, dependency order and
founder availability. Schedule founder tasks serially within available windows; independent
June jobs may overlap, with unknown queue/provider duration disclosed. Compute in the
saved timezone and account for daylight-saving transitions.

Return a conditional preparation finish/range only when every critical dependency has
a bounded estimate and availability. Otherwise return the missing assumptions and no ETA.
Show when the plan misses the requested date. Label estimates with calculation time and
assumptions. Never translate task completion into revenue growth, financial improvement,
funding probability or an investment closing date.

## Proposed contracts, storage and consistency

Add strict Zod contracts under `src/contracts/FundraisingPreparation.ts`. Use discriminated
origin references for financial findings, investor research, founder decisions and saved
evaluation items. Resolve IDs server-side within workspace scope. Bound a plan to 30 actions,
five milestones and three comparison candidates; reject oversize commands explicitly.

Separate three state dimensions:

- Task: `blocked | available | in_progress | needs_review | complete | dismissed`.
- Artifact: `not_requested | queued | running | ready | failed`, plus immutable versions.
- Freshness: `current | outdated`, with changed input references.

An accepted artifact can become outdated without erasing the acceptance event. Append a
new plan revision with a review requirement; keep the old completed plan accessible.

Use an additive Prisma migration with these new workspace-scoped records:

| Proposed record           | Contents and constraints                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreparationGoal`         | Stable goal ID, current revision pointer and optimistic version.                                                                               |
| `PreparationPlanRevision` | Immutable validated goal/context snapshot, actions/dependencies, input hash and planner version; unique goal/revision.                         |
| `PreparationArtifact`     | Immutable input/prompt/model snapshot and eventual validated result; one unique durable job association. Explicit attempts create new records. |
| `PreparationDecision`     | Append-only accept/edit/reject/dismiss/confirm events referencing exact plan/action/artifact versions and idempotency key.                     |

Rehearsal/evaluation IDs remain references to their existing records. Derive current status
from the plan, decisions and saved results. Do not introduce a competing progress counter
or repurpose existing financial `Milestone` records. New tables use a focused preparation
store port implemented in `PrismaStore.ts`; exclude them from aggregate upserts and
`/api/state` payloads.

Plan assembly is deterministic and explicit. Snapshot current profile, financial, research
and relevant evaluation identities under a consistency check; atomically persist the plan
and advance the goal pointer. Inputs changing concurrently return a conflict. Creation is
idempotent for the same workspace/operation/request key and payload; changed payload under
the same key returns 409.

Artifact creation atomically freezes inputs and queues `prepare-artifact:<id>` through
the existing job system. Publish output and job success in one transaction with the current
unexpired lease. Reclaimed workers cannot publish; retries may repeat a provider request
but cannot publish twice. A result generated from older inputs remains historical/outdated
and cannot silently replace the current artifact. Reject unknown citations and unsupported
numerical prose; render numbers from validated fact references. Preserve failed attempts.

## Proposed API and module ownership

All routes inherit current session, workspace access, origin and rate-limit controls.
Reads use private/no-store responses and never initiate generation or provider sessions.

| Route                                         | Behavior                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/preparation-plan`                   | Current bounded dashboard projection, freshness, blockers and next action; empty state when no goal exists. |
| `POST /api/preparation-goals`                 | Confirm goal and create initial deterministic plan; no paid calls.                                          |
| `POST /api/preparation-goals/:id/revisions`   | Review changed goal/source inputs and append a plan revision with expected version and preview hash.        |
| `POST /api/preparation-actions/:id/artifacts` | Explicit generation with plan revision, reviewed input hash and request key; returns 202 and job ID.        |
| `GET /api/preparation-artifacts/:id`          | Saved artifact, evidence, review history and job state.                                                     |
| `POST /api/preparation-actions/:id/decisions` | Validate exact version and append founder decision; stale acceptance returns 409.                           |

Reuse existing scenario/rehearsal/retry routes with optional validated preparation lineage.
Do not add a second transcript intake. Invalid/cross-workspace references return 404;
invalid transitions return 409; malformed input returns 400. Missing provider configuration
has an explicit failure state with no fictional fallback.

Proposed modules: `features/PreparationPlanner.ts` for pure rules and dependency/status
projection; `features/PreparationPlanService.ts` for commands; `features/PreparationStore.ts`
for persistence port; `features/PreparationArtifactProvider.ts` and
`infrastructure/PreparationArtifact.ts` for structured generation;
`server/PreparationRoutes.ts`; `web/PreparationPlan.tsx`,
`web/PreparationActionPanel.tsx` and `web/PreparationComparisonChart.tsx`.
Add the timing module only in P1. Wire services through `server/Runtime.ts` and the existing
worker. Preserve strict TypeScript, Zod boundaries and PascalCase owned filenames.

## Incremental implementation and acceptance

1. **Plan foundation:** goal confirmation, additive storage, deterministic rules and dashboard
   path. A founder with no practice history gets useful tasks. Unknown round, currency or
   investor context stays unknown; goal edits preserve prior revisions.
2. **Completed preparation:** exact chart, explicit artifact generation, review/edit/reject
   and refresh-safe decisions. One credit-related explanation can be reviewed end to end.
3. **Close the rehearsal loop:** artifact-aware source preview and scenario context, linked
   written/voice/video practice, saved assessment and dashboard return. No action completes
   from session start, answer submission, dismissal or model failure.
4. **Investor comparison and conditional schedule:** add P1 only after the P0 loop works.

Required tests cover dependency cycles, stable deduplication, action priority, no-history
planning, unknown criteria, contradicted/unsupported edits, zero or missing periods,
decimal precision and currency handling. Cover stale previews, concurrent edits, idempotent
commands, worker lease recovery, duplicate job execution and atomic publication. Historical
artifacts and sessions reopen unchanged after a new upload or investor update. An old-source
rehearsal cannot resolve a materially changed current-plan gap without a new assessment.

Integration tests use provider doubles and a disposable database. Verify no provider call
on reads, generation remains explicit, unrelated investor sources are excluded, and missing
credentials preserve useful read-only state. Component/browser checks cover keyboard/focus,
mobile layout, textual chart equivalents, pending/failure/retry and return-to-dashboard
status. Treat uploaded text, research passages and transcripts as untrusted content.

After implementation edits finish, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
`pnpm test`, `pnpm build` and `pnpm test:integration`. Record live-provider checks separately;
automated validation requires no paid sessions, provider changes or outbound messages.

Demo acceptance: using explicitly fictional evidence, a founder confirms their target,
sees the operating-performance gap, reviews a prepared sourced explanation, completes a
targeted rehearsal and returns to a dashboard that shows the saved result and remaining
action. The demonstration must work after refresh and must never imply funding is secured.

Success signals: the founder identifies the next action without opening multiple screens;
a prepared artifact is accepted or edited; rehearsal results return to the same plan;
and every completion has inspectable evidence. These can be validated locally without
adding an external analytics dependency.
