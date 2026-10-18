# Goal, investor match, practice, and progress specification

Status: core connected flow implemented locally, October 17, 2026. The design contract
below remains the intended behavior; [delivery evidence and limits](GoalInvestorJourneyDelivery.md)
distinguish implemented scope from later scale and live-provider verification.
Design baseline: local commit 3644bfc.
Delivery gates: [implementation checklist](GoalInvestorJourneyImplementationChecklist.md).

## 1. Product contract

    Goal -> Investor match -> Add target investor -> Tailored brief
                                                       |
                                                       v
    Homepage progress graph <- Review progress <- Practice
               |                     |
               |                     +-> Revise -> Practise again
               +-> One next action in the same goal

One fundraising goal owns the journey. Investors are separate preparation tracks under
that goal. Compare investors before creating a brief. Choosing another investor must
not replace the goal or erase another track.

Review progress is a persistent product surface: a graph of recorded preparation history,
the current position, and separately labeled planned remaining work. It is more than
an assessment screen or session counter. Historical points open the exact briefs,
practices, assessments, decisions, and evidence behind that moment.

The experience must answer:

1. What am I trying to achieve?
2. Which investors fit this goal, why, and what remains unknown?
3. Which investors have I chosen to prepare for?
4. Which exact brief and company story am I practising?
5. What did the saved assessment establish, and what still needs work?
6. Where am I now compared with my recorded preparation history?
7. What should I do next, and what work remains under my planning assumptions?

### Agreed boundaries

- Investor match, assessed practice outcomes, and preparation progress are separate measures.
- A match score expresses alignment with a goal, never investment probability.
- Accepting an edit or completing a session does not establish improvement.
- Estimated dates concern preparation readiness, never a promised funding close.
- Monitoring, shortlisting, and practising for an investor are separate decisions.
- Preserve source snapshots, financial records, transcripts, versions, and historical approvals.
- Implementation follows the user's subsequent explicit request; no deployment is included.

## 2. Implementation baseline and integration requirements

