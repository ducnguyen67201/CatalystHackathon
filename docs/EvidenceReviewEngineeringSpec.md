# Excel evidence review engineering spec

Status: release 1 implemented; native Excel ingestion remains proposed.
Date: October 17, 2026.
Design reference: [interactive HTML mockup](previews/EvidenceReviewPreview.html).
All workbook values, cells and transcript examples in the mockup are fictional.

Implementation note: the typed projection and selected-review API, embedded CSV-backed
sheet, linked transcript previews, comparison inspector and review-version selection now
follow the release 1 boundary below. New contexts retain optional structured CSV locations;
older contexts are read without inserting defaults or changing their hashes. Existing
checks and coaching are reused. No native workbook ingestion or spreadsheet editing is added.

## Outcome and release boundary

After a practice interview, the founder can select a financial claim, see what the
saved evidence supports, inspect highlighted cells in an embedded Excel-style
sheet, and prepare a stronger answer. The sheet remains visible beneath the
transcript. Recommendations explain the evidence without changing it.

Ship this as an extension of the existing post-practice evaluator, shared by voice
and video. Browsing the review, hovering a claim, selecting a cell and switching
views read saved data without starting research, an interview or another evaluation.

The first release renders the already-frozen CSV financial evidence in an
Excel-style HTML grid. Its displayed coordinates belong to the review layout;
source citations retain the original filename, CSV row and column key. Native
Excel import follows separately and cites actual workbook cells. The mockup's
`TidewellFinancials.xlsx` is an authored fictional workbook, not an existing import.

Included in release 1:

- Embedded, read-only financial sheet with column letters, row numbers, periods,
  a formula/details bar and highlighted supporting cells.
- Exact transcript quote highlights, hover/focus evidence previews, click/tap
  selection and navigation in both directions.
- Claimed-versus-source comparison, available month-over-month differences, and
  source-backed coaching using the saved report.
- Existing clarification, dismissal and written-practice actions, with history.

Deferred: native `.xlsx` import, editing spreadsheets, exporting annotated workbooks,
comparing separate uploads, and authoritative claim checking during a live call.
During a live call, a future source browser may show frozen evidence, but final
review still waits for an authoritative saved transcript.

## Current foundation

