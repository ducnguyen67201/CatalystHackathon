# Simple goal-to-investor interface

The main journey presents one decision at a time. Evidence, versions, settings and history
remain accessible through details controls. This is a presentation change to the same
saved goal and independent investor tracks; navigation never completes a review gate.

**Why this question?** uses a question card, a short explanation and numbered answer focus,
with cited sources beside them. Approved preparation shows its saved goal and exact story;
talking points, original sources and technical IDs are expandable. Financial sources show
three exact metric cards above the inspectable statement. The same saved explanations,
provenance and interview pause/resume behavior are retained; opening Why starts no AI job.

Saved-view polling keeps a steady clock across workspace revisions: connected preparation
and planning refresh every five seconds, goal progress every ten seconds, and the supporting
practice history every fifteen seconds. Explicit mutations retain their immediate refresh.
Simultaneous GETs for the same URL share a request, with separate schema validation and no
completed-response cache. Commands invalidate in-flight sharing for subsequent refreshes.
Local mode has no API request limits; hosted limits still pause requests for Retry-After. A selected practice scenario automatically
retries its read up to three times after that pause, cancels on navigation, and offers a manual
retry on failure. This recovery never starts or replays an interview, generation, or save.

```text
OVERVIEW                  RADAR                  PREPARATION
[Edit goal]                [Review investor]      [Approve story]
one goal + optional       fit + known gaps             |
funding details                |                 [Approve brief]
    |                     [Choose investor]           |
[Save goal]                    +-------------->  [Review inputs]
    |                                                 |
[Find investors]                                 [Create practice]
                                                      |
                                          choose Written / Voice / Video
                                                      |
                                                 [Review feedback]
                                                      |
                                           revision / retry / finish
                                                      |
OVERVIEW <---------------------------------------------+
saved history + current progress + next action
```

## Goal

**Edit goal** is beside the goal at the top of Overview. A short dialog asks what the
founder wants to achieve. **Funding details · optional** contains round, raise amount,
currency, date, desired individual check range, prior financing and timezone. Company
stage/sector/geography are shown with an edit-context link. One **Save goal** persists
the objective and structured funding details in one optimistic transaction. The editor
pins the version from opening so a background update cannot silently overwrite new data.
The stable journey, existing targets and prior graph points are preserved.

## Investor

Radar has a direct **Find investors** button, shared with Investor research. Its visible
status distinguishes queued, running, automatic retry, failure and completion. Preferences
are settings; saving them is separate from manually starting a search. Supported results
survive a later source failure, with partial coverage disclosed in the completion summary
and the immutable source archive. Searches with no accepted evidence still fail visibly.

Each Radar update has one **Review investor** action. That explicit action assesses saved
evidence, then opens a short match summary. It starts no external research. Numerical fit
requires the existing evidence/identity/freshness gates. Otherwise **Needs verification**
and the coverage label remain visible.

**Continue preparation** is a direct link to that target's server-projected next step,
including its exact cycle ID. Reopening saved preparation never requires a focus write,
approves a step or generates new work. Closing the panel and following the link again
reopens the same saved step. Missing-track fallbacks enter target preparation through its
existing story prerequisite; archived targets require an explicit resume.

**Research missing details** opens the selected investor in Investor research, where
**Check now** explicitly starts research. Returning to **Review investor** uses the saved
results. Exact criteria, goal, timestamps, rubric and source passages are under
**Match criteria, goal & sources**.

**Generate AI profile** provides tentative stage, sector, geography, individual check range
and priorities when supporting research is incomplete. The worker shows queued/running/retry
status and saves model, timestamp, public input and assumptions as an immutable estimate
version. The profile is labeled **AI estimate · unverified**; it never supplies mandate facts,
verified coverage, match scores, brief inputs or graph progress. Assumptions and public
context excerpts stay expandable. No goal, financial rows or private meeting notes are sent.
Identity or context changes mark older estimates outdated. Opening the profile only reads
saved data; generation and refresh require an explicit command.

The criteria comparison uses the current structured goal and fills research gaps with saved
AI estimates. Each row shows **Your goal**, **Investor criteria** and a labeled comparison:
**Potential match / Review estimate · AI estimate**, or an exact check-range comparison.
Stage labels compare conservatively; free-text sector and geography need review unless
they match exactly. No mention is never treated as exclusion. Different currencies are not
converted. Missing founder check details show **Add goal details**; no preferences remain
optional. Sourced results, conflicts and expired criteria take precedence. Earlier estimates
require refresh. Exact original assessment reasons and unknowns remain in **Saved research
assessment & gaps**. This display projection does not change saved scores or approvals.

The founder supplies a reason, explicitly acknowledges unverified/conflicting/excluded
criteria when required, then chooses **Choose investor & continue**. Selection saves the
target and opens its required preparation step directly. An existing target with a new
assessment must be explicitly selected again to pin that reviewed assessment. Monitoring
remains independent. Exclusion/archive controls are under **Investor details & options**.

## Story and brief