The table records the pre-implementation baseline and required integration work. Current
ownership and delivered behavior are recorded in [Architecture](Architecture.md#goal-investor-journey)
and the [delivery record](GoalInvestorJourneyDelivery.md).

| Area                       | Existing owner and behavior                                                                         | Required change                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Goal                       | PreparationIntent.ts, PreparationPlanService.ts, FundraisingPreparation.ts append goal records      | Add stable journey identity across revisions; meeting/target selection does not create another goal |
| Radar                      | RadarUpdates.tsx, RadarResults.ts, RadarDeliveryService.ts preserve event/evidence links            | Goal-specific match summary, fit inspection, target action                                          |
| Research                   | InvestorTrackingService.ts, InvestorDiscoveryService.ts, Research.ts save checks and observations   | Typed mandate facts; separate identity resolution from monitoring                                   |
| Fit                        | InvestorFit.ts and ConnectedPreparation.ts contain different limited comparisons                    | One shared deterministic, versioned assessment                                                      |
| Preparation                | ConnectedPreparationService.ts and ConnectedPreparation.ts frequently use the latest cycle          | Resolve current cycle by journey and target                                                         |
| Brief                      | Connected cycles contain brief text; legacy Brief records have separate history                     | Immutable connected brief IDs/revisions with explicit lineage                                       |
| Scenario/practice          | ScenarioService.ts, ScenarioSources.ts, PracticeContext.ts freeze reviewed inputs                   | Extend lineage without changing old hashes or transcript authority                                  |
| Assessment                 | RehearsalEvaluationService.ts, EvaluationOrchestrator.ts, Followups.ts persist reports/retries      | Results update the originating track and its next work                                              |
| Homepage                   | PreparationPlan.tsx, PreparationSchedule.tsx, PreparationScheduleModel.ts show the current schedule | Persistent history/current graph and multi-target scope                                             |
| Existing practice progress | PreparationProgress.ts groups saved topic observations across root practices                        | Retain that view; add explicit journey/target filtering                                             |

Owners are under src/contracts, src/features, src/web, src/server, or src/infrastructure.
See [implemented architecture](Architecture.md). The referenced
docs/CODEX-NAVIGATION-GUIDE.md is absent in this checkout.

This requires more than button wiring: cycle resolution, shared-source freshness,
scenario transaction guards, worker reconciliation, and progress aggregation must all
become target-aware together.

## 3. Information architecture

Keep existing sidebar destinations and responsive styling. Do not add a separate CRM wizard.

| Destination             | Content                                            | Handoff                                      |
| ----------------------- | -------------------------------------------------- | -------------------------------------------- |
| Overview                | Goal, graph, schedule, targets, one next action    | Resume exact required step                   |
| Radar: Updates          | News/source/date, match summary, target state      | Review match or shortlist                    |
| Radar: Target investors | Goal-scoped targets, freshness, preparation status | Open target preparation                      |
| Investor research       | Watchlist, check history, independent monitoring   | Explicit research refresh                    |
| Meeting brief           | Current target brief and prior revisions           | Approve exact brief, inspect scenario inputs |
| Practice                | Existing scenario library and practice room        | Explicit written/voice/video practice        |
| Progress review         | Historical point, feedback, transcript, evidence   | Revision/retry and updated goal progress     |

Active journey and target survive reload, browser back/forward, and direct links.
Links carry journeyId, targetId, and immutable artifact/session IDs where relevant.
The server resolves and authorizes all references. Invalid links do not silently choose
another investor or fall back to open practice. Archived targets open as history.

### Homepage arrangement

    +------------------------------------------------------------------+
    | MY GOAL                        Preparation target / assumptions   |
    +------------------------------------------------------------------+
    | PREPARATION PROGRESS                                              |
    | Recorded history        Current position       Planned work       |
    | [inspect point]         [inspect current]       [edit estimates]   |
    +------------------------------------------------------------------+
    | NEXT ACTION: reason + exact target/brief/session + Resume           |
    +------------------------------------------------------------------+
    | Target investor | Match + coverage | Preparation state | Next step |
    +------------------------------------------------------------------+
    | Shared company story / Evidence / Detailed topic feedback          |
    +------------------------------------------------------------------+

The graph and schedule describe one journey. Preserve source-linked financial charts;
do not present operating performance as preparation progress.

## 4. Step 1: confirm the goal

Retain simple free-text goal entry with optional structured details. Never infer round,
amount, financing history, currency, or dates from prose without founder review.

Matching inputs: intended round, sector, company geography, total raise amount/currency,
desired individual check minimum/maximum/currency, and investor preferences.
Preparation target date is separate from an optional desired fundraising-close date.
Only the preparation date drives the preparation schedule.

Unknowns remain null. Validate positive amounts, ordered ranges, supported currency,
bounded text, and IANA timezone. Financial comparisons use Decimal.js. Automatic
foreign-exchange conversion is outside this release.

A stable GoalJourney owns append-only goal versions. Editing the objective appends a
version under that journey. Explicitly starting a different objective creates a new
journey. Initially support one active journey with archived journey access.

Selecting/focusing an investor or editing meeting notes must not change goal identity.
Semantic matching changes invalidate affected assessments. Availability-only changes
update the schedule without invalidating match or brief content.

## 5. Step 2: assess investor match

### Source-backed facts

Extend existing extraction with optional strictly validated InvestorMandateFacts in the
same bounded research workflow. Each fact retains criterion, normalized value/range,
subject identity, scope, exact quote, evidence/research-run IDs, URL, publication and
retrieval timestamps, and any explicit validity dates. Preserve original wording.

Scopes distinguish stated mandate, historical participation, qualitative thesis, and
founder-provided preference. A portfolio company's stage/location or financing-round
total never establishes investor mandate or individual check size.

Use controlled rules: membership in explicitly stated stage sets, supported geographic
regions, versioned sector taxonomy, and same-currency check-range overlap. Broader-to-
narrower category matching requires documented taxonomy rules. Ambiguity remains unknown.
Loose name similarity or an uncited model conclusion cannot establish eligibility.

Uncertain identity blocks a numerical score. Conflicting facts remain visible until
sourced supersession or a reviewed resolution exists; newest article does not
automatically mean authoritative source.

### Version 1 scoring

These are implementation defaults, not empirically calibrated predictions.

| Criterion                      | Weight | Required basis                                             |
| ------------------------------ | -----: | ---------------------------------------------------------- |
| Intended stage                 |     25 | Investor stage criteria versus intended round              |
| Sector/thesis                  |     25 | Sourced investment focus versus company sector             |
| Geographic eligibility         |     20 | Supported mandate versus company geography                 |
| Individual check compatibility |     20 | Explicit investor range versus desired individual range    |
| Additional preferences         |     10 | Structured founder choices and corresponding sourced facts |

Store rubricVersion. Criterion states are match, partial, mismatch, unknown, conflict,
outdated, and not_applicable. Unselected optional preferences are not_applicable and
excluded from applicable weight. Free-text priorities remain qualitative until reviewed
into structured criteria. Missing preference evidence cannot become not_applicable.

Match = 1; mismatch = 0. Partial = 0.5 is allowed only for documented non-required
preference coverage. Stage/geography eligibility must not receive guessed partial credit.
Equal known currencies and overlapping supported check ranges match; disjoint ranges
mismatch; absent bounds/currency remain unknown.

    coverage = supported applicable weight / total applicable weight
    score = 10 * sum(supported weight * criterion result)
                 / supported applicable weight

Use Decimal.js, preserve exact components, and display score to one decimal with
ROUND_HALF_UP. Unknown/conflicting/outdated facts are not zero-valued mismatches and
do not count as supported coverage.

Show a numerical score only when identity is adequately attributed, stage and geographic
eligibility are supported, coverage is at least 70%, no applicable criterion has an
unresolved conflict, and no explicit stage/geographic exclusion applies.

Explicit exclusions show Outside stated mandate instead of a positive scored
recommendation. Other insufficient cases show Needs verification with details.
Display score, weighted evidence coverage, rubric, assessment date, source dates, unknowns,
and explanation. Coverage is not statistical confidence.

Allow a founder to shortlist an excluded/unscored investor with an explicit rationale.
The override does not rewrite facts or establish a verified match.

### Freshness and assessment lifecycle

Use semantic hashes of matching goal fields, accepted facts, identity, and rubric.
Generic profile bumps/check timestamps alone do not invalidate scores. Relevant changes
mark old assessments outdated; preserve them and append a replacement on authorized refresh.

For v1, mandate facts without explicit validity dates require review after 180 days from
retrieval. Explicit expiry takes precedence. Review-due/expired facts cannot support a
current numerical score. Missing publication dates remain visible; recent retrieval is
not independent verification. Historical investment facts remain historical at any age.
The worker records deadline-driven review expiry through one deduplicated transition.

Opening a panel reads pure saved-data projections. Persist assessments through explicit
Assess match or authorized research-result reconciliation. Neither starts additional
research implicitly. Preserve the last assessment as historical during failure/offline states.

## 6. Step 3: add target investor

Radar cards expose Review investor fit and Add to target investors; saved targets show
View target. Keep read/dismiss-update actions independent. Dismissing news does not archive
a target, and archiving a target does not delete evidence.

Save journey, investor, reviewed assessment, originating event/suggestion, founder
rationale, and preparation-scope choice.

The first target fills the default empty preparation slot. Subsequent selections show
Include in preparation plan, selected by default, with a clear extra-work notice.
Shortlisting without current preparation inclusion remains possible.

In one workspace-locked, revision-checked transaction:

1. Resolve the event/suggestion and canonical investor inside the workspace.
2. Validate reviewed assessment inputs; stale requests require refresh.
3. Create or return the unique journey/investor target.
4. Pin the assessment and founder rationale.
5. Fill/add the chosen preparation slot.
6. Prepare eligible local draft work, append the progress event, and commit together.

Enforce workspace/journey/investor uniqueness and payload-bound request receipts.
Concurrent events/clicks for the same investor return one target. Do not merge distinct
people or firms by normalized name alone. Ambiguous aliases require identity review.

Shortlisting works before story approval or financial evidence is ready. Its next action
names the missing prerequisite rather than blocking target selection.

Newly resolved investors default to paused monitoring; preserve existing schedules.
Refactor identity-resolution logic from the current Track decision so shortlisting does
not inherit automatic daily monitoring. Existing discovery/Track semantics remain available.

## 7. Step 4: prepare the tailored brief

Each target owns brief history. A brief revision pins journey/goal version, target,
assessment, approved story revision, financial snapshot, investor evidence IDs, source
manifest, creation time, fictional labels, and exact content.

Include company objective/story, why this audience appears relevant, sourced priorities
and check information, likely questions labeled as hypotheses, evidence to prepare,
unresolved gaps, and questions to ask the investor.

On shortlisting, draft locally when the required approved story exists. Otherwise preserve
the target and route to shared-story review. Do not invent facts or call a model to fill
gaps. Reuse the current deterministic preparation engine.

Saving an edit appends a revision; approval pins its exact ID/hash. A draft never inherits
approval silently. Retain legacy brief text for historical reads while new cycles use
immutable brief references.

Brief approval leads to the existing scenario source preview. Only explicit reviewed
generation queues a scenario job. Creating a brief does not start media practice.

## 8. Step 5: practise with frozen context

Reuse written submission, ScenarioService, ScenarioSources, PracticeContext, ElevenLabs,
LiveAvatar, and the existing evaluator. No provider configuration change is required.

New lineage contains journeyId, goalVersionId, targetId, assessmentId, pitchId,
briefVersionId, cycleId, scopeVersionId, and source/input hashes. Server resolution and
freshness checks occur inside session-creation transactions; client text/scores are not
authoritative context.

Each mode freezes the same reviewed context. Financial facts preserve exact values,
periods, currencies, hashes, and CSV locators. Source text is untrusted evidence, never
instructions. Simulated investor questions remain hypotheses.

Transcript authority is unchanged: accepted written answers and verified final provider
transcripts qualify; live captions do not. Navigation/start does not complete practice.
Queue evaluation once after accepted completion. Preserve partial/pending/failed states.

Replace singleton current-cycle resolution across services, PrismaStore.createGeneration,
media start guards, worker reconciliation, and historical links. Focusing another target
must not supersede an existing target's cycle. Retain workspace-wide single-active-media
limits.

## 9. Step 6: review and decide next work

    Accepted session -> Saved evaluation -> Feedback available
        -> Founder reviews -> Revision/retry decision -> Current progress updates

Show transcript-linked strengths, contradicted/unsupported claims, missing evidence,
pending comparisons, and one concrete next action. Assessment availability can produce
a history point before founder review; its review gate remains incomplete.

| Result                          | Persistent behavior                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Pending evaluation              | Preserve activity; show assessment pending                                          |
| Failed evaluation               | Preserve transcript and prior outcomes; offer retry                                 |
| Partial session                 | Retain labeled observations without passing full-session gates                      |
| Actionable feedback             | Offer source-linked revision/retry with explicit scope                              |
| Accepted revision               | Append content; reopen dependent gates; require assessed comparison for improvement |
| Rejected/dismissed proposal     | Record decision and unresolved finding; no improvement claim                        |
| Saved retry comparison improves | Record only finding-specific observed improvement                                   |
| No actionable gap               | Founder can close review and wait for input or explicit practice                    |

Feedback scope is shared company story, shared financial evidence, or target preparation.
Investor-specific wording defaults to its own target. Promoting an edit to the shared
story is an explicit founder decision. A shared edit reopens dependent brief reviews;
one investor-specific edit does not reset other tracks.

Do not average judgments across unrelated sessions into a personal speaking score.
Show claim support, saved comparisons, and checklist completion separately.

The history view includes a practice-evidence row for each assessed session: date,
target, assessed/supported/contradicted/unresolved counts, partial-session label, and
finding-specific retry outcome. Display the assessed denominator because different
sessions cover different claims. This provides actual performance history without
relabeling checkbox completion or unmatched session counts as a skill trend.

## 10. Progress graph: history, current position, planned work

### Display contract

Time is horizontal; reviewed preparation steps are vertical. Percentage is a transparent
checklist calculation, not mastery, business performance, or funding likelihood.

Render a step line for saved observations, a labeled current marker, explicit change
boundaries, and a separately styled future planning region. No smoothing or fabricated
observations between saved events.

    Reviewed steps
    100% |                                      . . planned work
         |                         +----------o
         |              +----------+          ^ current
         |       +------+                     |
       0 +-------+----------------------------+---------------- Time
             recorded history               today        estimate

This drawing is a schematic, not company/investor evidence. Actual points use saved
events only. Display the counted steps and scope alongside the chart.

### Counted steps and readiness

Goal confirmation is a prerequisite. Each scope contains one shared company-story review
step and five required steps for every included investor track:

1. Target selected with reviewed match or explicit unknown/exclusion override.
2. Exact current tailored brief approved.
3. Authoritative practice completed for that brief/cycle.
4. Completed current assessment reviewed.
5. Revision/no-gap decision recorded for that assessment.

Initialize one empty target slot so remaining work exists before investor selection.
The first target fills it without changing the denominator. Before goal confirmation,
show a preview without invented history.

    reviewed percentage = 100 * currently valid reviewed steps / required steps

Use Decimal.js, retain numerator/denominator, and display both counts and percentage.
More claims, more sessions, or higher match scores do not automatically add points.
Rejecting a proposal records a decision, not improvement.

Readiness is separate from percentage: In progress, Assessment pending, Needs review,
Reviewed with gaps, Preparation reviewed, Outdated, or Paused. Preparation reviewed
requires all current gates plus no required unresolved action. A 100% reviewed checklist
with unresolved required findings says Reviewed with gaps and names the next action.

### Scope and historical comparability

Persist scope versions when included targets/slots or required work change. Show old/new
counts and a reason. Removing a target cannot be presented as improved preparation.
Graph filtering changes display scope and label, not saved goal state.

Reopening reviews can lower current valid completion. Label New source requires review
or New practice cycle. Retain the earlier higher point and its original denominator.
Never rebase past points onto today's scope/rubric. Scope/projection changes have visible
boundaries rather than a misleading continuous trend.

### Point detail and history navigation

Selecting a point opens:

- Recorded timestamp, with optional separately labeled occurrence timestamp.
- Goal version, target scope, cycle, and projection version.
- Before/after counts and the reason for change.
- Exact story/brief versions, practice session, and evaluation.
- Supporting sources, fictional labels, unresolved findings, and applicable assumptions.
- Read-only links to historical artifacts and transcript passages.

Provide goal-wide/target/date filters, cursor pagination, and an accessible chronological
table with the same events. Inspecting history never changes current focus or applies an
old revision to a current brief.

Late evaluations are recorded when received, with practice occurrence shown separately.
They affect current completion only when lineage still matches. Archived-target results
never advance a different target or silently reactivate scope.

### Durable history

Append an immutable event plus compact resulting-position snapshot for meaningful
committed changes: goal/scope confirmation, target selection/archive, content approval,
authoritative practice completion, assessment availability/failure, feedback review,
outcome decision, saved improvement comparison, and relevant source invalidation.

Include stable sequence, origin key, reason code, linked IDs, recordedAt, optional
occurredAt, scopeVersionId, projectionVersion, and resulting step/status counts.
Ordinary domain records remain authoritative for current state. The history ledger is
not a full event-sourcing rewrite; do not duplicate transcripts or reports into it.

Write history transactionally with the originating state change. Deduplicate by origin ID,
event kind, and originating revision/attempt where applicable; assessment availability,
failure, and founder review for one evaluation are distinct events. Unchanged ticks,
polls, page opens, or temporary what-if
controls produce no points. Expiry uses a deduplicated worker transition; reads stay pure.

At rollout capture Current baseline from existing saved records at the capture time.
Retain access to old artifacts without fabricating past graph points, historical scores,
or a measured starting position before tracking existed.

## 11. Remaining-work schedule and next action

Extend PreparationScheduleModel; do not derive dates from match scores, session counts,
or invented improvement velocity. Shared company work counts once. Add per-included-target
brief/practice/review work and named retry tasks with editable estimates.

Suggested defaults can carry forward: 2 hours/day, 2 hours shared story, 2 hours shared
investor review/selection, and per-track 2 hours brief plus 4 hours practice/feedback.
All remain labeled template estimates. Selection effort is shared unless explicitly
expanded. Retries are deduplicated estimated tasks, not another full session assumed
on every tick.

Use sequential calendar-day capacity, IANA timezone, exact effort arithmetic, and
fractional-day rounding. Required external delivery follows saved dependencies.
Missing/overdue delivery yields a work-only estimate excluding waiting. Stale prerequisites
suppress readiness claims and explain review requirements. Preserve historical forecasts
with their own scope and assumption versions.

Faster/slower controls stay temporary unless saved. Planned future marks represent
estimated task completion, never predicted personal skill or investment success.
If no estimated work remains but required evidence/assessment is pending, say Awaiting
review/evidence rather than claiming a readiness date.

One pure server projection supplies the graph, target rows, checklist, and next action.
Priority is blocking stale/failed required work, shared-story review, missing investor
selection, focused target's brief, scenario/practice, assessment/review, revision/retry,
then waiting for new inputs after completed review. Respect founder focus and show the
reason. A running job may yield an available action on another included track, never a
duplicate job. Return one primary action and at most two secondary actions.

## 12. Storage, contracts, transactions

Use strict TypeScript/Zod and Prisma-only persistence. Proposed focused records:

| Record                  | Fields and invariants                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| GoalJourney             | workspace, stable ID, current goal-version reference, status, revision                                   |
| InvestorMatchAssessment | journey/goal version, investor, source manifest, criteria, score/coverage, rubric, timestamps; immutable |
| GoalInvestorTarget      | workspace/journey/investor uniqueness, reviewed assessment, rationale, state, revision                   |
| GoalPreparationScope    | immutable included target/empty-slot IDs, step definitions, estimate/dependency references, version      |
| GoalProgressEvent       | journey sequence, origin key, linked IDs, reason, compact position snapshot; append-only                 |

Existing goal versions, pitches, cycles, and approvals may remain in the validated
preparation aggregate for this increment. Add journey/target references and immutable
connected brief versions there. Contact/CRM tables are outside this scope.

New contract modules: GoalJourney.ts, InvestorMatch.ts, InvestorTargets.ts, GoalProgress.ts.
Extend ConnectedPreparation.ts, FundraisingPreparation.ts, PracticeContext.ts, Scenario.ts,
and existing projections with versioned optional lineage. Do not default absent historical
hash-input fields, which would change old hashes.

Keep target membership (active/archived), preparation inclusion (in/out of scope), and
per-step workflow state separate. Workflow state uses blocked, ready, running, needs_review,
complete, failed, and outdated with a reason. Archiving does not convert failed or
unreviewed work to complete.

Add a journey transaction/store port and extend the existing workspace transaction boundary.
Target/cycle changes, revisions, relevant queue intent, and history append commit together.
Lock workspace before feature/job rows consistently. No nested independent service writes.
Provider calls stay outside transactions; publication rechecks input hashes, revisions,
target/cycle identity, and current unexpired job lease.

Current views derive from coherent state. Include journeyRevision and projectionVersion
in graph/target/preparation responses. Do not combine contradictory revisions into one
current display.

## 13. Proposed API and workflow ownership

These routes are planned, not currently available.

| Route                                                  | Behavior                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| GET /api/goal-journeys/current                         | Active goal, scope, target summaries, position, next action  |
| POST /api/goal-journeys/commands                       | Create/revise/archive goal; save scope/assumptions           |
| GET /api/goal-journeys/:id/investor-matches            | Paginated saved match summaries                              |
| POST /api/goal-journeys/:id/investor-matches           | Explicit saved-fact assessment; no implicit research         |
| POST /api/goal-journeys/:id/targets                    | Atomic event/suggestion/investor shortlisting                |
| GET /api/goal-journeys/:id/targets                     | Paginated target rows and scope inclusion                    |
| GET /api/goal-journeys/:id/targets/:targetId           | Current track, assessment, bounded history                   |
| POST /api/goal-journeys/:id/targets/:targetId/commands | Rationale, reviewed assessment, include/archive/resume       |
| GET /api/goal-journeys/:id/progress                    | Position, gate counts, assumptions, next action              |
| GET /api/goal-journeys/:id/progress/events             | Cursor history, target/date filters, fixed sequence boundary |
| GET /api/goal-journeys/:id/progress/events/:eventId    | Exact historical snapshot and links                          |

Extend preparation-loop commands/scenario endpoints with explicit target/cycle resolution.
Reuse brief approval and existing research/evaluation/retry/media routes. Preserve
historical URLs through compatibility resolution.

Mutations require validated payloads, expected revision, request key, and owned references.
Use 409 for stale/conflicting commands, 404 for unavailable/non-owned records, and existing
validation/rate-limit behavior. Same-key/same-payload replay returns the original result
even if current inputs changed; changed payloads cannot reuse keys.

Reads are private/no-store and bounded. They perform no research, inference, session
creation, history write, or content approval. Chart summaries disclose omitted data and
link to exact paginated events; no silent daily interpolation.

### Complete handoff sequence

1. Confirm the goal: append its version/scope/baseline and return journey identity.
2. Open Radar: read saved news and match state for that journey; no provider call.
3. Assess match: freeze current supported facts and rubric into an assessment.
4. Add target: bind the reviewed assessment and source event, create/reuse the target,
   fill/update scope, record progress, and return the exact next action.
5. Review shared story if needed: save/approve an exact revision, then draft the target brief.
6. Approve the target brief: pin its revision; return the scenario-input review action.
7. Generate after source review: atomically bind the generation/job to that target cycle.
8. Practise explicitly: freeze lineage, accept final transcript, queue evaluation, and
   record practice completion without marking feedback reviewed.
9. Publish evaluation: commit its report/job result and assessment-availability event
   under the existing lease guard; prepare eligible proposals from saved coaching.
10. Review and decide: save feedback review, then append accepted/rejected/no-gap outcome;
    update affected gates and history in the same command transaction.
11. Refresh Overview: the same journey revision updates the current graph marker,
    target row, remaining-work estimate, and primary action. Historical point details
    still resolve the exact older revisions.

Automatic proposal drafting retains the existing saved opt-in and pause behavior.
Assessment/history publication remains truthful when drafting is paused. A paused
drafting worker does not turn a completed evaluation into a missing historical result.
The source record remains inspectable if downstream reconciliation is unavailable.

## 14. Change propagation

| Change                        | Match                                  | Brief/practice           | Goal graph                          |
| ----------------------------- | -------------------------------------- | ------------------------ | ----------------------------------- |
| Matching goal fields          | Reassess affected criteria             | Review dependent content | Goal-version boundary               |
| Goal wording only             | Preserve if semantic inputs unchanged  | Review changed text only | Edit point, no invented improvement |
| Availability/effort           | Preserve                               | Preserve approvals       | New forecast assumptions only       |
| Focus another target          | Preserve all tracks                    | Resume that track        | Filter/focus only                   |
| Add included target           | Assess separately                      | Prepare its track        | Scope boundary/new denominator      |
| Archive/remove target         | Preserve history                       | Historical read access   | Scope boundary, not improvement     |
| Investor-specific evidence    | Reassess that investor                 | Reopen affected track    | Explain invalidation                |
| Shared story/financial source | Match only if own inputs change        | Reopen dependent content | Explain current decrease            |
| Practice feedback             | Preserve match                         | Originating cycle only   | Assessment availability/status      |
| Accepted revision             | Preserve unless matching inputs change | New revision/reviews     | Decision, not improvement           |
| Saved comparison improves     | Preserve                               | Compared finding only    | Improvement detail beside checklist |
| Unchanged check/poll          | Preserve                               | Preserve                 | No point                            |

Notification settings, read/dismiss state, heartbeat timestamps, and unrelated investor
research must not invalidate the goal's prepared content.

## 15. Failures, accessibility, operating boundaries

Handle no goal, incomplete company context, no sources, insufficient coverage, ambiguous
identity, exclusion, stale assessment, duplicate target, missing story/evidence, draft
review, generation failure, awaiting transcript, partial practice, failed evaluation,
archived target, worker offline, and stale network view. Show reason and recovery action.

Reuse visibility-aware serialized polling. Preserve open edits and selected historical
points. On failed refresh retain prior state with a stale label. Announce meaningful
changes without stealing focus. Multiple tabs conflict instead of overwriting newer work.

Graph points support keyboard selection, accessible axes/legend, non-color status,
chronological table, reduced motion, and mobile detail/source inspection. History navigation
does not start audio playback.

Retain loopback local binding, workspace access checks, CSRF/origin controls, body/rate
limits, safe logs, secrets, and provider receipt verification. The configured public demo
is shared; fictional demo evidence is labeled throughout. Private correspondence requires
authenticated workspace access; hosted configuration changes remain a separate request.

Exclude automated investor outreach, contact enrichment, invented introduction networks,
valuation, funding probabilities, financial forecasts, new notifications/providers,
credential/configuration changes, deployment, pushing, and paid live validation.

## 16. Migration and compatibility

1. Add journey/match/target/scope/progress tables with workspace-scoped constraints/indexes.
2. Wrap the current saved goal in one stable journey, retaining its existing ID as the
   goal-version reference. Do not rewrite historical records.
3. Associate older goals only through explicit saved lineage; no grouping by name/time.
4. Map existing active cycles only when saved goal/investor links establish ownership.
   Ambiguous cycles remain read-only legacy history.
5. Capture a current baseline, never hypothetical historical scores or graph positions.
6. Preserve legacy readers and absent optional fields in old hashes.
7. Update every singleton-cycle lookup/transaction guard before enabling multi-target writes.
8. Verify unchanged record counts, payload hashes, financials, transcripts, and deep links.

Migration is idempotent. Use a capability/version gate to enable the complete vertical
flow only after all consumers support target lineage. Rollback disables new commands
and retains new records; never drop history or force it into legacy payloads.

## 17. Implementation packages

| Package                     | Main owners                                                             | Exit gate                                                 |
| --------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| A. Journey/track foundation | GoalJourney/store, PreparationIntent, ConnectedPreparation, PrismaStore | Stable identity, independent cycles, compatible history   |
| B. Match assessment         | InvestorMatch, Research adapter, fit/recommendation projection          | Explainable score, coverage, provenance, expiry/exclusion |
| C. Radar and brief          | RadarUpdates, target views, discovery resolution, brief revisions       | Atomic shortlist and exact brief handoff                  |
| D. Practice and feedback    | Scenario sources/service, media guards, evaluator, worker               | Every result returns to its originating track             |
| E. Progress history         | GoalProgress/store/projection, graph/detail/table, schedule             | Durable history, current marker, scoped remaining work    |
| F. Integration              | Migration, compatibility, fixtures, documentation                       | Full flow, two-target isolation, failure/retry, integrity |

Build the smallest complete path through all packages before secondary polish. Use
written practice and existing test doubles for the first vertical test, then verify
media lineage with adapter fixtures without paid sessions. Track actual delivery in the
checklist; do not mark this specification as shipped.

## 18. Acceptance and validation

Required scenarios:

- Full journey: goal, sourced match, target, approved brief, scenario, written practice,
  completed assessment, founder review, updated graph, and exact historical drill-down.
- Two investors under one goal without focus/feedback superseding another track.
- Unknown/conflicting facts, currency mismatch, exclusion, coverage threshold, expired
  mandate, same-name identity, and explicit shortlist override.
- Concurrent shortlisting, request replay, stale approvals, sources changing during
  generation, expired leases, late results for old/archived cycles.
- Shared edits reopen dependent briefs; target-specific edits remain isolated.
- Reject/dismiss preserves gaps; only saved comparisons establish observed improvement.
- Scope boundaries retain old denominators; reopened sources explain lower current
  completion; no poll duplicates, invented history, or false smoothing.
- Migration keeps old hashes/records/links and does not guess goal association.
- Offline/paused worker, failed evaluation/retry, refresh/resume, browser navigation,
  keyboard/mobile graph access, and no provider work from reads.

Suggested meaningful test ownership:

| Test owner                                               | Coverage                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| New GoalJourney.test.ts                                  | Stable identity, version changes, scope membership, independent tracks                            |
| New InvestorMatch.test.ts; existing InvestorFit.test.ts  | Rubric, exact range arithmetic, provenance, coverage/conflict/expiry rules                        |
| Existing InvestorTracking.test.ts; RadarDelivery.test.ts | Identity resolution, paused shortlisting, event links, no changed notification behavior           |
| Existing ConnectedPreparation.test.ts; Scenario.test.ts  | Brief lineage, target-aware cycle guards, source changes, retries                                 |
| New GoalProgress.test.ts                                 | Gate counts, event deduplication, late results, current projection, historical denominators       |
| New GoalProgressChart.test.tsx                           | Point/table parity, keyboard/mobile detail, scope boundaries, no invented data                    |
| Existing PreparationSchedule.test.tsx                    | Shared/per-target effort, retry work, dates, timezone, provisional states                         |
| Existing Integration.test.ts                             | Real Fastify/Prisma full flow, concurrency, migration, transaction rollback, two-target isolation |

Feature queries are scoped to workspace/journey and paginated in the database for new
history tables. Use a fixed upper sequence for each history pagination session, so new
events cannot shift earlier pages. A compact overview does not fetch full transcripts,
research archives, or every event. If chart window limits are reached, disclose the
limit and offer narrower dates/more history instead of silently dropping scope boundaries.

Operational diagnostics record safe IDs, event kind, projection/rubric version, conflict
category, duration, and failure stage. Do not log source text, financials, transcript,
private rationale, or credentials. Inspect consistency by comparing latest saved event
counts with a pure current projection; repair through an explicit new reconciliation
event, never by rewriting historical snapshots.

After all application edits run pnpm lint, pnpm format:check, pnpm typecheck, pnpm test,
pnpm build, and pnpm test:integration. Integration uses the existing uniquely named
disposable database, never a reset of the application database. Before any later commit,
run the repository-required dependency audit and review the diff.

This documentation-only change requires Markdown formatting, local link/integrity review,
and confirmation of no application/database/provider/deployment changes. Application
delivery gates stay unchecked until implementation is explicitly requested.

## 19. Related specifications and precedence

- [Existing connected pitch plan](ConnectedPitchEngineeringPlan.md) and
  [delivered checklist](ConnectedPitchImplementationChecklist.md).
- [Original fundraising preparation design](FundraisingPreparationEngineeringSpec.md).
- [Radar result delivery](InvestorRadarEngineeringSpec.md).
- [Investor preparation](InvestorPreparationPlan.md),
  [scenario generation](ScenarioGenerationPlan.md), and
  [evaluation workflow](EvaluatorWorkflowPlan.md).

For the next release this specification governs goal-led multi-target flow, match scoring,
and the persistent progress-history graph. It does not relabel those features as already
implemented or replace source code as the current-behavior reference.
