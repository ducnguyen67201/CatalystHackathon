# Investor preparation, question explanations and KPI pivoting

Status: proposed implementation, October 17, 2026. This document changes no application behavior.

The [question and Why specification](QuestionWhySpec.md) details the ASCII flow, joint
generation timing, hover interaction, turn persistence and live voice integration boundary.

## Intended experience

The founder selects an investor, sees a short preparation focus grounded in saved research,
practises questions connected to their company evidence, and can inspect why each saved
question matters. When their answer does not support the conclusion they are making,
the coach explains the gap and suggests a better metric or asks for missing evidence.

Changing investors changes the emphasis and questions. It never changes company figures,
removes an inconvenient finding, or makes an unsupported claim acceptable.

## What already exists

| Capability                 | Current implementation                                                                              | Proposed extension                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Selected-investor evidence | `ScenarioSources.ts` selects saved research with provenance and dates                               | Add structured, cited preparation priorities without fetching fresh research on selection                                     |
| Investor preparation       | `Scenario.ts` and `ScenarioPrompt.ts` define themes, hypotheses, questions and conditional branches | Connect each question to specific priorities, financial facts and missing inputs                                              |
| Explanation UI             | `ScenarioDetails.tsx` shows scenario-level “Why practise this?” and sources                         | Add question-level “Why this question?” disclosures                                                                           |
| Financial findings         | `Financials.ts` calculates an operating-income/credit finding with exact decimals                   | Extract reusable finding and metric rules for preparation and coaching                                                        |
| Post-practice KPI coaching | `EvaluationProvider.ts` separates numerical support from relevance and allows no pivot              | Reuse these semantics and evidence links in the preparation experience                                                        |
| Evidence inspection        | `EvidenceReview.tsx` and `FinancialEvidenceGrid.tsx` display frozen evidence                        | Reuse presentation primitives; add a preparation projection rather than pretending a pre-call question has a transcript claim |
| Voice/video                | Saved scenario context is supplied to provider-controlled interviews                                | Keep scenario explanations initially; question-level live synchronization is a separate increment                             |

The financial-focus HTML preview is a useful design reference, not an implemented detector.
The navigation guide referenced by the workspace supplement is absent in this checkout.

## Investor-specific preparation

Use the existing selected-investor source assembly and generation worker. Add preparation
priorities containing a stable ID, topic, supporting research references, source passage,
and an explicit distinction between a stated priority and a preparation hypothesis.

For example, a source discussing capital efficiency can motivate a question about operating
performance. A source discussing customer expansion can motivate questions about retention
and growth evidence. Neither establishes the investor's private intentions or exact future
questions. A portfolio investment alone does not establish a current investment mandate.

Preserve unverified and fictional labels. Show publication and retrieval dates separately.
Missing or conflicting research should produce limited-context preparation or a visible
uncertainty, not a definitive preference. Do not invent confidence percentages.

Join those priorities to the company's frozen evidence through reusable findings. Prioritize
incorrect or unsupported central conclusions first, then useful investor-specific emphasis.
Keep the financial findings stable when comparing investors using the same company snapshot.
Start a new saved scenario/session when switching investors; do not change an active call's context.

## The “Why?” disclosure

Beside an opening or follow-up question, show **Why this question?**. The disclosure contains:

1. **Investor context:** a relevant source excerpt and link, with its verification label; or “General preparation: no supported investor priority available.”
2. **Your evidence:** the exact reporting period, financial figures and original CSV references, or a specific missing-input list.
3. **Why the connection matters:** a short coaching explanation, labeled as a preparation hypothesis where appropriate.
4. **What a strong answer covers:** the distinction to explain and evidence to bring, without scripting unsupported business claims.

This is a saved, evidence-backed explanation of the exercise. It is not a claim to expose the
model's internal reasoning. Opening it should perform no generation or paid provider call.

Initially place it on the scenario detail and guided question views. In the current voice/video
room, use **Why this scenario?** until the application can identify the actual active question.
Do not attach a saved branch explanation to a loosely similar live caption.

## How KPI pivoting works

Separate three decisions: whether a claim is supported, whether it answers the question, and
whether another metric would improve the explanation. An accurate number can support an
inappropriate conclusion; an investor preference cannot make a false statement true.

| Situation                                           | Coaching decision          | Next step                                                                           |
| --------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Answer is supported and relevant                    | Keep focus                 | Continue or deepen the same topic                                                   |
| Topic, period or meaning is ambiguous               | Clarify                    | Ask one specific clarification                                                      |
| Conclusion conflicts with saved evidence            | Correct the interpretation | Cite the relevant rows and ask the founder to distinguish the figures               |
| Metric is valid but insufficient for the conclusion | Suggest a pivot            | Acknowledge what it establishes, explain the gap, and introduce one relevant metric |
| Required metric inputs are absent                   | Request evidence           | Name the missing inputs; do not calculate a substitute                              |

Proposed response sequence: acknowledge the useful part of the answer, identify the specific
gap, explain the proposed focus, then ask one question. Avoid repeated redirection after the
founder has already addressed the issue. Remember resolved findings and consider the preceding
interviewer question: discussing ROAS is appropriate when the interviewer asked about advertising.

For the first release, support four bounded topics:

- Positive net income alongside an operating loss and credit: reuse the existing reconciled income statement evidence.
- Revenue and gross-margin trends: calculate only from comparable saved periods, using Decimal.js; absent periods or zero revenue make relevant comparisons unavailable. Do not infer causes.
- Cash burn/runway claims: request cash balances and relevant cash-flow evidence. The current income statement does not support computing them; operating loss is not cash burn.
- ROAS or retention claims: request the corresponding advertising attribution or customer/cohort evidence. These inputs are not currently supported sources; show the checklist without implying ingestion exists.

