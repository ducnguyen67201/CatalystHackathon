# Connected preparation delivery checklist

The implemented goal-led, multi-target extension has a separate
[implementation checklist](GoalInvestorJourneyImplementationChecklist.md) and
[delivery record](GoalInvestorJourneyDelivery.md).
Checked items below describe the earlier connected loop.

Status: implemented in the real application. Checked items describe shipped code and local verification, not a funding or mastery outcome. Live paid-provider checks remain separate.
Scope: [ConnectedPitchEngineeringPlan.md](ConnectedPitchEngineeringPlan.md).

## The loop

```text
1 Review story -> 2 Select recommended investor -> 3 Approve tailored brief
       ^                                                     |
       |                                                     v
6 Review revision <- 5 Saved feedback <- 4 Scenario + practice
       |
       +-> approve new version -> refresh affected steps -> next cycle
```

The six steps are a live checklist inside Overview. Each item shows status, completion
evidence, its next workflow and a button. Keep existing sidebar destinations. Financial
sources, old pitch versions, decisions and practice results remain immutable.

## Six acceptance gates

- [x] **1. Review the financial story.** Display sources, the proposed text and the change
      reason. Save edits independently of approval. An exact current revision approval
      completes this gate and prepares the investor-review action. Saving text alone does not.
- [x] **2. Review recommendations and select an investor.** Overview surfaces candidates;
      Investor research shows a `Recommended to review` tag, source-linked reasons, tradeoffs
      and unknown criteria. Use confirmed financing history and intended round as separate
      inputs. Prior financing alone never excludes angels or proves VC eligibility. An explicit
      selection completes this gate and prepares a tailored brief from the approved story.
- [x] **3. Approve the tailored meeting brief.** Pin the story revision, investor and source
      versions. Show what changed for this audience and why. An exact current approval
      completes this gate and makes scenario source review the next workflow.
- [x] **4. Create a scenario and complete practice.** Review frozen sources before scenario
      generation. Reuse the approved brief in written, voice and video paths. Only a saved
      authoritative answer/transcript completes practice; navigation, session start and live
      captions do not. Queue the existing evaluation workflow once.
- [x] **5. Review saved feedback.** Keep pending, failed, partial and completed reviews
      distinct. Link findings to the exact transcript and sources. A completed assessment
      becomes inspectable, then the founder reviews it. A failed review has Retry and cannot
      create a successful result or improvement count. Prepare one deduplicated revision
      proposal when there is an actionable gap and drafting is authorized.
- [x] **6. Decide on the proposed revision.** Show old and proposed wording, source references
      and the feedback reason. Approval creates a new pitch version; rejection preserves the
      current version and unresolved gap. Mark this cycle reviewed only after an explicit
      decision. If a material revision is approved, invalidate only the affected brief/scenario/
      practice gates and route to the next required review. Do not auto-approve content.

## Checklist behavior

- [x] Use `blocked`, `ready`, `running`, `needs review`, `complete`, `failed` and `outdated`
      with a text reason. Derive completion from saved evidence, never from a clicked link.
- [x] Show one next action; previous and later items stay inspectable. Include a compact
      cycle history and the exact pitch version used in each completed cycle.
- [x] Distinguish preparation completion from measured improvement. A new draft, accepted
      edit or declined suggestion never establishes improved speaking or financial health.
- [x] When no actionable gap remains, finish the current cycle and show “Watching for new
      evidence or your next practice.” Do not spin a model/research loop with unchanged inputs.
- [x] New evidence, a changed goal or new investor criteria reopens relevant checks. Show
      a source-change warning and retain the earlier source identities. Existing sessions never acquire the new inputs silently.
- [x] Investor recommendations refresh from relevant saved inputs. Display recommendation
      provenance and freshness; preserve unknown current mandate, check size and currency.

## Workflow handoffs

- [x] Persist transition intent and its source identities. Commands use expected versions,
      reviewed hashes and idempotency keys. Same request replay does not duplicate work.
- [x] Reuse durable jobs for generation and evaluation; publish under the current lease fence.
      A stale worker cannot advance the current checklist.
- [x] Deterministic saved-data projections may refresh automatically. Paid generation follows
      explicit action or a bounded, saved opt-in; practice start always stays explicit.
- [x] Viewing a page queues no job, research, outreach or provider session. No outbound
      investor communication or automatic provider configuration changes belong to this loop.
- [x] Model failure preserves the previous approved pitch and pending checklist item.
- [x] Block stale/cross-workspace references, preserve old context hashes and support historical
      records without fabricating completion evidence.

## Verification before marking the implementation complete

- [x] End-to-end: approve story -> select investor -> approve brief -> review scenario sources
      -> complete written practice -> saved feedback -> approve revised story -> next cycle.
- [x] Confirm rejection, failed evaluation/retry, no-actionable-gap completion, new evidence,
      changed investor, concurrent edits, request replay and refresh/resume behavior.
- [x] Confirm a second cycle preserves the first cycle's content and source identities.
- [x] Confirm an investor with unknown criteria is not labeled as a verified match.
- [x] Keyboard, dialog focus, mobile layout and source/history navigation work.
- [x] Run lint, format check, typecheck, unit tests, build and database integration tests after
      all implementation edits. Record prototype checks separately from real backend checks.

## Verification evidence

- `test/ConnectedPreparation.test.ts`: gates and read purity; stale edits and request replay;
  sourced/unknown investor criteria; frozen context; accepted/rejected/no-gap cycles; partial
  assessments; retry state; provider-session freshness and duplicate exclusion.
- `test/Integration.test.ts`: real Fastify/Prisma workflow through reviewed scenario generation,
  durable evaluation, proposal acceptance and cycle two. Conflicting scenario creation is
  blocked under the workspace lock. A caller-chosen request key cannot overwrite an existing
  rehearsal. Saved state reopens through a new Prisma connection.
- Real React UI walkthrough on loopback with an isolated disposable PostgreSQL workspace,
  explicitly fictional Tidewell/research records, template scenarios and the evaluator test
  double. Cycle two, source review, the recommendation tag, refresh persistence, historical
  report access and Meeting brief -> checklist navigation were checked in the browser.
- Lint, formatting, TypeScript, unit tests, build and database integration are the handoff gates.
  No provider credentials, remote resources or deployment settings were modified.

## Boundaries retained

- [ ] Exercise paid live voice/video providers against the actual account configuration.
      Their existing transport paths carry the new frozen context and guard stale starts, but
      this request's validation uses local doubles and makes no paid sessions.
- [ ] Extract large preparation histories into focused tables with cursor pagination.
      The first implementation deliberately reuses the existing Prisma aggregate and bounds the
      read projection to the latest ten cycles, while preserving older stored history.
- [ ] Independently verify current investor mandates, check sizes or application routes.
      These remain explicit unknowns unless sourced; a recommendation is a lead to review.
