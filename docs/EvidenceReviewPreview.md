# Evidence-linked review proposal

Interactive concept: [Evidence review preview](previews/EvidenceReviewPreview.html).
Implementation proposal: [Engineering spec with ASCII diagrams](EvidenceReviewEngineeringSpec.md).
The HTML embeds an Excel-style workbook with column letters, row numbers, a formula bar,
worksheet tab and highlighted cells. The transcript stays above the workbook while
reviewing claims. Hover previews show exact fictional worksheet/cell references.
All figures, workbook cells, formulas, claims and the founder called Mark are fictional.
This workbook is authored demo data, not a conversion of an uploaded CSV or an actual .xlsx file.
The preview makes no API requests; drafts live only in page memory.

## Recommendation

Ship a connected financial-source and transcript review as the next slice. A founder
should be able to select a claim, understand its comparison with the frozen source,
and inspect the original row without losing the interview context. Use “needs
explanation,” “conflicts with source,” and “insufficient evidence” rather than calling
data suspicious. A reconciled statement can still be described incorrectly.

The preview distinguishes three concepts: a numerical mismatch between a spoken
claim and its source; changes between reporting periods; and suggested wording.
Recommendations never overwrite financial data or the original transcript.

## Main inspected

At the initial inspection on October 17, 2026, local main and remote main both pointed
to `0d24bbd`. The implementation PR is based on the later spreadsheet release in main.
Existing uncommitted development/LiveAvatar work was present and preserved.
`docs/CODEX-NAVIGATION-GUIDE.md` was not present in this checkout.

- `Financials.ts` validates a fixed monthly CSV schema with Decimal.js, retains raw
  column names and source row numbers, and already identifies credit-backed positive
  net income alongside an operating loss.
- `RehearsalEvaluation.ts` retains exact claim quotes, turn IDs, support statuses,
  fact IDs and source IDs. `EvaluationContextAssembler.ts` freezes selected financial
  evidence and supplies per-row sources and metric facts.
- `EvaluationPanel.tsx` displays coaching cards and expandable source details. It
  lacks a linked financial grid, inline transcript claim inspection and source navigation.
- Evaluations run after authoritative transcript intake. Live captions have no final
  evidence-backed evaluation. Native Excel import and workbook cell coordinates are
  not implemented.

## Smallest shippable implementation

1. Add a shared evidence inspector to the saved-session review. Resolve
   `claim.turnId → check.factIds → fact.sourceIds`, including coaching references.
   Prefer check fact IDs for numerical comparisons; never attach a nearby source by guesswork.
2. Render the frozen financial snapshot as a read-only grid. Link by snapshot ID,
   original CSV row and column key. Show period, currency and fictional provenance.
   Validate structured financial row projections with Zod rather than casting source JSON.
3. Mark exact claim quotations inside their referenced turns. Hover and keyboard
   focus reveal a compact source preview; click/tap pins the inspector. Escape dismisses
   the hover card. Ambiguous repeated quotations require a resolved span or whole-turn
   link; do not arbitrarily highlight the first matching phrase.
4. Show claimed value and source value side by side only when metric, period and
   units match. Calculate differences using Decimal.js. Missing or ambiguous evidence
   gets its own state without a fabricated comparison.
5. Keep suggested wording and the existing clarification/written-retry actions together.
   Clarifications produce a new review version. Preserve source, transcript and report history.

Financial changes in this mockup compare September column D with August column C in
one fictional workbook. Operating income is D8, the credit D9, net income D10, and
revenue D4. The formula bar follows the selected cell; highlighted related cells
show the complete evidence chain.
Comparing uploads is a separate feature: align periods, metric keys and currencies,
retain both snapshot IDs, and distinguish corrections from new reporting periods.

## Later slices

- Native `.xlsx` intake retaining original workbook, worksheet, A1 cell addresses,
  formula text and cached values. Do not invent cell addresses for existing CSV sources.
- Export an annotated copy with findings and recommendations, retaining the original.
- During a live interview, optionally expose known frozen sources beside questions.
  Clearly separate source lookup from post-call claim checking; do not present an
  unfinished transcript as already evaluated.

## Preview walkthrough and acceptance

- Select each finding: profitability conflict, missing cash evidence, supported revenue.
- Switch to month-over-month changes to see September versus August differences.
- Open Interview transcript, hover/focus a claim, then select it to inspect evidence.
- Jump from the inspector to the exact claim or its highlighted workbook cells.
- Draft a revised answer; switch findings and return to see the draft retained in memory.
- Keyboard users can use tab controls, arrow keys, focused claim previews and Escape.
- Real implementation must handle absent sources, unknown currency, stale snapshots,
  partial transcripts, repeated quotes and failed/pending evaluation explicitly.

This is a design artifact, not a production review screen or an Excel integration.