## Illustrative conversation

All company values and investor priorities below are fictional. Amounts have no confirmed currency.

Founder: “We made 122,503 in net income, so our operations are profitable.”

Coach: “That is the reported net income. The same period records operating income of -59,797
and a credit of 182,300. How would you explain the difference between net income and the
operating result?”

The explanation links the three saved values and the selected investor's fictional
capital-efficiency source. A founder who already explains the distinction receives no correction.

Founder: “But our ROAS is 4x, so that proves the business is sustainable.”

Coach: “That ROAS claim would need its advertising and attribution data. It also does not
establish overall operating profitability. Can you explain the operating result first?”

For an investor with a sourced customer-expansion priority, another preparation question can
ask what retention evidence supports repeatable growth. Missing retention data remains missing;
switching investors does not erase the operating loss.

## Contracts and ownership

Extend the existing scenario pipeline rather than creating another research or generation service.
Proposed new owned modules use PascalCase:

- `src/contracts/Preparation.ts`: Zod schemas for preparation priorities, question explanations, typed metric references and coaching decisions (`keep`, `clarify`, `correct`, `pivot`, `request_evidence`).
- `src/features/PreparationFindings.ts`: pure, deterministic findings from frozen financial inputs, with decimal strings, periods, units, formula identifiers and input references.
- `src/features/PreparationPolicy.ts`: allowed transitions and evidence requirements. The model may classify an answer and propose language; server validation resolves references and enforces computability and financial constraints.
- `src/web/QuestionExplanation.tsx`: a keyboard-accessible disclosure with source links, missing inputs and explanation content, fitting the teammate's existing layout.

Extend `Scenario.ts` with versioned question records: stable question ID, question text,
topic, explanation, success criteria and follow-up references. Each explanation references
priority IDs, finding IDs, source IDs and typed financial locators rather than embedding
independent copies of calculated figures. Branches need their own IDs and explanation records.

Update `ScenarioPrompt.ts`, `ScenarioService.ts` and the generation adapter to validate these
links against the frozen input. A valid reference proves it exists, not that it supports the
model's interpretation; retain excerpts and uncertainty and test adversarial outputs.

Reuse the existing post-call claim extraction and evidence checks. Introduce shared policy
helpers without replacing its transcript citations, correction handling or saved review history.
Do not count founder clarification as newly verified financial data.

New scenario and practice-context versions must remain readable alongside existing records.
Keep old snapshots and hashes unchanged. Persist explanations with the generation so they do
not drift on refresh. Use the existing Prisma generation JSON for the initial slice; no new
table is expected unless the live turn controller is added. Update source-preview hashes to
cover any new deterministic inputs. Reads and generation must retain existing workspace scope,
origin protection, idempotency and durable job completion checks.

## Delivery sequence

1. **Explainable preparation:** implement typed findings, cited priorities and per-question explanations through the existing generation pipeline. Add the disclosure to scenario details. Include loading, failure, limited-context and outdated-source states. This is the smallest useful demonstration.
2. **Consistent KPI coaching:** connect the shared decisions to post-practice feedback and its existing written retry flow. Demonstrate keep, clarify, correction, pivot and missing-evidence cases with visible sources. Keep this explicitly post-practice.
3. **Adaptive questions during practice:** add a server-owned guided text flow that persists the current question, answer, selected transition and explanation with stable turn IDs. Use structured model classification for free-text answers, constrained by deterministic checks. Save turn state and enqueue processing atomically through Prisma; retries must not advance twice. This provides a reliable interactive demonstration without depending on provider-controlled speech turns.
4. **Live voice/video synchronization:** first verify each provider's current supported controls and callbacks. Require a trustworthy mapping between the spoken question and a server question/turn ID before showing “Why this question?”. Handle interruptions, reconnects and duplicate events. If that mapping is unavailable, retain scenario-level explanations. Provider prompt changes or paid verification sessions require separate explicit authorization.

For the short presentation deadline, target increments 1 and 2 first. Increment 3 is the next
choice if an adaptive interaction is essential to the demo. Do not describe increment 2 as
live redirection or imply increment 4 works before it has been verified.

The UI handoff is one disclosure component plus the existing investor selector and scenario
panel. Backend contracts, finding rules and source resolution can be prepared independently
of layout work. Confirm current edits before implementation touches shared files.

## Acceptance and validation

- Two investors with different cited priorities produce different preparation emphasis on identical financial evidence. Both retain the same material findings.
- Every question explanation resolves to the exact saved question and frozen sources; unrelated investor evidence is rejected.
- No investor research yields useful limited-context questions and no invented preferences.
- Correct, relevant answers produce no pivot. Self-corrections and interviewer-led topics are respected.
- The credit/operating-loss example is handled correctly; zero revenue, missing periods, unknown currency and unavailable cash/customer inputs produce explicit limits.
- Clicking “Why?” performs no model call. Old scenarios and sessions reopen unchanged after new research arrives.
- Generated source instructions, nonexistent IDs and malformed outputs are rejected or treated as untrusted data.
- Keyboard operation, source navigation, disclosure focus, error recovery and investor-switch behavior work in the existing layout.
- For guided turns, duplicate submissions, stale responses and restart recovery preserve one ordered transition per answer.

After implementation edits, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`,
`pnpm build` and `pnpm test:integration`. Use injected provider doubles for automated checks.
Report live provider validation separately. This planning-only change requires no paid calls,
provider configuration changes, deployment or application test run.
