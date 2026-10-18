import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GoalPosition, GoalProgressEvent } from '../src/contracts/GoalJourney.js';
import { GoalJourney, GoalJourneyChart } from '../src/web/GoalJourney.js';

const goalId = randomUUID();
const scopeId = randomUUID();
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
    expect(html).not.toContain('<path');
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
    expect(html).not.toContain('<path');
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
    expect(html).not.toContain('<path');
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
});