| Component                       | Existing capability                                                             | Required addition                                        |
| ------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Financials.ts`                 | Fixed CSV schema, reconciliation, raw columns, original row numbers, Decimal.js | Reuse metric mapping and values                          |
| `EvaluationContextAssembler.ts` | Frozen selected sources and metric facts; latest twelve periods                 | Typed financial view assembled from these frozen sources |
| `RehearsalEvaluation.ts`        | Claims, exact quotes, turn IDs, support checks, fact/source IDs, coaching       | Versioned presentation contract                          |
| `EvaluationChecks.ts`           | Quote/reference validation and deterministic metric/period/unit comparison      | Presentation-only span resolution and comparable deltas  |
| `RehearsalEvaluationService.ts` | Immutable reviews, clarifications, written retries, durable jobs                | Read-only evidence projection for a selected review      |
| `EvaluationPanel.tsx`           | Shared voice/video review and expandable source details                         | Transcript, embedded sheet and synchronized inspector    |
| `EvaluationRoutes.ts`           | Selected-session reads and explicit response actions                            | Narrow selected-review evidence read                     |
| `PrismaStore.ts`                | Workspace-scoped, validated snapshots and rehearsal JSON                        | No new storage required for release 1                    |

Current claims contain quotations and turn IDs, but no character spans or audio
timestamps. Financial sources contain serialized rows, but no native worksheet
coordinates. Preserve these limits when resolving older records.

## Interface and interaction

```text
+--------------------------------------------------------------------------------+
| June / Practice / Session 04 / Review                 [Review version v1 v]      |
| [1 needs explanation]  [1 missing evidence]  [1 supported]                       |
| [Excel evidence]  [Interview transcript]                                        |
+---------------------------------------------------+----------------------------+
| INTERVIEW TRANSCRIPT (shown in transcript view)    | SELECTED CLAIM             |
| June: Are you profitable from operations?         | Conflicts with source      |
| Founder: We made [CAD 12,000 in operating profit]. |                            |
|                  ^ hover, focus or select         | You said:       12,000 CAD |
|                  |                                | Source:        -18,000 CAD |
|          +-------+--------------------------+      | Difference:     30,000 CAD |
|          | Evidence preview                 |      |                            |
|          | Operating income  -18,000        |      | Source and reporting period|
|          | Credit             30,000        |      | Calculation + limitations  |
|          | Net income         12,000        |      |                            |
|          | [Show supporting cells]         |      | Suggested framing          |
|          +----------------------------------+      | [Explain my reasoning]     |
+---------------------------------------------------+ [Practise this answer]     |
| EMBEDDED EXCEL-STYLE EVIDENCE                      | [Dismiss suggestion]       |
| Fictional workbook / Income Statement             |                            |
| [D10]  fx =D8+D9                                  | Original evidence retained |
|     | A                    | B Jul | C Aug | D Sep |                            |
|   4 | Total revenue        | 76000 | 80000 | 92000 |                            |
| ... |                      |       |       |       |                            |
|   8 | Operating income     |-24000 |-22000 |[-18000]|                           |
|   9 | SR&ED credit          |     0 |     0 |[30000]|                           |
|  10 | Net income           |-24000 |-22000 |[12000]|                            |
| [Income Statement]   [Original / Sep-Aug changes]  |                            |
+---------------------------------------------------+----------------------------+
```

This example uses fictional native workbook coordinates. For a CSV-backed review,
show a persistent `CSV evidence / review layout` label and the physical source
locator beside the review cell, for example `Tidewell.csv, row 4, operating_income`.
An application-derived formula is labeled `June calculation`; native Excel formula
text is only shown when imported from an actual workbook.

Hover or keyboard focus opens a compact preview without changing the pinned
selection. Click/tap pins that claim, highlights all related evidence cells, and
updates the inspector. Selecting a highlighted cell exposes its source locator
and links to the claims using it. When several claims share a cell, list them for
selection rather than choosing one arbitrarily.

`Show supporting cells` scrolls the embedded grid to the cited period and focuses
the primary cell. `Show transcript claim` focuses its quote in the original turn.
Use the check's fact IDs for the primary comparison; show additional coaching
facts as explanatory evidence, visibly separate from the directly compared fact.

Desktop uses transcript/sheet on the left and inspector on the right. Narrow
screens stack these regions, keep the grid horizontally scrollable within its
container, and expose a selected-claim inspector button beside the quote. All
actions must work by touch and keyboard. Tabs support arrow keys; Escape dismisses
hover previews. Status labels supplement color. Hover content stays visible while
the pointer is over it and can be dismissed without moving focus.

## Data flow and ownership

```text
Saved CSV snapshot / saved scenario financial selection
                         |
                SESSION START (existing)
                         |
          Freeze EvaluationContext: sources + facts
                         |
                Voice / video interview
                         |
           Authoritative final transcript receipt
                         |
       Save transcript + queue evaluation atomically
                         |
           Existing extraction -> checks -> coaching
                         |
                Immutable EvaluationRecord
                         |
                 NEW READ-ONLY PROJECTION
                         |
      +------------------+---------------------+
      |                  |                     |
 Resolve exact      Resolve fact/source    Compute available
 quote spans        references            decimal deltas
      |                  |                     |
      +------------------+---------------------+
                         |
                 Validated EvidenceReview v1
                         |
              Transcript + grid + inspector
                         |
          Explicit clarification / written retry
                         |
            Existing new-review-version workflow
```

The projection is deterministic. It runs no model and adds no background job.
Read financial values from the saved evaluation context, including the selected
scenario's frozen evidence. Do not substitute today's onboarding snapshot or
silently join to a newer financial upload. A changed current snapshot produces a
notice with an explicit new-practice action; it does not change the old review.

## Proposed contracts and source resolution

Add strict Zod contracts in `src/contracts/EvidenceReview.ts`. Validate API inputs,
stored financial source text and the outgoing projection. All amount values remain
decimal strings. Owned new source/test files use PascalCase.

```text
EvidenceReview v1
  sessionId, evaluationId, contextHash, transcriptHash, projectionVersion
  state: pending | failed | skipped | completed
  reason or null
  scope: complete | partial | transcript_only
  provenance: per source; uploaded / founder / public_unverified / fictional
  coverage: included periods, omitted history, unavailable source reasons
  grids[]
    id, snapshotId, sourceIds, title, currency
    layoutKind: csv_review | native_excel
    cells[]
      id, displayAddress, displayText, decimalValue or null
      metric or null, period or null, unit or null
      sourceLocator: CSV locator | native Excel locator
      formula: { kind: imported | derived, text } or null
  claimLinks[]
    claimId, turnId
    span: { startUtf16, endUtf16 } or null
    spanStatus: exact | repeated | unavailable
    support: existing EvidenceCheck status
    primaryFactIds[], supportingFactIds[], cellIds[]
    comparison: { claimed, source, difference, period, unit } or null
    unavailableReason or null
  changes[]
    metric, unit, currentPeriod, previousPeriod
    currentFactId, previousFactId
    absoluteDelta, percentDelta or null, unavailableReason or null

