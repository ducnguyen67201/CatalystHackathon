import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import {
  preparationGoalSchema,
  preparationStateSchema,
  preparationViewSchema,
} from '../src/contracts/FundraisingPreparation.js';
import {
  buildPreparationPlan,
  projectPreparationPlan,
} from '../src/features/PreparationPlanner.js';
import { PreparationRecommendationBasis } from '../src/web/PreparationRecommendationBasis.js';
function view() {
  const { state } = preparationFixture();
  state.profile.goal = 'Raise our next round';
  const goal = preparationGoalSchema.parse({
    id: randomUUID(),
    round: 'Next round',
    previousRounds: null,
    amount: '2000000',
    currency: 'CAD',
    targetDate: null,
    timezone: 'UTC',
    investorId: null,
    confirmedAt: '2026-10-17T12:00:00Z',
  });
  state.preparation = preparationStateSchema.parse({
    goals: [goal],
    plans: [buildPreparationPlan(state, goal, goal.confirmedAt)],
  });
  return preparationViewSchema.parse(projectPreparationPlan(state, [], null));
}
describe('preparation recommendation evidence', () => {
  it('connects recommendations to exact source facts and distinguishes estimates from evidence', () => {
    const html = renderToStaticMarkup(
      <PreparationRecommendationBasis data={view()} onEvidence={() => undefined} />,
    );
    expect(html).toContain('Raise our next round');
    expect(html).toContain('Tidewell.csv');
    expect(html).toContain('CSV row');
    expect(html).toContain('-18000');
    expect(html).toContain('Fictional demo evidence');
    expect(html).toContain('not derived from your financials');
    expect(html).toContain('entered by you');
    expect(html).toContain('has not calculated an alternative amount');
    expect(html).toContain('cash-flow forecast');
  });
  it('explains the actual investor-selection gate after financial review and flags stale sources', () => {
    const data = view();
    const financial = data.milestones.find((item) => item.id === 'financial');
    if (!financial) throw new Error('Missing milestone');
    financial.status = 'complete';
    let html = renderToStaticMarkup(
      <PreparationRecommendationBasis data={data} onEvidence={() => undefined} />,
    );
    expect(html).toContain('no investor is selected');
    data.outdated = true;
    html = renderToStaticMarkup(
      <PreparationRecommendationBasis data={data} onEvidence={() => undefined} />,
    );
    expect(html).toContain('Saved inputs changed');
    expect(html).toContain('disabled');
  });
});