Tailored brief approval uses the same compact modal. Its overview shows the saved audience,
objective, conversation focus and questions, with a short eligibility gap when applicable.
**Full saved brief** and source cards retain the exact immutable approval text and evidence;
the overview is display-only and never regenerates or modifies the saved brief. One
**Approve & continue** opens practice using the existing version-checked command.

**Review company story** opens a centered, content-sized modal directly at the editable
story and one **Save & continue** action. When a target has no cycle yet, a read-only
preview uses the saved evidence; opening it does not save a pitch or advance progress.
Saving starts the cycle, checks the source hash, saves any edit and approves the exact
reviewed version before continuing to the brief. Sources and scope settings stay collapsed.
Missing financial evidence shows an add-evidence action instead of an invented draft.

Expanded **Sources & editing options** separates the **This investor / Whole goal** edit
scope from source cards. Each source opens independently to its exact saved excerpt,
recording metadata and original link when available. Longer drafting and approval notes
stay under **Review notes**; calculations remain a single secondary link.
Saved CSV rows appear as a field/value table with original currency strings and signs.
The unchanged original excerpt remains expandable; prose sources stay verbatim.

If the company story needs approval, target preparation opens it first. The founder can
edit the exact story and use one **Save & approve story** action. Saving an edit and
approving it retain separate version-checked mutations; approval only proceeds when the
reloaded story matches the submitted text and remains current. A failed approval leaves
the revision saved for review. Source passages and shared-versus-target edit scope are
under **Sources & editing options**.

A source-change banner provides **Refresh this step** in the same panel. Unsaved story
edits are retained for review; old sources, cycles and approvals remain in history.
Refreshing requires reviewing and approving current work again.

Story approval, exact source lineage and existing stale-input guards still apply to brief
approval. Expanding the full brief does not change its saved text or approval version.

## Practice and review

**Review practice inputs** shows the frozen input preview. **Create practice** explicitly
starts scenario generation; no generation occurs from opening the page. Choose written
practice or a voice/video conversation. Once ready, the compact panel automatically shows
the first scenario, its opening question and a suggested starting answer prepared verbatim
from the approved company story in the generation's frozen input. Scenario success criteria
remain under **What to cover**. No new model call, typing or answer submission is needed to
reach **Start AI interview**. Changing scenarios and writing an answer remain optional
details. The suggestion is a preparation aid; it never becomes a founder turn, a scored
practice or graph progress. Existing saved scenarios receive the same read-only guide
without rewriting their history. Missing approved story leaves the suggestion absent.
Provider configuration, transcript authority and paid-session consent stay unchanged.

Saved feedback shows the assessment summary, with **Full assessment, evidence & retries**
available on demand. **Reviewed · continue** still requires a completed saved assessment.
Revision decisions and no-gap completion retain their current server gates. The homepage
updates from the same saved events; session completion or wording acceptance alone does
not establish measured improvement.

## Overview and supporting tools

The goal, one next action and progress graph lead the homepage. With no target, the next
action is **Find investors**. Current progress and estimated preparation dates remain
separate. Filters, chronological tables, planning explanations and practice-evidence
tables are under **History, filters & planning details**. Clicking graph points still
opens exact historical evidence without changing current focus.

The graph stays visible even before a workspace starts goal tracking. That state shows
**Not tracked yet** and **Save goal to estimate**, with no invented points, reviewed counts
or dates. Saving the goal starts the recorded baseline. Local and hosted databases keep
their own saved histories; opening a local page never copies production progress.

Workspace settings, company evidence, deck claims, schedule assumptions, worker status,
legacy materials and the full checklist remain in supporting details controls. Email
settings and Radar filters are similarly secondary. Native details/dialog controls,
keyboard focus restoration, 44px summary targets and narrow-screen overflow are retained.

No new provider calls, credentials, migration or remote deployment are required by this
UI change. Validation is performed against local fixtures and disposable PostgreSQL.

## Verification record

Investor discovery requires confirmed company stage, sector and geography. When any is
missing, **Find investors** opens the company profile editor and names the missing fields
beside the button. Saving details does not manually start a search; the founder then clicks
**Find investors** to queue discovery. The button distinguishes queued from running searches.
Provider configuration and a full suggestion tray also have visible explanations. The profile
editor permits an unknown raise amount, consistent with the saved profile schema.

All six required checks pass: lint, formatting, type checking, unit tests, build and
PostgreSQL integration tests. The suites contain 375 unit tests and 45 integration tests.
Regressions cover an atomic objective/funding-detail update, stale edits and JSON-safe
worker drafts when optional source archive metadata is absent.

Fictional browser QA saved the goal and funding details together, reviewed and chose an
investor, saved/approved an edited story with one action, approved the brief, reviewed
practice inputs, generated a local scenario, selected written practice, saved the
assessment and finished the no-gap cycle. Current progress reached 6/6 while the original
0/6 point remained inspectable. A later fictional source revision reopened current work
without changing the earlier point. **Refresh this step** retained the unfinished story
draft. Voice/video mode exposed its separate start link without starting a paid session.
Browser errors were absent. No remote deployment or paid-provider validation was performed.

# Post-call homepage loop