CSV locator                         Native Excel locator (later)
  kind: csv                           kind: excel
  snapshotId, sourceId                 snapshotId, workbookHash
  fileName, sourceRow, columnKey       sheetId, sheetName, cellAddress
```

`displayAddress` is a coordinate in the rendered grid, never the identity of an
underlying CSV source. Native references require a genuine imported cell locator.
Grid layout is versioned and deterministic: metric rows in a declared order,
period columns in chronological order. IDs derive from source identity and metric,
not display position, so changing layout cannot retarget a citation.

```text
EvaluationRecord
  claim.id
      |
      +--> claim.turnId + exact quote --> validated span in frozen turn
      |
      +--> check.claimId
                 |
                 +--> check.factIds[] --> context.facts[]
                                              |
                                              +--> fact.sourceIds[]
                                                        |
                                      context.sources[] (frozen row)
                                                        |
                                 validated row + metric-to-column registry
                                                        |
                                  source locator + rendered cell identity

Coaching item.factIds[] -----------------> extra explanatory cells
Coaching item.sourceIds[] ---------------> additional attributed excerpts
```

Use an explicit metric registry for raw column keys and domain row fields:
`operating_income -> operating_income / operatingIncome`, for example. Validate
serialized financial rows with the saved row schema and verify their period,
source ID and snapshot association. Never parse a human-readable title to infer
ownership or attach a nearby amount by string matching. For derived margins,
highlight numerator and denominator inputs and show the registered calculation.

Resolve quote spans against the unmodified frozen turn text. A single exact match
gets a span, using JavaScript UTF-16 offsets. Repeated matches get a whole-turn
link until an occurrence can be resolved explicitly. Missing quotes receive an
unavailable state. Do not normalize text and reuse offsets from the normalized
string. Multiple overlapping highlights should expose a claim chooser for that
range. Superseded claims link to their correcting turn and retain their original
text without generating a fresh correction recommendation.

## Comparisons and recommendation rules

Keep these relationships distinct:

```text
Spoken claim vs. selected source      -> support status + exact difference
One period vs. previous period       -> change in reported financial values
Suggested answer vs. founder answer  -> coaching, not a new financial record
```

Only compare claimed and source values when metric, period and units match and
there is one unambiguous fact. Calculate `claimed - source` using Decimal.js;
label the sign convention. Reuse the existing check status rather than creating a
new conflicting check in the UI. Rounded spoken values remain subject to the
existing exact checker; tolerance rules require a separate, versioned policy.

For month-over-month changes, require adjacent calendar months, equal units and
currency, and the same metric. Missing months are labeled unavailable; do not
present July-to-September as a one-month change. Use `current - previous` for
absolute change. Percentage growth is `(current - previous) / previous * 100`
only with a positive baseline; otherwise show the absolute change and explain why
percentage growth is unavailable. Round percentages to two decimal places using
Decimal.js half-up rounding for display, retaining the exact input values.

Unknown currency or period prevents a monetary comparison. No income-statement
cell establishes cash runway. A source match establishes agreement with the
selected statement, not audit verification or cash receipt. Uploaded sources
retain their verification limits; fictional sources remain visibly fictional.

Use these UI labels without changing the existing stored status vocabulary:

| Stored support          | UI label                         | Behavior                                            |
| ----------------------- | -------------------------------- | --------------------------------------------------- |
| `supported`             | Matches selected evidence        | Show claim, matched fact and source                 |
| `contradicted`          | Conflicts with selected evidence | Show both values and cited difference               |
| `insufficient_evidence` | Missing supporting evidence      | List needed inputs; no invented cell                |
| `ambiguous`             | Clarification needed             | Ask for period, units or meaning                    |
| `not_checked`           | Not compared                     | Explain forecast, hypothetical or correction status |

Financial-sheet flags are overlays derived from saved checks and coaching. They
do not mark an unexplained large number as suspicious or imply fraud. Coaching
may supply suggested wording and missing inputs. The inspector can show every
validated extracted claim even when the saved report has fewer coaching items;
claims without coaching must not receive fabricated recommendations.

## API, persistence and compatibility

Proposed read route:

```text
GET /api/rehearsals/:id/evaluations/:evaluationId/evidence
  -> EvidenceReview v1

Existing actions reused:
POST /api/rehearsals/:id/evaluations/:evaluationId/responses
  { itemId, kind: clarification | dismissed | practice, text, requestKey }

POST /api/rehearsals/:id/evaluations/:evaluationId/retry
  { generation }
