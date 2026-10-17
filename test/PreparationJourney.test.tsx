import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import {
  preparationStateSchema,
  preparationGoalSchema,
} from '../src/contracts/FundraisingPreparation.js';
import {
  buildPreparationPlan,
  projectPreparationPlan,
} from '../src/features/PreparationPlanner.js';
import { buildJourney } from '../src/web/PreparationJourneyModel.js';
import { PreparationJourney } from '../src/web/PreparationJourney.js';

function fixture() {
  const { state } = preparationFixture();
  const goal = preparationGoalSchema.parse({
    id: randomUUID(),
    round: 'Series A',
    previousRounds: 2,
    amount: '2000000',
    currency: 'CAD' as const,
    targetDate: null,
    timezone: 'America/Toronto',
    investorId: null,
    confirmedAt: '2026-10-17T19:00:00.000Z',
  });
  const plan = buildPreparationPlan(state, goal, goal.confirmedAt);
  state.preparation = preparationStateSchema.parse({ goals: [goal], plans: [plan] });
  return { state, view: projectPreparationPlan(state, [], null) };
}
describe('visual preparation journey', () => {
  it('shows actual current state and available branches without inventing dates or a funding score', () => {
    const { view } = fixture();
    const nodes = buildJourney(view);
    expect(nodes.find((node) => node.id === 'current')?.detail).toContain('Tidewell.csv');
    expect(nodes.find((node) => node.id === 'financial')?.status).toBe('needs_review');
    expect(nodes.find((node) => node.id === 'investor')?.status).toBe('available');
    expect(nodes.find((node) => node.id === 'brief')).toMatchObject({
      status: 'blocked',
      action: 'investor',
    });
    expect(nodes.find((node) => node.id === 'rehearse')).toMatchObject({
      status: 'blocked',
      action: 'financial',
    });
    expect(nodes.find((node) => node.id === 'target')?.status).toBe('blocked');
  });
  it('routes stale-plan actions through refresh instead of approving outdated work', () => {
    const { view } = fixture();
    view.outdated = true;
    const nodes = buildJourney(view);
    expect(nodes.every((node) => node.action === 'refresh')).toBe(true);
    expect(nodes.find((node) => node.id === 'target')?.status).toBe('blocked');
  });
  it('marks the target reviewed only when every prerequisite is complete', () => {
    const { view } = fixture();
    for (const milestone of view.milestones) milestone.status = 'complete';
    expect(buildJourney(view).find((node) => node.id === 'target')?.status).toBe('complete');
    const rehearsal = view.milestones.find((node) => node.id === 'rehearse');
    if (!rehearsal) throw new Error('Missing milestone');
    rehearsal.status = 'available';
    expect(buildJourney(view).find((node) => node.id === 'target')?.status).toBe('blocked');
  });
  it('keeps equivalent keyboard-operable steps and next actions available while the chart loads', () => {
    const { view } = fixture();
    const html = renderToStaticMarkup(
      <PreparationJourney data={view} onAction={() => undefined} />,
    );
    expect(html).toContain('Next preparation actions');
    expect(html).toContain('Turn the financial review into your next action.');
    expect(html).toContain('Explore preparation steps');
    expect(html).toContain('Review prepared explanation');
    expect(html).toContain('Fictional demo evidence');
    expect(html).toContain('not funding probability');
    expect(html).not.toContain('2030');
    expect(html).not.toContain('100%');
  });
});
