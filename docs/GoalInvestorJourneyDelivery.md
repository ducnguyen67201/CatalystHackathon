# Goal investor journey delivery record

Implemented locally October 17, 2026, following the user's implementation request.
Contract: [GoalInvestorJourneySpec.md](GoalInvestorJourneySpec.md).
Verification checklist: [GoalInvestorJourneyImplementationChecklist.md](GoalInvestorJourneyImplementationChecklist.md).

## Delivered experience

```text
                         ONE SAVED FUNDRAISING GOAL
                                    |
                                    v
                         Radar: review investor fit
                         priorities / stage / geography
                         individual check / source coverage
                                    |
                       explicit selection + rationale
                                    v
                          Add target investor
                           /                \
                  Investor A track      Investor B track
                           \                /
                            shared company story
                                    |
                         approve exact tailored brief
                                    |
                         review scenario inputs
                                    |
                       written / voice / video practice
                                    |
                         save assessment + review
                                    |
                         decide revision / retry / finish
                                    |
                                    v
                 HOMEPAGE: HISTORY + CURRENT PROGRESS
                    exact saved points and sources
                    per-session practice evidence
                    separate remaining-work estimate
                                    |
                         next action for this goal
```

Radar provides **Review investor fit**, **Add to target investors** and **View target**.
Match uses saved, explicitly attributed mandate facts, with criterion explanations,
weighted evidence coverage and source dates. The numerical score is withheld when required
identity/coverage/freshness/conflict gates are not met. Historical deal attributes and
round totals never establish a mandate or individual check size. A founder may explicitly
choose a target with unknown criteria by recording a rationale. New investor identities
remain paused until monitoring is separately configured.

Each target retains its own cycle, brief, approvals and practice. An investor can be added
before an approved company story exists; the next action prepares/reviews the shared story
first. Story approval prepares the exact target brief. Brief approval leads to source
preview, reviewed scenario generation, practice, saved feedback and revision decisions.
Switching investor focus preserves other tracks. Shared story edits invalidate dependent
work; investor-specific edits remain on the selected track.

Overview now begins with the goal-wide progress graph. Recorded points preserve the
counts and preparation scope at the time of the observation. The current marker reflects
saved work; planned remaining effort/date are visually separate estimates. One shared
story gate and five gates per included target determine the checklist percentage. Removing
a target changes scope and does not claim improvement. Match alignment, preparation
completion and assessed practice evidence are separate measures.

Historical point inspection opens the exact goal/scope/projection and the linked briefs,
sessions, assessments and evidence. Per-session evidence counts show supported,
contradicted, unresolved and observed-improved findings where the saved assessment
establishes them. Zero assessed findings is shown honestly. Opening history or changing
focus creates no progress event and does not approve current work.

## Engineering ownership

| Area                                                 | Owners                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Journey/target/scope/progress contracts              | `src/contracts/GoalJourney.ts`                                                                                                          |
| Mandate facts and match rubric                       | `src/contracts/InvestorMatch.ts`, `src/features/InvestorMatch.ts`, `src/features/InvestorMatchInputs.ts`                                |
| Journey commands and historical projection           | `src/features/GoalJourneyService.ts`                                                                                                    |
| Progress gates, observations and goal-wide estimates | `src/features/GoalProgress.ts`                                                                                                          |
| Target cycle/brief/practice lineage                  | `src/features/ConnectedPreparation.ts`, `ConnectedPreparationService.ts`, `ScenarioSources.ts`                                          |
| Atomic persistence and indexed event queries         | `src/infrastructure/GoalJourneyStore.ts`, `PrismaStore.ts`                                                                              |
| API/auth integration and reconciliation              | `src/server/GoalJourneyRoutes.ts`, `Api.ts`, `Worker.ts`                                                                                |
| Homepage, Radar and handoffs                         | `src/web/GoalJourney.tsx`, `RadarUpdates.tsx`, `ConnectedPreparation.tsx`, `PreparationPlan.tsx`                                        |
| Tests                                                | `test/InvestorMatch.test.ts`, `GoalJourney.test.ts`, `GoalJourneyChart.test.tsx`, `ConnectedPreparation.test.ts`, `Integration.test.ts` |

Five focused Prisma models store journey metadata, targets, assessments, scope and progress
events. The existing preparation aggregate keeps pitches/cycles/decisions. The originating
state change and progress append commit together under optimistic revision control;
repeatable-read loads give a coherent graph/current projection. Commands bind request keys
to payloads and expected journey identity. Exact historical cycle requests remain read-only,
including after a new goal archives the original journey.

Migration `20261018010000_goal_investor_journey` is additive. Restart local development
or run `pnpm db:deploy` against the configured local database to apply it. Verification
applied migrations only to disposable databases. Existing financial snapshots, sources,
transcripts, practices and hashes remain intact. New journeys capture a current baseline;
earlier chart history is not reconstructed from ambiguous legacy artifacts.

## Validation

The required local checks pass: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
`pnpm test`, `pnpm build` and `pnpm test:integration`.
Final totals: **371 unit tests across 51 files; 45 PostgreSQL integration tests**.

The tests exercise evidence/scoring edges, pure reads, stable goal identity, separate target
cycles, scope/denominator history, stale commands, concurrent request replay, frozen practice
lineage, root-versus-focused retry assessment, archived history and database reopen.
PostgreSQL integration uses disposable test databases. Build output retains the existing
vendor annotation and large-chunk warnings; they do not fail the build.

A separate loopback preview with a disposable database verified this browser path using
explicitly fictional company/investor data and local fixture providers:

1. Goal baseline appears on the homepage.
2. Radar shows insufficient mandate coverage without inventing a score.
3. Explicit rationale adds the target while monitoring remains paused.
4. Missing story routes to story preparation and approval, then the tailored brief.
5. Brief approval opens exact scenario source review and local fictional generation.
6. A written answer queues one saved assessment; review and the no-gap decision finish the cycle.
7. Homepage reaches 6/6 reviewed, retains all earlier points and shows the linked practice.
8. Reload preserves 6/6 current state; the original baseline still opens as 0/6 with no practice.

The preview's no-gap fixture returns zero assessed claims. This verifies persistence and
workflow gates, and does not claim measured founder improvement. No paid provider, real
investor outreach or live voice/video session was used.

## Practical limits

- At most 50 saved targets per journey. The current projection includes the most recent
  100 events and 100 linked practices, with disclosure. Older progress points remain
  available through indexed cursor pagination and exact-event lookup.
- Assessment/scope histories and existing connected pitches/cycles still use the
  small-workspace loading model. Dedicated pagination for those histories is future scale work.
- Matching is deliberately conservative and depends on saved attributed research. Existing
  evidence without mandate facts will often need verification. Taxonomy changes need a new
  rubric/review; no implicit FX or funding probability is supplied.
- Native keyboard controls, equivalent tables, non-color labels, responsive overflow and
  reduced-motion support are implemented. A dedicated assistive-technology/device audit remains.
- All practice modes preserve and validate lineage through existing adapters; paid live
  voice/video providers were not exercised in this delivery.
- This is a local implementation. No push, deployment, credentials/provider change or paid
  job was performed. Remote account/membership authorization remains a separate rollout prerequisite.