```

The server resolves the review inside the requested session and local workspace;
the browser supplies identifiers, never facts or source locators. Reuse session
authorization, origin policy and evaluation-read rate limits. A missing or unrelated
session/review returns 404. A pending or skipped review returns a validated state
without claim links. A missing/corrupt optional financial source produces an explicit
unavailable source entry and preserves the readable transcript/report.

Fetch once per selected completed review and cache in browser memory by evaluation
ID, hashes and projection version. Hover and cell selection use that response. Read
pending/failure state through existing evaluation polling while the page is visible;
fetch evidence when completion is observed. Reject late responses from previously
selected sessions or review versions. Financial evidence is not added to global
`/api/state` polling or public caches.

Release 1 needs no migration: project existing immutable context and report data
through a narrow read service. Historical records use their own context when it
can be validated; absent context yields transcript-only viewing. Do not reconstruct
old evidence from today's workspace state. A projection version changes rendering
and span resolution without rewriting the saved model report.

Clarification and written retries reuse their current append-only records and
idempotency keys. Review-version selection must switch the transcript, evidence,
highlights and coaching as one coherent unit. Dismissal affects suggestion
visibility; it does not change whether a factual claim matches the source.

## Native Excel follow-on

Native `.xlsx` support requires an ingestion feature, not a filename change.

```text
Upload workbook bytes + explicit currency
                    |
Bounded parsing / file validation
                    |
Founder confirms worksheet, periods and account mapping
                    |
Validate supported numeric values and reconciliation
                    |
Prisma transaction: immutable original + parsed cells + financial snapshot
                    |
Versioned scenario/evaluation context retains original cell locators
                    |
Same evidence review UI -> real SheetName!Cell citations
```

Keep original workbook bytes, content hash, sheet identity, physical cell
coordinates, formula text, cached values and import/mapping version. Persist through
a Prisma-owned adapter with additive schema changes; prevent partial publication
if parsing or mapping fails. Include source mappings in saved scenario financial
inputs so scenario-based reviews preserve the same provenance as open practice.

Select and review the parser before implementation. Define upload, decompression,
worksheet/cell-count and parsing-time limits. Treat cells as untrusted text; never
execute macros, external links, embedded content or workbook formulas. Missing or
stale formula results require an explicitly recalculated upload or unavailable
status. Unsupported protected files and ambiguous layouts get a useful rejection.
Do not claim native Excel support until that ingestion and provenance path exists.

## Implementation packets and acceptance

```text
Packet 1: validated read model + resolver + deterministic comparisons
     |
Packet 2: embedded grid + synchronized transcript/inspector
     |
Packet 3: existing actions + history + keyboard/mobile states
     |
Release 1 acceptance
     |
Separate native Excel ingestion proposal and implementation
```

Suggested ownership:

- `src/contracts/EvidenceReview.ts`: versioned output and locator schemas.
- `src/features/EvidenceReview.ts`: frozen source resolution, span resolution,
  metric mapping and Decimal.js comparisons.
- `src/server/EvaluationRoutes.ts`: selected-review evidence read.
- `src/web/EvidenceReview.tsx`, `FinancialEvidenceGrid.tsx`,
  `TranscriptEvidence.tsx`: shared presentation under `EvaluationPanel.tsx`.
- `test/EvidenceReview.test.ts` and existing integration coverage: source integrity,
  deterministic arithmetic and session-scoped routes.

Acceptance cases:

1. Fictional operating-profit claim of 12,000 CAD resolves to operating income of
   -18,000 CAD. Credit and net-income cells appear as explanatory evidence. The
   original values and transcript remain intact.
2. A revenue claim matches its frozen source; its hover preview identifies the
   correct period, metric, physical source and review cell.
3. An eighteen-month runway claim displays missing cash evidence with no invented
   spreadsheet value or contradiction verdict.
4. Selecting a quote and selecting its evidence cell synchronize in both
   directions. Shared cells and overlapping claims expose a choice.
5. Repeated quotes, Unicode text, corrected claims, unknown currency, zero or
   negative percentage baselines and missing months produce explicit states.
6. Opening a newer upload leaves an old review pinned to its original values.
   Scenario-linked reviews use scenario-frozen financial evidence.
7. Partial, pending, failed, skipped and transcript-only reviews retain honest
   coverage. A failed projection never erases a saved report or starts inference.
8. Keyboard/touch users can inspect the same evidence, dismiss previews and
   navigate between quote and cell. The page fits mobile widths with grid scrolling.
9. CSV citations never masquerade as original Excel cell addresses; fictional
   workbook coordinates stay labeled in demos.
10. Authorization tests reject another session's review ID; rapid selection changes
    cannot display a stale response under the wrong session.

After implementation edits, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
`pnpm test`, `pnpm build`, and `pnpm test:integration`. Browser-check the supported,
conflicting and missing-evidence paths at desktop and narrow widths. Automated
validation uses fictional fixtures and starts no paid sessions. Keep the application
bound to 127.0.0.1; remote deployment requires account/membership authorization.
