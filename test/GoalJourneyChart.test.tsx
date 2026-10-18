import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  GoalPosition,
  GoalProgressEvent,
  GoalTrackPosition,
} from '../src/contracts/GoalJourney.js';
import { GoalJourney, GoalJourneyChart } from '../src/web/GoalJourney.js';
import { chartInsights, preparationSteps } from '../src/web/GoalChartInsights.js';
import { GoalChartMilestones, GoalChartSteps } from '../src/web/GoalChartDetails.js';

const goalId = randomUUID();
const scopeId = randomUUID();
function plottedMarks(html: string) {
  const marks = html.match(
    /<svg[^>]*aria-label="Saved preparation history, current position, and separate remaining-work estimate"[^>]*>([\s\S]*?)<\/svg>/,
  )?.[1];
  if (!marks) throw new Error('Missing preparation plot');
  return marks;
}
function position(overrides: Partial<GoalPosition> = {}): GoalPosition {
  return {
    projectionVersion: 'goal-progress-v1',
    goalVersionId: goalId,
    scopeVersionId: scopeId,
    scopeVersion: 1,
    completed: 2,
    required: 6,
    percentage: '33.3',
    readiness: 'in_progress',
    nextAction: 'Review tailored brief',
    href: '/?preparationStep=brief',
    tracks: [],
    practices: [],
    remainingHours: '8',
    estimatedReadyDate: '2026-10-24',
    estimateReason: 'Founder-estimated effort at two hours per day.',
    ...overrides,
  };
}
function observation(sequence: number, savedPosition: GoalPosition): GoalProgressEvent {
  return {
    id: randomUUID(),
    journeyId: goalId,
    sequence,
    recordedAt: `2026-10-${sequence + 17}T12:00:00.000Z`,
    reason: sequence === 1 ? 'Current baseline' : 'A second investor expands preparation scope',
    fingerprint: `saved-position-${sequence}`,
    position: savedPosition,
  };
}

function investorTrack(overrides: Partial<GoalTrackPosition> = {}): GoalTrackPosition {
  return {
    targetId: randomUUID(),
    investorId: randomUUID(),
    name: 'Fictional investor',
    cycleId: null,
    pitchId: null,
    briefVersionId: null,
    sessionId: null,
    evaluationId: null,
    fictional: true,
    outdated: false,
    hasGaps: false,
    completed: 2,
    required: 5,
    nextAction: 'Practise with this investor',
    href: '/',
    steps: preparationSteps.map(({ id }, index) => ({
      id,
      complete: index < 3,
      status: index < 3 ? 'complete' : 'blocked',
      reason: `Saved ${id} step`,
    })),
    ...overrides,
  };
}

