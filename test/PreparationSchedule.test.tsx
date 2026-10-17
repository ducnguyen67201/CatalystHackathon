import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import {
  preparationGoalSchema,
  preparationScheduleSchema,
  preparationStateSchema,
  preparationViewSchema,
} from '../src/contracts/FundraisingPreparation.js';
import {
  buildPreparationPlan,
  projectPreparationPlan,
} from '../src/features/PreparationPlanner.js';
import { preparationDay, projectSchedule } from '../src/web/PreparationScheduleModel.js';
import { PreparationSchedule } from '../src/web/PreparationSchedule.js';
const now = new Date('2026-10-17T18:00:00Z');
function fixture() {
  const { state } = preparationFixture();
  const goal = preparationGoalSchema.parse({
    id: randomUUID(),
    round: 'Series A',
    previousRounds: 2,
    amount: null,
    currency: 'CAD',
    targetDate: '2026-10-23',
    timezone: 'America/Toronto',
    investorId: null,
    confirmedAt: now.toISOString(),
  });
  const plan = buildPreparationPlan(state, goal, now.toISOString());
  const schedule = preparationScheduleSchema.parse({
    id: randomUUID(),
    goalId: goal.id,
    planId: plan.id,
    confirmedAt: now.toISOString(),
    dailyHours: 2,
    cashExpectedDate: '2026-10-19',
    hours: { financial: 2, investor: 2, brief: 2, rehearse: 4 },
  });
  state.preparation = preparationStateSchema.parse({
    goals: [goal],
    plans: [plan],
    schedules: [schedule],
  });
  return preparationViewSchema.parse(projectPreparationPlan(state, [], null));
}
describe('conditional preparation schedule', () => {
  it('models pace, target buffer and recovery without changing saved assumptions', () => {
    const view = fixture();
    const before = structuredClone(view);
    expect(projectSchedule(view, 1, now)).toMatchObject({
      finish: '2026-10-22',
      tone: 'on_track',
      buffer: 1,
    });
    expect(projectSchedule(view, 0.75, now)).toMatchObject({
      finish: '2026-10-24',
      tone: 'behind',
      buffer: -1,
    });
    expect(projectSchedule(view, 1.25, now)).toMatchObject({ finish: '2026-10-22', tone: 'ahead' });
    expect(view).toEqual(before);
  });
  it('does not label a plan on track without a target, source freshness, or confirmed delivery', () => {
    const view = fixture();
    if (!view.goal || !view.schedule) throw new Error('Missing scheduling fixture');
    view.goal.targetDate = null;
    expect(projectSchedule(view, 1, now).tone).toBe('unknown');
    view.outdated = true;
    expect(projectSchedule(view, 1, now).finish).toBeNull();
    view.outdated = false;
    view.schedule.cashExpectedDate = '2026-10-16';
    expect(projectSchedule(view, 1, now).finish).toBeNull();
    view.schedule.cashExpectedDate = null;
    expect(projectSchedule(view, 1, now).tone).toBe('unknown');
    view.schedule.planId = 'earlier';
    expect(projectSchedule(view, 1, now).suggested).toBe(true);
  });
  it('recalculates remaining work, waits for external evidence, and uses the goal timezone', () => {
    const view = fixture();
    const financial = view.milestones.find((row) => row.id === 'financial');
    if (!financial || !view.schedule) throw new Error('Missing scheduling fixture');
    financial.status = 'complete';
    // Cash delivery remains the earliest brief start even when founder work is faster.
    expect(projectSchedule(view, 1, now).finish).toBe('2026-10-22');
    view.schedule.cashExpectedDate = '2026-10-23';
    expect(projectSchedule(view, 1, now).finish).toBe('2026-10-26');
    expect(preparationDay(new Date('2026-10-18T01:00:00Z'), 'America/Toronto')).toBe('2026-10-17');
    expect(preparationDay(new Date('2026-03-09T03:00:00Z'), 'America/Toronto')).toBe('2026-03-08');
  });
  it('counts unique current accepted reviews and excludes repeats, future and revoked decisions', () => {
    const view = fixture();
    if (!view.plan) throw new Error('Missing plan');
    const decision = {
      id: randomUUID(),
      planId: view.plan.id,
      artifactId: 'a',
      kind: 'accepted' as const,
      note: '',
      createdAt: '2026-10-17T12:00:00Z',
    };
    view.decisions = [decision, { ...decision, id: randomUUID() }];
    expect(projectSchedule(view, 1, now).reviewed).toBe(1);
    view.decisions.push({ ...decision, id: randomUUID(), kind: 'rejected' });
    expect(projectSchedule(view, 1, now).reviewed).toBe(0);
    view.decisions.push({
      ...decision,
      artifactId: 'future',
      id: randomUUID(),
      createdAt: '2026-10-18T12:00:00Z',
    });
    view.decisions.push({
      ...decision,
      artifactId: 'old',
      id: randomUUID(),
      createdAt: '2026-10-01T12:00:00Z',
    });
    expect(projectSchedule(view, 1, now).reviewed).toBe(0);
  });
  it('suggests an editable plan without asking for hours and renders accessible actions', () => {
    const view = fixture();
    view.schedule = null;
    expect(projectSchedule(view, 1, now)).toMatchObject({ suggested: true, finish: '2026-10-22' });
    const html = renderToStaticMarkup(
      <PreparationSchedule
        data={view}
        busy={false}
        onSave={() => Promise.resolve()}
        onAction={() => undefined}
        onFinancialReview={() => undefined}
        operatingResult="-48531"
        period="2026-09"
        currency="Unconfirmed"
      />,
    );
    expect(html).toContain('June’s suggested estimate');
    expect(html).toContain('scope="row"');
    expect(html).toContain('Review suggested plan');
    expect(html).toContain('Fictional demo evidence');
    view.goal = null;
    expect(projectSchedule(view, 1, now).finish).toBeNull();
  });
});