Radar uses compact investor-first cards: name, saved-target status, news headline, and goal-fit
status lead each card. Public-source/identity warnings, fictional examples, historical items,
stale context and corrections remain visible. **News & sources** expands the full summary,
relevance explanation and exact quote; **Update options** retains read/dismiss/email actions.
The existing **Review investor** action opens the same match/target decision flow. Desktop
uses a two-column feed, while narrower screens stack cards. Search results retain full partial
research details under **Search details**, with queue/running/error states still visible.
Research status and optional company context share one secondary disclosure.

Investor research replaces the wide recommendation table with responsive cards. Each card
shows the saved recommendation label, evidence-coverage meter, observed stage/sector/geography,
source count and recorded gap count. Unknown values stay **Not confirmed**; the coverage meter
is separate from any available match score. **Why this investor & gaps** and **Sources** retain
all original reasoning, unknowns and exact excerpts. Inspect links open the matching tracked
investor’s research; preparation selection keeps its existing command and disabled states.
Funding suggestions use labeled company/deal facts, with whole-round amounts explicitly separate
from individual checks. Original funding quotes, search assumptions, schedules and check history
remain available on expand; fictional evidence stays labeled.

Meeting briefs use cards for both preparation cycles and the searchable brief/practice archive.
Story revisions, original review states, timestamps, linked-practice counts and historical cycle
links remain intact. Full cycle text stays under **Saved content**; archive cards open the same
review drawer. The drawer keeps financial figures visible as tiles, with saved explanations,
open questions, notes and supporting research behind labeled disclosures. Search, newest/oldest
sorting, refresh, practice and follow-up commands retain their existing behavior.

Follow-ups show page-scoped call, attention, pending-review and observed-improvement counts.
Each call has a collapsible header with its original date, review state and fictional/partial
labels. The latest call, calls with tasks and directly linked calls start expanded; other calls
remain inspectable in chronological order. Task cards retain the original status and written-retry
indicator, opening their full gap, preparation steps, evidence, response comparison and answer form.
Secondary financial/scenario/dismiss actions sit under **More actions**. Saved evaluations and
new research remain separate expandable sections; pagination and session/task deep links remain
available. These changes do not write progress, start reviews or modify evidence.

Overview fills the available workspace width with compact goal and metric cards. At desktop
widths, the history graph and pace scenarios sit beside a practice-feedback/Radar rail. Target
investors remain independent cards below. Tablet and phone layouts stack sections without
hiding data; the graph retains its own horizontal scroll. Reading widths on other pages are
unchanged. This arrangement changes presentation only, preserving all sources and progress.

The preparation graph has hover/focus guidance for saved points, the current marker and the
shaded estimate. Saved points explain the next step recorded at that time; their click/Enter
behavior still opens historical inspection. Current and forecast markers have touch and
keyboard controls; Escape dismisses guidance. A persistent next-step strip links to current
preparation, including the selected investor when the graph is filtered. Hover guidance is
presentation only: no approvals, progress, estimates or saved history are changed.

The graph also shows a current step breakdown and three recent saved milestones, with
investor attribution and direct historical inspection. Company story is counted once in
the goal view; investor filters show only that investor’s five steps. Transcript and assessment
processing remain visible even when the reviewed percentage is unchanged. A small legend
explains scope boundaries and the separate forecast, which includes the saved pace capacity.
Consecutive snapshots with unchanged displayed work share endpoint markers; their original
timestamps, line geometry and all history rows are retained. Goal, scope, work status, practice,
evidence lineage and pace changes remain distinct. Selecting a grouped snapshot in history
restores its marker. Checklist completion remains separate from speaking performance.

The homepage reads saved per-investor practice updates with the goal projection. After the
final transcript arrives, assessment publication updates the current checklist and saved graph
observations. The homepage polls every ten seconds while visible. It shows the latest call
status separately from the most recent completed assessment: strengths, explicitly assessed
retry improvements, and the next unresolved coaching question. No strength or percentage
improvement is invented for pending, partial, skipped, or failed assessments. A targeted practice
link opens the exact saved follow-up and question; full interview continuation still follows
current story/brief review gates. Finishing voice practice exposes a return to homepage action.

Each target keeps its own feedback and practice history. The feedback selector defaults to the
latest practiced investor, even if the founder has just chosen a different target. New Radar
leads appear separately under “Other investors to consider”; review opens the exact Radar event.
They change neither scope nor progress until explicitly added. Adding a target expands the
whole-goal denominator and estimated work, with a scope boundary in the history graph.

The homepage pace control saves Planned pace, 25% faster, or 25% slower through the existing
revision-checked journey command. The selected factor applies to daily work capacity, not
estimated effort or assessment quality. Current date, shaded forecast, comparison dates, and
the advanced selected-investor schedule all use that saved factor. Dates round up to calendar
days and honor the existing evidence-delivery dependency. Earlier graph snapshots retain their
original forecast; changing pace never awards completed steps. This is a planning assumption,
not learned speed. Reads start no provider work and local voice assessment still requires
delivery of the configured signed provider transcript callback.