describe('goal journey history graph', () => {
  it('keeps the homepage graph mounted before goal tracking starts', () => {
    const html = renderToStaticMarkup(<GoalJourney revision={0} onEditGoal={() => undefined} />);
    expect(html).toContain(
      'Saved preparation history, current position, and separate remaining-work estimate',
    );
    expect(html).toContain('Recorded history');
    expect(html).toContain('Current');
    expect(html).toContain('Planned remaining work');
    expect(html).toContain('Set goal');
  });

  it('shows an untracked graph without inventing counts, dates or historical points', () => {
    const html = renderToStaticMarkup(
      <GoalJourneyChart position={null} events={[]} onSelect={() => undefined} />,
    );
    expect(html).toContain('Not tracked yet');
    expect(html).toContain('Save goal to estimate');
    expect(html).toContain('No saved observations yet');
    expect(html).not.toContain('role="button"');
    expect(plottedMarks(html)).not.toContain('<path');
    expect(html).not.toContain('0/6');
    expect(html).not.toContain('2026-');
  });

  it('preserves original denominators and breaks the line when the scope changes', () => {
    const initial = observation(1, position({ completed: 4, percentage: '66.7' }));
    const expanded = observation(
      2,
      position({
        scopeVersionId: randomUUID(),
        scopeVersion: 2,
        completed: 4,
        required: 11,
        percentage: '36.4',
      }),
    );
    const html = renderToStaticMarkup(
      <GoalJourneyChart
        events={[expanded, initial]}
        position={expanded.position}
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('4 of 6 reviewed');
    expect(html).toContain('4 of 11 reviewed');
    expect(html).toContain('Goal or preparation scope changed');
    expect(plottedMarks(html)).not.toContain('<path');
    expect(html.match(/role="button"/g)).toHaveLength(2);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('Planned remaining work');
    expect(html).toContain('Estimate · not recorded progress');
    expect(html).toContain('8 estimated hours');
  });

  it('draws a step between saved observations without manufacturing intermediate points', () => {
    const first = observation(1, position());
    const second = observation(2, position({ completed: 3, percentage: '50' }));
    const html = renderToStaticMarkup(
      <GoalJourneyChart
        events={[first, second]}
        position={second.position}
        selectedId={first.id}
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('M 65 152.05 H 630 V 127');
    expect(html.match(/role="button"/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('3/6 reviewed');
  });

  it('shows current preparation separately when no historical observations exist', () => {
    const html = renderToStaticMarkup(
      <GoalJourneyChart events={[]} position={position()} onSelect={() => undefined} />,
    );
    expect(html).toContain('No saved observations yet');
    expect(html).toContain('2/6 reviewed');
    expect(html).not.toContain('role="button"');
    expect(plottedMarks(html)).not.toContain('<path');
    expect(html).toContain('Explain my current preparation and next step');
    expect(html).toContain('Explain the preparation forecast and how to adjust pace');
  });

  it('filters to the selected target without presenting a goal estimate as target-specific', () => {
    const targetId = randomUUID();
    const track = {
      targetId,
      investorId: randomUUID(),
      name: 'Fictional investor',
      cycleId: null,
      pitchId: null,
      briefVersionId: null,
      sessionId: null,
      evaluationId: null,
      fictional: true,
      outdated: false,
      hasGaps: true,
      steps: [],
      completed: 3,
      required: 6,
      nextAction: 'Review feedback',
      href: '/',
    };
    const savedPosition = position({
      tracks: [track],
      completed: 5,
      required: 11,
      percentage: '45.5',
    });
    const html = renderToStaticMarkup(
      <GoalJourneyChart
        events={[observation(1, savedPosition)]}
        position={savedPosition}
        targetId={targetId}
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('3 of 6 reviewed');
    expect(html).not.toContain('5 of 11 reviewed');
    expect(html).toContain('planning estimate remains goal-wide');
    expect(html).toContain('selected investor track');
  });

  it('groups only interior unchanged markers and preserves every original observation', () => {
    const saved = position();
    const events = [1, 2, 3, 4].map((sequence) => observation(sequence, saved));
    const original = JSON.stringify(events);
    const points = chartInsights(events, '');
    expect(points.map((point) => point.showMarker)).toEqual([true, false, false, true]);
    expect(points.map((point) => point.event)).toEqual(events);
    expect(JSON.stringify(events)).toBe(original);
    const html = renderToStaticMarkup(
      <GoalJourneyChart events={events} position={saved} onSelect={() => undefined} />,
    );
    expect(html).toContain('2 unchanged snapshots grouped');
    expect(html.match(/role="button"/g)).toHaveLength(2);
    expect(chartInsights(events, '', events[1]?.id)[1]?.showMarker).toBe(true);
  });

  it('retains transcript and assessment milestones even when the percentage stays flat', () => {
    const track = investorTrack();
    const waiting = {
      ...track,
      sessionId: randomUUID(),
      steps: track.steps.map((step) =>
        step.id === 'practice' ? { ...step, status: 'running' as const } : step,
      ),
    };
    const feedback = {
      ...waiting,
      steps: waiting.steps.map((step) =>
        step.id === 'feedback'
          ? { ...step, status: 'running' as const }
          : { ...step, status: step.id === 'practice' ? ('ready' as const) : step.status },
      ),
    };
    const events = [track, waiting, feedback].map((item, index) =>
      observation(index + 1, position({ tracks: [item] })),
    );
    const points = chartInsights(events, '');
    expect(points.map((point) => point.milestone)).toEqual([true, true, true]);
    expect(points[1]?.label).toBe('Call saved · transcript pending');
    expect(points[2]?.label).toBe('Assessment processing');
  });

  it('names the actual investor step reviewed and distinguishes a changed plan from lost work', () => {
    const track = investorTrack();
    const initial = observation(1, position({ tracks: [track] }));
    const reviewed = observation(
      2,
      position({
        tracks: [
          {
            ...track,
            steps: track.steps.map((step) =>
              step.id === 'practice'
                ? { ...step, complete: true, status: 'complete' as const }
                : step,
            ),
          },
        ],
      }),
    );
    const expanded = observation(3, position({ required: 11, scopeVersionId: randomUUID() }));
    const points = chartInsights([initial, reviewed, expanded], '');
    expect(points[1]?.label).toBe('Practice saved');
    expect(points[1]?.detail).toBe('Fictional investor');
    expect(points[2]?.label).toBe('Plan changed');
    expect(points[2]?.detail).toContain('6 → 11 goal steps');
  });

  it('keeps pace changes visible without labeling them as performance improvement', () => {
    const points = chartInsights(
      [observation(1, position()), observation(2, position({ pace: 1.25 }))],
      '',
    );
    expect(points[1]?.showMarker).toBe(true);
    expect(points[1]?.label).toBe('Planning pace updated');
    expect(points[1]?.detail).toContain('reviewed work did not');
  });

  it('does not attribute another investor’s completed practice to the selected investor', () => {
    const a16z = investorTrack({ name: 'Fictional a16z' });
    const yc = investorTrack({ name: 'Fictional YC' });
    const ycPractised = {
      ...yc,
      completed: 3,
      steps: yc.steps.map((step) =>
        step.id === 'practice' ? { ...step, complete: true, status: 'complete' as const } : step,
      ),
    };
    const events = [
      observation(1, position({ tracks: [a16z, yc] })),
      observation(2, position({ tracks: [a16z, ycPractised], completed: 3 })),
    ];
    expect(chartInsights(events, a16z.targetId)[1]?.milestone).toBe(false);
    expect(chartInsights(events, yc.targetId)[1]?.label).toBe('Practice saved');
  });

  it('counts the shared story once and shows pending transcript as unfinished work', () => {
    const track = investorTrack();
    const pending = {
      ...track,
      steps: track.steps.map((step) =>
        step.id === 'practice' ? { ...step, status: 'running' as const } : step,
      ),
    };
    const html = renderToStaticMarkup(
      <GoalChartSteps position={position({ tracks: [pending, investorTrack()] })} targetId="" />,
    );
    expect(html.match(/Company story/g)).toHaveLength(1);
    expect(html).toContain('Waiting for transcript');
    expect(html).toContain('data-state="waiting"');
    expect(html.match(/data-state="complete"/g)).toHaveLength(3);
    expect(html).toContain('aria-current="step"');
    const scoped = renderToStaticMarkup(
      <GoalChartSteps position={position({ tracks: [pending] })} targetId={pending.targetId} />,
    );
    expect(scoped).not.toContain('Company story');
  });

  it('shows distinct recent milestones instead of repeating rapid pace changes', () => {
    const track = investorTrack();
    const before = {
      ...track,
      steps: track.steps.map((step) =>
        step.id === 'brief' ? { ...step, complete: false, status: 'needs_review' as const } : step,
      ),
    };
    const events = [
      observation(1, position({ tracks: [before] })),
      observation(2, position({ tracks: [track] })),
      observation(3, position({ tracks: [track], pace: 0.75 })),
      observation(4, position({ tracks: [track], pace: 1.25 })),
    ];
    const html = renderToStaticMarkup(
      <GoalChartMilestones insights={chartInsights(events, '')} onSelect={() => undefined} />,
    );
    expect(html.match(/Planning pace updated/g)).toHaveLength(1);
    expect(html).toContain('Brief approved');
    expect(html).toContain('Fictional investor');
  });
});
