# Goal investor journey implementation checklist

Status: connected implementation delivered locally, October 17, 2026.
Source of truth: [specification](GoalInvestorJourneySpec.md).
Validation and practical limits: [delivery record](GoalInvestorJourneyDelivery.md).
Checked items describe implemented behavior and the verification stated below, not a
remote release, funding outcome or live-provider certification.

## Product acceptance

- [x] Goal -> Investor match -> Add target investor -> Tailored brief -> Practice
      -> Review progress -> Updated goal graph and next action.
- [x] One stable goal owns independent target preparation tracks.
- [x] Homepage graph exposes recorded history, current position and separate planned work.
- [x] Match score, practice evidence and checklist progress remain separate measures.
- [x] Sources, financials, transcripts, revisions and exact historical links are preserved.

## Journey, scope and persistence

- [x] Strict Zod contracts and five focused Prisma journey/target/scope/assessment/event models.
- [x] Stable journey identity across goal revisions; meeting/focus changes preserve identity.
- [x] One empty target slot initially; additional included targets explicitly expand scope.
- [x] Workspace/journey/investor uniqueness, expected journey/revision and payload-bound receipts.
- [x] Independent current cycles and exact historical cycle resolution across services,
      scenario persistence and practice-start guards.
- [x] Progress appends and originating workspace changes commit in one optimistic transaction.
- [x] Provider calls remain outside transactions; existing source/revision/lease guards remain.
- [x] Archived journeys retain target references and exact read-only cycle history.

## Match and selection

- [x] Optional source-pinned mandate extraction within the existing bounded research call.
- [x] Mandate facts are distinct from historical investments, portfolio attributes and preferences.
- [x] Normalized criteria, versioned weights, Decimal score and weighted evidence coverage.
- [x] Matching known currency required; unknown/conflict/exclusion/expiry states explained.
- [x] Identity, stage/geography and coverage gates suppress unsupported numerical scores.
- [x] Current assessments and immutable goal/source/rubric history; worker expiry reconciliation.
- [x] Radar and connected recommendations share the same assessment function.
- [x] Reads perform no research or saved assessment writes.
- [x] Review fit, add/view target, explicit unknown override rationale and target management.
- [x] Shortlist before story approval; new identities stay paused; monitoring is independent.
- [x] Assessment refresh requires explicit review/re-pinning before current preparation resumes.

## Brief, practice and feedback

- [x] Immutable connected brief versions and exact goal/target/assessment/pitch/cycle/scope lineage.
- [x] Missing-story targets route into story preparation; eligible briefs draft locally.
- [x] Exact current story and brief approval required before reviewed scenario generation.
- [x] Lineage carried through written, voice and video selection using frozen saved inputs.
- [x] Legacy records/hashes, transcript authority and media limits preserved.
- [x] Pending/failed/partial assessments remain distinct; navigation/start/captions do not pass gates.
- [x] Late results remain on the originating track; shared and target-specific changes propagate correctly.
- [x] Revision decisions append records; only saved finding comparisons establish observed improvement.
- [x] Focused retries do not replace the originating full-session gate assessment.
- [x] No-gap cycles can finish and wait without spinning unchanged automatic work.

## Homepage history and current progress

- [x] Deduplicated immutable events with resulting counts, scope, evidence and artifact references.
- [x] One shared story plus five gates per included target; original denominators retained.
- [x] Historical step line, current marker and distinct future estimate region.
- [x] Scope/source/cycle changes create observations; reads, focus and unchanged polling do not.
- [x] Removed work is not labeled improvement; historical points are never rebased.
- [x] Point details preserve exact sources, briefs, practice and assessment references without focusing a target.
- [x] Goal/target/date selection, indexed event pagination, fixed boundary and equivalent event table.
- [x] Native keyboard controls, explicit non-color labels, reduced motion and responsive chart/table overflow.
- [x] Shared server projection drives graph, target rows and next action.
- [x] Per-session evidence history is separate from reviewed-work percentage; no invented speaking average.
- [x] Schedule counts shared work once and per-target work separately using exact arithmetic,
      saved capacity/timezone and disclosed external waiting assumptions.

## Migration and verification

- [x] Additive migration preserves old financials, source IDs, practices and legacy hashes.
- [x] No speculative lineage backfill; graph begins with an explicit current baseline.
- [x] Two-target tests cover scope, focus, source changes, isolated cycles and stale commands.
- [x] Replay/concurrency/late-result guards, score edges, history boundaries and pure-read tests.
- [x] Full written journey and baseline point inspection verified after browser reload.
- [x] Disposable PostgreSQL integration checks include database reopen and archived historical links.
- [x] Workspace/session/origin/rate boundaries remain in place; preview bound to loopback.
- [x] Documentation updated to delivered behavior and explicit limits.
- [x] Required checks listed in the delivery record pass after implementation.
- [x] No paid session, investor message, push, deploy or provider/credential change.

## Later verification and scale work

- [ ] Test live paid voice/video providers separately when explicitly requested.
- [ ] Perform a dedicated assistive-technology and cross-device accessibility audit.
- [ ] Page assessment/scope and legacy connected-cycle histories if workspace scale requires it.
      Progress event history already uses database cursor pagination; current event/practice
      projections disclose their 100-record bounds and targets are capped at 50.
- [x] Pre-commit dependency audit and diff review; `pnpm audit` reports zero vulnerabilities.
- [ ] Before any remote rollout: explicit deployment request and account/membership authorization.
