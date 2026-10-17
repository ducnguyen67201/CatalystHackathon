# Vicky questions and “Why?”: implementation specification

Status: proposed, October 17, 2026. Documentation only; no application or provider changes.
Extends [the investor preparation plan](InvestorPreparationPlan.md) and
[the UI mockup](InvestorPreparationPreview.md).

Implementation update: saved-question explanations and the adaptive guided text workflow
are implemented. The existing small-workspace rehearsal JSON and Prisma queue transaction
store guided sessions/answers/turns, instead of adding the three separate tables proposed
below. Voice/video turn synchronization remains future work. See Architecture.md for the
implemented ownership and boundaries.

## Decision

Generate a new question and its public explanation together. For an adaptive turn, the same
structured generation produces the short coaching reply, the next question, and “Why?”.
Validate and persist the complete bundle before publishing it. Hovering reveals saved text;
it does not invoke a model. Post-session evaluation is a separate process.

The explanation is a concise, evidence-backed account of the learning objective, investor
context and relevant facts. Do not request, store or display private model chain-of-thought.

## Whole flow in ASCII

```text
BEFORE PRACTICE

  Selected investor       Saved company financials       Prior practice
         |                          |                         |
         +--------------------------+-------------------------+
                                    |
                       Freeze selected source snapshot
                       - research IDs + dates + labels
                       - financial facts + CSV locators
                       - missing inputs + limitations
                                    |
                       Generate preparation scenario
                       + opening question + Why bundle
                                    |
                       Validate -> save immutable version
                                    |
                       Founder starts guided practice
                                    |
                       Show opening question + [Why?]

DURING PRACTICE -- REPEAT FOR EACH COMPLETED ANSWER

  Founder answers
         |
  Save final answer + current question ID
         |
  Extract bounded claims from the answer
         |
  Deterministic checks against frozen evidence
         |   Is the number supported? Is data missing?
         |   Does this resolve an earlier issue?
         v
  Generate ONE structured next-turn bundle
  +----------------------------------------------------------+
  | decision: keep / clarify / correct / pivot / request data |
  | reply: short acknowledgement or coaching                  |
  | question: the next question to ask                        |
  | why: short explanation + details + evidence references    |
  +----------------------------------------------------------+
         |
  Validate bundle + apply evidence/pivot policy
         |
  Atomically save bundle + advance conversation revision
         |
         +------------------------------+
         |                              |
         v                              v
  Show reply + question + [Why?]   Optional speech adapter
         |                        speaks reply + question only
         |
  Hover / keyboard focus / tap
         |
  Read saved Why belonging to THIS question ID
  No extra model call

AFTER PRACTICE -- SEPARATE PIPELINE

  Saved authoritative transcript + frozen evaluation evidence
         |
  Existing post-practice evaluator
         |
  Versioned review: supported claims, gaps, KPI suggestions
  Does not rewrite earlier questions or their saved explanations
```

## When generation happens

```text
Time ------------------------------------------------------------>

Founder     [answers question 1]                    [answers Q2]
Server                         [check + generate]
Bundle                                           [Q2 + Why ready]
UI                                               [Q2] [Why?]
Speech                                           [speak Q2.....]
Hover                                                 [Why opens]
Eval                                                              ...after end
```

“Generate together” refers to one structured next-turn generation, not two competing calls
for question text and explanation text. A preceding extraction call may be needed to turn
free text into typed claims for deterministic financial checks. Reuse that extraction and
checking logic from evaluation without running the entire post-session report per answer.

For prewritten questions, generate Why when the scenario is created and reuse that bundle.
When choosing an existing branch, reuse its explanation only if question, source snapshot
and triggering context remain the same. A newly contextualized question requires a new
bundle. Every delivered turn gets its own server identity even when a template is reused.

Initially buffer the entire next-turn result. Show “Vicky is preparing the next question”
while it is pending. Do not stream unchecked financial statements and attach Why later.
After validation, text and optional speech can begin while the explanation is already available.
This introduces a wait before speech; measure generation and playback latency before promising
a conversational speed. Hover adds no inference latency.

## Proposed turn contract

Use strict Zod schemas and inferred TypeScript types. Separate model-proposed content from
server-assigned identity and lifecycle fields. Suggested persisted shape:

```text
PracticeTurn
  schemaVersion
  id                         server-issued UUID
  sessionId                  server-resolved workspace session
  sequence                   monotonic within that session
  parentAnswerId             null for the opening turn
  contextHash                frozen scenario/evidence version
  questionId                 server-issued ID
  decision                   keep | clarify | correct | pivot | request_evidence
  findingIds[]               allowlisted checked findings
  fromMetric / toMetric      optional canonical metric IDs
  reply                      public coaching text
  question                   exact question displayed/spoken
  why
    brief                    short hover/focus text, bounded to 240 characters
    investorContext          nullable public explanation + research references
    companyContext           public explanation + fact references
    connection               preparation hypothesis, not an asserted intention
    answerObjective          what the founder should be able to explain
    missingInputs[]          specific unavailable inputs
  provenance                 source references + preserved labels
  generation                 prompt/policy version + model + timestamp
  delivery                   not_started | playing | completed | interrupted
```

