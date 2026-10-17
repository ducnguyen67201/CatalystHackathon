# Investor Readiness Pack: Engineering Plan

Status: draft engineering plan, not implemented. Baseline inspected: origin/main
`da052bd32552c3dc677363020041f998f3030ae4` (PR #28). Its source tree matches
this workspace's HEAD; no merge is needed to reuse it.

## Outcome

A founder can inspect a deck claim, see the financial evidence and calculation,
practise defending it with a selected investor type, review an independent check,
and approve a corrected pitch. Optional outreach prepares a draft from that approved
version. The existing preparation timeline stays above the six-step checklist.

Do not add a second disconnected progress system or equate approval with correctness.

## The system in one picture

```text
FOUNDER INPUTS                       EXISTING RECORDS
Financial CSV bundle + deck claims   Goal + investor research + practice history
                  |                              |
                  v                              v
         Validate and save immutable, attributed source versions
                                |
                                v
              Metric calculator + forecast scenario engine
              (TypeScript / Decimal, not model arithmetic)
                                |
                                v
              Claim checks + proposed preparation pack
                                |
               Select investor + simulation archetype
                                |
                                v
                    Approve tailored brief
                                |
                                v
             Existing scenario generation + practice room
                                |
                                v
           Saved transcript -> answer assessment -> pack review
                                |
                                v
                  Review proposed pitch changes
                     /                    \
             Edit / practise again       Approve current reviewed version
                     |                    |
                     +---- new version ---+---> Optional outreach draft

       Every saved change -> same timeline and next-action projection
       Earlier data, sessions, reviews and pitch versions remain in history
```

## First release boundaries

Build one preparation pack per selected source set, investor and simulation profile.
The first release supports the supplied ten CSV formats, pasted deck claims and text-based
PDF decks with page references. Scanned decks need pasted text until OCR is implemented.
Do not execute spreadsheet formulas. A workbook adapter can follow the CSV import path;
CSV support is sufficient to load all ten tables without a new spreadsheet engine.

Ship nine challenger claim categories, five simulation profiles, forecast comparison,
independent review, a revision diff and a downloadable outreach draft/print view.
Actual email delivery and print fulfillment remain outside this release. Do not introduce
a funding-probability score, valuation recommendation or automatic investor contact.

## How it appears

```text
OVERVIEW
+---------------------------------------------------------------------+
| Your preparation timeline: current work, target, planned / +/-25% pace|
| Current blocker: review unsupported retention claim                   |
+---------------------------------------------------------------------+
| INVESTOR READINESS PACK                          [Open preparation]  |
| Evidence coverage | Claims needing fixes | Audit state | Pack version |
| Top 3 investor questions | Next action | Last checked source version  |
+---------------------------------------------------------------------+
| Existing six-step checklist, linked to this same pack                 |
+---------------------------------------------------------------------+

PACK DETAILS
[Evidence] [Claims] [Forecast] [Practice] [Review & revisions]

Claim                    Evidence / calculation       Review action
"$1.37M ARR"             MRR x 12, excluding fees      [Inspect & revise]
"1% monthly churn"       Customer cohort calculation   [Inspect & revise]
"24 months of runway"    Selected cash scenario        [Compare scenarios]

Claim detail: exact quotation + slide/page -> original evidence rows
              -> formula, period, unit -> status -> proposed wording
```

Examples illustrate the challenger case, not results already calculated by the app.
Display supported, contradicted, ambiguous, missing evidence and not checked as distinct
states. Do not invent totals or imply a readiness percentage.

Use existing Financials for imported evidence, Practice scenario for interviews, and
Meeting brief for the approved pack summary. The investor profile gains the same
`Prepare outreach` action after an explicit readiness decision. No new sidebar is needed.

## Reuse main

| Existing surface                                                             | Extension                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Financials.ts`, immutable Prisma snapshots and source rows                  | Typed imports for the remaining financial tables; preserve the existing P&L importer |
| `EvaluationContextAssembler.ts`, metric facts and Decimal checks             | A shared calculated metric registry used by deck checks and transcript checks        |
| `ConnectedPreparationService.ts`, pitch revisions, cycles and source hashes  | Pin the exact pack version to approvals, scenarios and revision decisions            |
| `ScenarioSources.ts`, `ScenarioPrompt.ts`, saved practice context            | Add explicitly labeled investor archetype, checked claims and forecast assumptions   |
| `EvaluationOrchestrator.ts`, checkpoints and worker lease fences             | A separate, durable pack-review workflow; existing answer review remains useful      |
| `PreparationPlanner.ts`, `PreparationScheduleModel.ts`, recommendation basis | Project new blockers and remaining work into the existing graph and next action      |
| Existing report, evidence drawers and Meeting briefs                         | Inspectable claim table, audit findings and before/after pitch                       |

Current scenario intake explicitly marks forecasts unsupported. Current claim checks skip
forecast and hypothetical claims. Extend those boundaries deliberately; never compare a
forecast value to an actual as if the difference proves a false statement.

## Integrate with the six steps

1. **Review evidence and story:** import financial tables, capture deck claims, calculate
   metrics, inspect contradictions and approve wording. Missing sources stay visible.
2. **Select investor and practice profile:** keep real saved research separate from one
   of the five labeled simulation archetypes: seed lead, angel operator, strategic,
   government-backed and skeptical partner. The selected archetype changes question
   depth and the evaluation criteria; it does not impersonate a real investor.
3. **Approve tailored brief:** highlight the top three questions, evidence-backed
   strengths, unresolved gaps and the chosen forecast scenario. Freeze the pack version.
4. **Practise:** reuse written, voice and video paths. Carry source IDs, profile and pack
   version into the frozen interviewer/evaluator context. Never start paid sessions on reads.
5. **Review assessment and independent findings:** show answer coaching beside a separate
   review of calculations, citations, assumptions and misleading wording. Failed/pending
   review is not completion. The reviewer can return the pack for revision.
6. **Revise and decide next action:** preserve the original and append the approved pitch
   version. Choose practice again or explicitly prepare investor outreach. Record unresolved
   risks; never treat accepting wording as evidence that a financial gap was resolved.

An accepted wording revision need not restart every completed task. Reopen only tasks whose
inputs changed, preserving the earlier cycle, evidence, practice and review history.

## Data and calculations

Import the challenger's ten tables as one versioned financial bundle: P&L, balance sheet,
cash flow, MRR bridge, customers, customer-month seats, actual headcount, forecast,
assumptions and hiring plan. Use per-table Zod validation, bounded upload sizes, explicit
actual/forecast labels, original row references, hashes and cross-table reconciliation.
Keep monetary calculations in Decimal. Do not silently relabel older currency-unknown
snapshots; the supplied challenger case identifies its new bundle as CAD and fictional.

Calculate recurring ARR, growth over specified windows, booked versus support-adjusted
margin, logo churn, cohort NRR/GRR, fully loaded CAC/payback, concentration, burn multiple
and cash runway only when each metric's required inputs exist. Return formula, source rows,
period, units, rounding and coverage with every value. Missing channel or pipeline data is
not inferred. Founder claims never become verified evidence merely through approval.

Keep the original forecast immutable. Save named copies with changed drivers: AE ramp,
churn, price timing, customer renewal and round-close timing. Include working capital and
credit timing where the sources support them. Show a cash balance chart and explain model
coverage. Do not extrapolate beyond the supplied horizon without an explicit assumption.

The preparation +/-25% pace chart measures founder work. The cash scenario chart measures
company liquidity under business assumptions. Display them separately with clear labels.

## Independent review and persistence

Use additive Prisma records for financial bundles, deck/claim versions, readiness packs,
cash scenarios and review runs. Keep large tables out of `/api/state` and the workspace
aggregate; provide bounded, workspace-scoped routes. Store validated immutable payloads
with source/version hashes. Optional versioned references preserve historic sessions.

The independent reviewer consumes frozen original evidence, metric results, claim checks
and the proposed pack. It does not trust the drafter's prose as a source. Recompute
calculation checks through a separately invoked validator and run a distinct critique pass
for unsupported conclusions. Use the existing job queue, explicit generation commands,
checkpointing and lease-fenced publication. A separate pass is not a guarantee of accuracy.

Any new source invalidates dependent checks and approvals, not historical snapshots.
Source/pack versions must still match when approving a brief, starting practice or preparing
an outreach draft. Pack review failures retain the last completed version and retry explicitly.

## Runtime: what happens after each click

| Founder action             | Server work                                                                                                          | What appears next                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Upload financial tables    | Validate each file, save original rows and hashes, reconcile related tables, calculate coverage                      | Evidence inventory with accepted, invalid and missing tables    |
| Add or confirm deck claims | Save exact quote, document/page or pasted-text location, period/unit when present                                    | Editable claims waiting for checks                              |
| Check claims               | Pin source versions, calculate metrics, run deterministic comparisons; queue bounded narrative drafting if requested | Claim table with source-backed findings and missing inputs      |
| Compare forecast scenario  | Save driver overrides on a copy; calculate monthly revenue, costs and cash within the modeled horizon                | Base-versus-scenario cash chart and changed assumptions         |
| Prepare investor brief     | Pin investor sources, archetype, claim checks and selected forecast scenario                                         | Three likely questions, evidence and explicit gaps              |
| Generate practice          | Use the existing reviewed-input preview and scenario job                                                             | Existing written/voice/video exercise with pinned pack context  |
| Finish practice            | Save transcript through the existing accepted-text/provider-receipt rules; queue the existing assessment             | Pending, failed or completed answer review                      |
| Review preparation         | Queue a separate pack-review job over original sources, calculations, candidate wording and assessment               | Independent findings, coverage and required corrections         |
| Approve revision           | Verify the exact reviewed content hash and current inputs; atomically append pitch version and decision              | Previous cycle recorded; next relevant action appears           |
| Prepare outreach           | Verify the chosen investor, reviewed pitch version and explicit unresolved-risk decisions; save a draft              | Message, one-pager, links and printable view for founder review |

Opening a page only reads state. Expensive drafting, review and session creation use explicit
commands. Background local reconciliation updates status and dependencies without launching
new paid work. No duplicate job is created for an unchanged command/input hash.

## Storage contract

Proposed new Prisma records use the current workspace foreign key and immutable JSON payloads
validated by Zod. Use focused queries and cursor pagination rather than loading full tables
with every workspace read.

| Record                 | Required contents                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| FinancialBundle        | ID, workspace ID, version, currency, provenance, table snapshot IDs, content hash, coverage and reconciliation results             |
| FinancialTableSnapshot | Table kind, actual/forecast classification, original filename, row numbers, parsed rows, source hash and import time               |
| PitchDocumentVersion   | Original extracted/pasted text, page references, source hash and parent version                                                    |
| ReadinessPackVersion   | Bundle/document/profile/goal/investor hashes, metric and claim results, selected cash scenario, candidate pitch and parent version |
| CashScenario           | Base bundle ID, named overrides, calculation version, monthly outputs, limitations and source references                           |
| ReadinessReview        | Pack ID, exact candidate hash, transcript/evaluation IDs where applicable, reviewer version, findings, coverage and job status     |
| OutreachDraft          | Investor ID, reviewed pack/pitch IDs, founder-supplied recipient if any, draft contents and version                                |

Keep a small optional pack-version reference on connected cycles and scenario context.
Add a versioned context variant for pack-backed sessions; preserve parsing and hash behavior
for older sessions. Legacy practice records without a pack must not acquire new facts or
retroactively require an audit they never had.

Source lineage is explicit:

```text
CSV snapshot + row -> metric + formula -> claim result
                        -> pack version -> approved brief -> scenario -> session
                        -> independent review -> approved pitch -> outreach draft
```

Each approval pins exact content, not only a mutable record ID. A metadata-only timestamp
change does not invalidate approvals; changed financial inputs, claims or investor sources do.

## Proposed APIs and jobs

These are proposed endpoints, not endpoints that currently exist. Extend the existing Fastify
authorization/session/origin and private/no-store conventions. Validate every body with Zod;
derive workspace identity server-side. Mutations use expected versions and idempotency keys.

| Endpoint                                        | Purpose                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /api/financial-bundles`                   | Import and reconcile a bounded batch of supported CSV tables                                       |
| `GET /api/financial-bundles/:id`                | Read coverage, table inventory and source hashes                                                   |
| `GET /api/financial-bundles/:id/tables/:kind`   | Page through original attributed rows                                                              |
| `POST /api/readiness-packs`                     | Create a candidate from explicit bundle, claims and investor/profile selection                     |
| `GET /api/readiness-packs/:id`                  | Read a bounded pack projection and latest review state                                             |
| `POST /api/readiness-packs/:id/commands`        | Check claims, draft/revise, request review, acknowledge findings or approve exact reviewed wording |
| `POST /api/readiness-packs/:id/cash-scenarios`  | Create an immutable scenario copy with validated driver overrides                                  |
| `POST /api/readiness-packs/:id/outreach-drafts` | Prepare a draft from the selected approved pitch; no external send                                 |

Reuse `/api/preparation-loop/*` for scenario preview, generation and written practice.
Do not build a parallel interview/session service. Proposed jobs `readiness-draft:<id>` and
`readiness-review:<id>` use the existing worker, durable checkpoints, lease token and retry
rules. Heavy import work can use a separate bounded job if profiling justifies it.

Persist the command receipt, new pack version and job intent in one transaction. Publication
must verify the worker lease and pinned source hash. If inputs changed, retain the result as
historical and mark it superseded; never publish it as the current reviewed pack.

## Claim and review rules

A metric result carries its metric key, definition version, exact decimal value, unit,
period/cohort, formula inputs, source row references and rounding rule. Separate recurring
revenue from one-time fees, booked from support-adjusted margin and cash burn from losses.
Retention and CAC use declared cohort/window definitions; definitions cannot change silently.

A claim result preserves the founder's exact words. Extracting a claim is not verifying it.
Compare only matching metric definitions, units and periods. Treat missing period/unit as
ambiguous. Approximate deck figures use an explicit display-precision tolerance; do not relax
the existing transcript checker's exact-value contract globally.

Forecast claims receive driver-consistency and scenario checks, not historical equality
checks. A verbal customer expansion remains an assumption. Market-size claims require public
source evidence or stay unsupported. Never manufacture pipeline, renewal or competitor facts.

Independent review runs after a candidate exists, before final approval. It checks source
references, recomputes financial results from original inputs and critiques unsupported
conclusions in a distinct pass. The existing peer/investor assessment is reused as context,
but is not presented as a complete independent financial audit.

```text
Candidate v1 -> Review queued -> Review running
                                  |
               +------------------+------------------+
               |                  |                  |
             Failed          Changes needed      Reviewed candidate
               |                  |                  |
             Retry          Candidate v2          Founder decision
                                  |                  |
                            Review again        Approved pitch version
```

If the founder edits wording after review, its hash changes and the edit needs review again.
Critical numerical contradictions cannot be resolved by clicking accept: correct/remove the
claim or supply evidence. Other limitations can be explicitly disclosed in the approved pack.
Completion means reviewed preparation within stated coverage, not guaranteed funding readiness.

## How the graph updates

Use saved pack/cycle state in `PreparationPlanner.ts`; keep `PreparationScheduleModel.ts`
as a deterministic projection. Add pack dependencies to the existing manifest and expose
the same next action to the graph, recommendation panel and checklist.

| Saved event                              | Graph effect                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Financial tables accepted                | Evidence coverage improves; dependent checking work becomes available        |
| Claim check completes                    | Show actual unresolved claims and the next inspect/fix task                  |
| Brief approved                           | Investor preparation work is reviewed; practice becomes available            |
| Practice transcript/assessment completes | Practice is recorded; feedback and pack review become current work           |
| Reviewer requests changes                | Add a visible revision task with its estimated remaining effort              |
| Exact reviewed revision approved         | Retain earlier cycle completion and move to the chosen next workflow         |
| New evidence arrives                     | Mark dependent results stale; preserve unrelated completed tasks and history |

Do not reduce remaining effort by a fixed amount per cycle. A completed cycle can reveal more
work. Add or update explicit remaining-work assumptions; show their basis and let the founder
edit them. Apply +/-25% to work capacity, not to revenue, investor response times or available
cash. Separate confirmed dates from provisional estimates and external waiting.

Show the current cycle and cumulative reviewed-cycle count together. When accepting changes
starts another cycle, show: `Revision saved. Previous cycle completed. Next: ...` rather than
leaving the founder to infer why a checklist appears incomplete again.

## Implementation files

New owned files use PascalCase. Suggested module boundaries:

```text
src/contracts/FinancialBundle.ts       Typed table and reconciliation contracts
src/contracts/InvestorReadiness.ts     Pack, claims, audit and command contracts
src/features/FinancialBundleService.ts Immutable import and coverage
src/features/FinancialMetricRegistry.ts Deterministic metric definitions
src/features/ForecastScenarioEngine.ts  Monthly scenario calculation
src/features/DeckClaimChecks.ts         Evidence-backed deck comparisons
src/features/ReadinessPackService.ts    Versions, commands and dependencies
src/features/ReadinessReviewWorkflow.ts Separate review and validation
src/server/ReadinessRoutes.ts           Bounded private API
src/web/InvestorReadinessPack.tsx       Summary and linked detail panels
src/web/DeckClaimsTable.tsx             Claim comparison and evidence actions
src/web/ForecastScenarioChart.tsx       Base/scenario cash chart
src/web/ReadinessRevisionDiff.tsx       Original versus proposed wording
```

Reuse source-location contracts and report components where compatible. Do not force deck
page references into CSV row contracts. Keep extraction/provider adapters separate from
calculators so deterministic logic is testable without paid calls.

## Shipping order and acceptance

1. Bundle intake + deterministic metric registry + coverage screen. Verify reconciliation,
   duplicate imports, explicit currency and actual/forecast separation.
2. Editable deck claim intake with exact slide/page provenance; bounded PDF text extraction
   and pasted claims are enough initially. Verify quotes, unsupported/ambiguous claims,
   approximate-value tolerances and the nine worked deck examples where data permits.
3. Forecast copies and cash chart. Verify delayed close, annual-plan renewal timing,
   AE ramp, support-adjusted margin and missing working-capital disclosures.
4. Five practice archetypes using the existing scenario path. Verify different question
   priorities and assessment criteria against the same underlying facts.
5. Independent pack review, revision diff and graph updates. Verify stale-input rejection,
   failed-review retry, unchanged-input idempotency and retained prior cycles.
6. Optional outreach draft + printable one-pager referencing the approved pack. Defer actual
   email delivery, physical fulfillment and paid integrations. Never auto-send on cycle completion.

Run all repository validation gates after implementation. Browser-test one complete case:
unsupported ARR -> evidence -> corrected wording -> skeptical follow-up -> independent
review -> approved revision -> updated timeline -> outreach draft.

## Available inputs and demo

Only the P&L CSV was located in this repository and the supplied Downloads files during
this review. The supplied 37-page PDF summarizes the other tables; its rounded summaries
cannot replace full monthly/cohort data. Obtain the full `tidewell_data_pack.xlsx` or the
remaining CSVs before claiming complete financial coverage. Appendix J's 30 tests are
referenced by the PDF but are not present in these 37 pages.

For the first demo, show one claim end to end rather than navigating every screen:

```text
"Our ARR is $1.37M"
  -> inspect recurring versus one-time revenue and the MRR x 12 formula
  -> prepare the corrected explanation
  -> answer a seed investor's follow-up
  -> see the independent review and exact source evidence
  -> approve a new pitch version
  -> graph updates remaining work; investor outreach draft becomes an explicit choice
```

Distinguish the challenger's worked expected answers from fresh calculated results.
Label fictional evidence and fixture-generated demos. Prove live provider behavior separately.
