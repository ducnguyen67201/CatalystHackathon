# CFO timeline concept

Status: standalone interactive HTML mock; no production implementation changes.
Open [the mock](previews/CfoTimelinePreview.html).

The overview connects four questions: current operating performance, the founder's target,
conditional preparation timing, and missing evidence. The main timeline shows accountable
owners, completed work, planned work and an evidence-dependent workstream. Selecting a row
opens its current status, why it matters, June's prepared work, expected result and completion
criteria. The financial review tab provides a statement-style comparison matching the latest
visual direction.

Try these interactions:

1. Switch between balanced preparation, meeting-first preparation and evidence-first preparation.
2. Remove either planning assumption. Expected completion becomes unavailable while the
   conversation target remains unchanged; dependent work shows an evidence blocker.
3. Select the financial-explanation row, inspect the proposed work and mark it reviewed in
   the mock. The next action and preparation count change; historical figures do not.
4. Switch to Financial review; open its linked preparation action.
5. Reset the mock to return to the starting state. Tab controls support arrow-key navigation;
   timeline bars and row labels are keyboard-operable, and the schedule scrolls on small screens.

All company figures, investors, tasks, dates and agent activity are fictional. Financial
values and dates are authored examples, not model outputs or working calculations. Timeline
completion dates illustrate explicit assumptions; they are not investment closing dates.
The cash-delivery checkbox is an assumption and never marks cash evidence verified. Marking
other rows reviewed simulates a UI decision and does not provide a real assessment.

The mock is self-contained, uses no remote assets and makes no research, model, provider,
email, database or paid-session requests. State lives in page memory and resets on reload.

The assumptions panel now has a **You’re right here** line: a solid current-position marker,
a dashed conditional path, an expected-date marker and a separate conversation-target line.
Switching plans moves the expected marker. Removing a critical assumption shortens the path
and replaces the estimated date with **Date unknown**. The accompanying sentence states
where the founder is now and what must hold to reach the expected preparation state.

## Compact overview

The default overview now shows active work only (five initial rows). Completed steps and the
conversation row remain behind **Show full schedule (8 steps)**. Current and expected position
are summarized beside the timeline title. Assumptions, the conditional-position line, A/B/C
outcomes and agent activity open in **Assumptions & expected outcome** instead of stacking
below the schedule. Task details still open separately. Text size remains readable; the
layout removes repeated context and uses disclosure rather than simply shrinking everything.

## Pace and recovery scenarios

The compact schedule footer shows on track, ahead, at risk (no buffer), behind target,
or unknown. **Pace · what if** models 1.5, 2 or 2.5 founder hours per day (0.75×, 1×,
1.25×). These are fictional availability scenarios, not observed productivity. The estimate
is 17 October plus remaining authored plan days divided by pace, rounded up: balanced 5,
meeting-first 4, evidence-first 6. The timeline stretches future founder work; completed work,
external cash evidence and the conversation target stay fixed. Late scenarios extend the
calendar to 25 October. Reviewing mock tasks does not fabricate a new velocity measurement.

At slower balanced pace, completion moves to 24 October, one day after the target. The
footer names what to do now and offers **Model 2 h/day** to compare recovery; this changes
only the assumption. Removing a critical input suppresses both the date and pace judgment.
Real measured velocity would require completed-work timestamps, effort estimates and enough
history; no such measurement or background monitoring is claimed by this HTML mock.