Financial references identify saved fact IDs and original snapshot/month/column/row locators.
Investor references must belong to the selected investor's frozen research. User claims also
reference their exact answer/claim IDs; a new founder statement remains self-reported.
Unknown currency and missing metrics stay explicit. General clarification questions may
have no numerical facts or investor references and should say they are general preparation.

Use server-rendered values or validated fact placeholders for numerical sentences. Never
accept model-authored arithmetic as a computed finding. Formula results are calculated using
Decimal.js before generation, with operand references and the reporting period retained.

## Validation and KPI policy

```text
Raw answer
    |
Exact quoted claim + candidate metric/period/unit
    |
Resolve ambiguity; compare with saved fact catalog
    |
    +-- Supported + relevant -----------------> KEEP
    +-- Meaning/period unclear ----------------> CLARIFY
    +-- Contradicted by available evidence ----> CORRECT
    +-- Valid but insufficient for conclusion -> PIVOT
    +-- Required data absent ------------------> REQUEST EVIDENCE
```

These are permitted decisions, not a claim that semantic relevance is deterministic. The
model proposes relevance and wording; code checks references, exact quotations, numerical
provenance, evidence availability and allowed transitions. Unsupported or ambiguous claims
cannot become asserted facts. A correction and an evidence request may coexist in the text;
the decision names the main next step.

Require a concrete gap for a pivot. A stronger investor preference is not enough by itself.
Consider what Vicky asked and whether the founder already corrected themselves. Track resolved
finding IDs to avoid repeating the same correction. Do not count repeated metrics alone as
fixation. Prefer one follow-up question per turn.

Reject nonexistent references, mismatched investors, missing Why for a delivered question,
invented figures and disallowed arithmetic. Valid references do not certify that the prose
interprets them correctly; retain uncertainty, review adversarial cases and display excerpts.
If validation fails, publish neither half of the bundle. Keep the previous turn visible and
offer Retry. A deterministic clarification can be a fallback only when it carries its own
valid explanation and is labeled as general clarification; never silently invent evidence.

## UI behavior

```text
VICKY
What would you need to explain July's operating loss?  [i Why?]
                                                      |
                                    hover / focus ----+
                                    +-----------------------------------+
                                    | Your net income includes a credit.|
                                    | This question separates that from |
                                    | the result of core operations.    |
                                    +-----------------------------------+
                                                      |
                                    click / tap ------+
                                    Opens full evidence panel
                                    1. Investor context
                                    2. Company source figures
                                    3. Why the connection matters
                                    4. What an answer should explain
```

Attach the button to each question, including historical questions in the current session.
Coaching statements without a question do not need a duplicate question button. The tooltip
uses `aria-describedby`, opens on hover or focus, stays available while hovered and closes
with Escape. It contains no interactive controls; the button opens the full panel on click
or tap. The panel manages focus and returns it to the same question button on close.
Do not use the browser's `title` attribute as the only explanation.

Key all UI state by session ID and question ID. Never use array position or “latest caption”
to associate Why. Changing selected history closes or updates the panel to that exact saved
question. A tooltip or panel opened during speech does not automatically mute or stop the
conversation; explicit playback controls remain available.

## API, persistence and race handling

Proposed guided text endpoints, under the existing local session/origin checks:

```text
POST /api/guided-practice/sessions
  { generationId, scenarioId, requestKey }
  -> frozen session + saved opening turn/Why

POST /api/guided-practice/sessions/:id/answers
  { questionId, text, expectedRevision, requestKey }
  -> 202: answerId + pending turn operation

GET /api/guided-practice/sessions/:id
  -> revision + ordered turns + pending/failure status

POST /api/guided-practice/sessions/:id/finish
  { expectedRevision, requestKey }
  -> finished session + queued post-practice evaluation
```

Server resolves workspace membership, saved selection and evidence. Browser requests cannot
supply financial facts, investor sources, model prompts or arbitrary session contexts.

Add Prisma-owned `GuidedPracticeSession`, `GuidedPracticeAnswer` and `GuidedPracticeTurn`
records with typed versioned JSON payloads and relational identity/revision fields. Scope
request keys to workspace/session/operation and require the same payload on replay. Use a
unique turn sequence per session and one active answer operation per current question.
Persist the answer, pending operation and existing durable workflow job atomically. Perform
provider calls outside database transactions; commit the result only with the current session
revision and valid worker lease. Commit question and Why together, then publish/read the result.

The session record freezes the source snapshot and does not rewrite `ScenarioGeneration`.
The new schemas are additive. Existing rehearsal sessions, hashes and v1/v2 contexts remain
readable without backfills. A guided-practice completion adapter must supply an ordered
authoritative text transcript and the same frozen evidence to the existing evaluator; it
must not pretend to be an ElevenLabs/LiveAvatar transcript receipt.

