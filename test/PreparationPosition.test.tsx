import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import {
  preparationGoalSchema,
  preparationStateSchema,
  preparationViewSchema,
} from '../src/contracts/FundraisingPreparation.js';
import { trackedInvestorSchema } from '../src/contracts/InvestorTracking.js';
import { jobSchema } from '../src/contracts/Workspace.js';
import {
  buildPreparationPlan,
  projectPreparationPlan,
} from '../src/features/PreparationPlanner.js';
import {
  preparationChangeLabels,
  projectPreparationPosition,
} from '../src/features/PreparationPosition.js';
import { PreparationPosition } from '../src/web/PreparationPosition.js';
const now = new Date('2026-10-17T18:00:00Z');
function fixture() {
  const { state } = preparationFixture();
  const investor = trackedInvestorSchema.parse({
    id: randomUUID(),
    key: 'fixture',
    name: 'Fictional Investor',
    url: 'https://example.com/investor',
    origin: 'added',
    discoveryEvidenceId: null,
    createdAt: now.toISOString(),
    frequency: 'paused',
    nextAt: null,
    checks: [],
  });
  state.investors.push(investor);
  const goal = preparationGoalSchema.parse({
    id: randomUUID(),
    round: 'Next round',
    previousRounds: null,
    amount: null,
    currency: 'CAD',
    targetDate: null,
    timezone: 'UTC',
    investorId: investor.id,
    confirmedAt: now.toISOString(),
  });
  const plan = buildPreparationPlan(state, goal, now.toISOString());
  state.preparation = preparationStateSchema.parse({
    goals: [goal],
    plans: [plan],
    automatic: true,
  });
  return { state, investor, goal, plan };
}
describe('live position from saved evidence', () => {
  it('reports the selected financial baseline and stale reason without writing or declaring new findings', () => {
    const { state, plan } = fixture();
    const before = structuredClone(state);
    const first = projectPreparationPlan(state, [], null);
    expect(first.position?.financial?.operatingIncome).toBe('-18000');
    expect(first.position?.pendingChanges).toEqual([]);
    expect(state).toEqual(before);
    state.onboarding.snapshotId = null;
    const changed = projectPreparationPlan(state, [], null);
    expect(changed.position?.financial).toBeNull();
    expect(changed.outdated).toBe(true);
    expect(changed.position?.pendingChanges).toEqual(['Selected financial baseline changed.']);
    expect(changed.plan).toEqual(plan);
  });
  it('records financial versus investor changes separately and ignores unrelated schedule bookkeeping', () => {
    const { state, goal, plan } = fixture();
    const manifest = plan.manifest;
    if (!manifest) throw new Error('Missing manifest');
    expect(preparationChangeLabels(manifest, { ...manifest, investor: 'changed' })).toEqual([
      'Selected investor or supporting research changed.',
    ]);
    state.investors[0]?.checks.push({
      jobId: 'check',
      checkedAt: now.toISOString(),
      profileVersion: state.profile.version,
      evidenceIds: [],
      addedIds: [],
      changedIds: [],
      note: 'No new evidence.',
    });
    const investor = state.investors[0];
    if (!investor) throw new Error('Missing investor');
    investor.nextAt = '2026-10-18T18:00:00Z';
    const next = buildPreparationPlan(state, goal, now.toISOString());
    expect(next.id).toBe(plan.id);
    expect(projectPreparationPlan(state, [], null).position?.investor?.status).toBe('checked');
  });
  it('does not present a failed or queued check as fresh successful research', () => {
    const { state, investor, goal, plan } = fixture();
    investor.checks.push({
      jobId: 'old',
      checkedAt: '2026-10-16T12:00:00Z',
      profileVersion: state.profile.version - 1 || 1,
      evidenceIds: [],
      addedIds: [],
      changedIds: [],
      note: 'Earlier check',
    });
    state.profile.version++;
    const job = jobSchema.parse({
      id: 'job',
      kind: `investor:${investor.id}`,
      status: 'failed',
      attempts: 1,
      createdAt: now.toISOString(),
      result: null,
      error: 'Check failed',
    });
    const position = projectPreparationPosition(
      state,
      [job],
      goal,
      plan,
      plan.manifest ?? null,
      true,
      now,
    );
    expect(position.investor).toMatchObject({
      status: 'failed',
      lastCheckedAt: '2026-10-16T12:00:00Z',
      currentProfile: false,
    });
    job.status = 'queued';
    expect(
      projectPreparationPosition(state, [job], goal, plan, null, true, now).investor?.status,
    ).toBe('queued');
  });
  it('discloses offline worker, connection loss and pending sources without clearing earlier work', () => {
    const { state } = fixture();
    state.onboarding.snapshotId = null;
    const data = preparationViewSchema.parse(projectPreparationPlan(state, [], null));
    const html = renderToStaticMarkup(
      <PreparationPosition
        data={data}
        receivedAt={now.toISOString()}
        connectionError="Cannot connect"
        notice="New saved evidence"
        busy={false}
        researchReady={false}
        onCheck={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    expect(html).toContain('Connection interrupted');
    expect(html).toContain('worker is offline');
    expect(html).toContain('Update from saved evidence');
    expect(html).toContain('Monitoring paused');
    expect(html).toContain('disabled');
    expect(html).not.toContain('checking now');
  });
});
