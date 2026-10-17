import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { buildPreparationPlan } from '../src/features/PreparationPlanner.js';
import { PreparationComparisonChart } from '../src/web/PreparationPlan.js';

describe('preparation financial chart', () => {
  it('provides exact figures, period and CSV locator alongside accessible geometry', () => {
    const { state } = preparationFixture();
    const artifact = buildPreparationPlan(
      state,
      {
        id: randomUUID(),
        round: 'Series A',
        previousRounds: null,
        amount: null,
        currency: 'unspecified',
        targetDate: null,
        timezone: 'UTC',
        investorId: null,
        confirmedAt: '2026-10-17T18:00:00.000Z',
      },
      '2026-10-17T18:00:00.000Z',
    ).artifacts[0];
    if (!artifact) throw new Error('Missing artifact');
    const html = renderToStaticMarkup(<PreparationComparisonChart artifact={artifact} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('Exact source values');
    expect(html).toContain('-18000');
    expect(html).toContain('30000');
    expect(html).toContain('12000');
    expect(html).toContain('CSV row');
    expect(html).toContain('2026-09');
  });
});