```text
Duplicate request key + identical payload -> return same operation/result
Same request key + changed payload         -> conflict
Answer for an old question/revision        -> conflict; show current state
Transient provider error                   -> bounded existing queue retries
Expired/reclaimed worker lease             -> old worker cannot publish
Session ended while generation pending     -> result cannot advance session
Late browser response after session switch -> ignore by session/question IDs
```

An unknown network outcome may replay a provider request and incur another provider charge;
local persistence prevents duplicate turns, not necessarily duplicate inference billing.
Cancel pending advancement when finishing; exclude undisplayed generated turns from the final
transcript. Do not describe a ready bundle as spoken until delivery has actually started.

## Voice/video boundary

Current repository behavior:

```text
Our server -- frozen context --> Provider conversation agent
                                      |
                               Provider chooses words
                                      |
Browser <---- audio/video + temporary captions
                                      |
Our server <---- authoritative final transcript
```

The adapters currently use ElevenLabs conversational tokens and LiveAvatar FULL mode.
Browser message handlers retain role/text previews, not application-owned question IDs.
This repository does not currently request a question/Why bundle per live provider turn.

The proposed reliable architecture is:

```text
Final speech transcription -> Our turn service -> saved question/Why bundle
                                                        |
                         +------------------------------+------------------+
                         |                                                 |
                  UI + Why button                         Speech/avatar transport
                                                          speaks supplied text
                                                          reports turn ID/delivery
```

The app must own what Vicky says, or use a provider integration that demonstrably requests
and preserves the same structured turn. Verify current provider APIs and supported modes
before selecting that transport. No particular callback, tool API or speech-only mode is
assumed in this spec. This may require a different integration from today's FULL agent flow.

Do not send the full explanation to the speech renderer. Speak only the validated reply
and question. Pin a server question ID to the playback request and retain actual delivery
state. If interrupted, keep its saved explanation attached to that interrupted question;
do not auto-advance or relabel it as completed. Finalize user speech only after an explicit
end-of-turn signal, not on interim caption fragments. Silence, reconnects and duplicate
callbacks must not create extra answers. Provider transcripts remain authoritative for the
existing modes; temporary browser captions cannot overwrite them.

For unchanged provider-controlled interviews, offer **Why this scenario?** live and the
existing review afterward. A separate model guessing Why from captions could disagree with
the actual question or hallucinate intent; it is not the proposed implementation.

## Delivery and ownership

1. Extend saved scenario output with versioned question/Why bundles and validation. Deliver the tooltip/panel on scenario questions first.
2. Add the guided text turn service, persistence, durable generation and source-aware pivot policy. Demonstrate free-text answers with synchronized questions and explanations.
3. Connect guided text completion to existing post-practice evaluation, preserving transcript and report history.
4. Verify a provider transport that lets the application own spoken turns, then add speech synchronization and interruption handling. Keep the existing modes usable during this work.

Suggested additions: `contracts/GuidedPractice.ts`, `features/PracticeTurnService.ts`,
`features/PracticeTurnProvider.ts`, `prompts/PracticeTurnPrompt.ts`,
`server/GuidedPracticeRoutes.ts` and `web/QuestionExplanation.tsx`.
Reuse the earlier plan's `PreparationFindings.ts` and `PreparationPolicy.ts`, existing
claim-checking helpers, queue leases and Prisma persistence conventions.

No fresh web research runs per answer. Use the frozen saved research and company evidence;
updated sources require a new preparation/session. Log only bounded operation IDs, duration,
status and failure categories; do not log private prompts, sources, answers or credentials.

## Acceptance checks

- Every displayed question has the exact saved Why from the same validated turn and snapshot.
- Hover/focus/tap never triggers inference; the explanation is available while speech plays.
- A generated question cannot appear before its explanation passes validation and is saved.
- Correct and relevant answers can produce `keep`; unclear answers can produce `clarify`.
- Corrections and pivots cite the relevant claim and facts. Missing inputs remain unknown.
- Same financial evidence with different supported investor themes changes emphasis, not facts.
- No research, conflicting research, fictional sources and unconfirmed currency remain labeled.
- Duplicate answers, stale responses, worker recovery and refresh preserve one ordered next turn.
- Finishing or switching sessions prevents pending work from updating the wrong conversation.
- Opening older questions shows their original Why after new research or a newer evaluation.
- Guided text sessions feed the evaluator without altering provider transcript authority.
- Voice integration is not marked complete until exact text/turn mapping, interruptions and delivery are verified with the selected transport.

After application implementation, run all repository-required lint, formatting, type, unit,
build and integration checks using provider doubles. This documentation-only draft needs
formatting and diff checks. No paid sessions, provider configuration changes or deployment
are required to produce the spec.
