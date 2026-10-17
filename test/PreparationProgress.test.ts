import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';

describe('financial preparation progress', () => {
  it('uses saved claim checks by topic, preserves source figures and never mutates history', () => {
    const { state, project } = preparationFixture();
    const before = JSON.stringify(state);
    const result = project();
    expect(result.reviewedSessions).toBe(1);
    expect(result.counts).toMatchObject({
      assessed: 3,
      supported: 1,
      contradicted: 1,
      unresolved: 1,
      practised: 0,
      improved: 0,
    });
    expect(result.areas.find((area) => area.id === 'profitability')).toMatchObject({
      counts: { contradicted: 1, followups: 1, attention: 1 },
    });
    expect(result.areas.find((area) => area.id === 'margins')?.counts.assessed).toBe(0);
    expect(result.areas.find((area) => area.id === 'cash')?.facts).toEqual([]);
    expect(result.currentEvidence).toMatchObject({
      fileName: 'Tidewell.csv',
      fictional: true,
      period: '2026-09',
      sourceRow: 4,
    });
    expect(result.areas.find((area) => area.id === 'profitability')?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'operating_income',
          value: '-18000',
          period: '2026-09',
          sourceIds: ['financial:fictional-snapshot:4'],
        }),
      ]),
    );
    expect(JSON.stringify(state)).toBe(before);
  });

  it('separates saved retries from improvement, excludes retry sessions and preserves dismissal history', () => {
    const { state, session, evaluation, project } = preparationFixture();
    const retry = structuredClone(session);
    retry.id = randomUUID();
    const next = retry.evaluations[0];
    if (!next) throw new Error('Missing evaluation');
    next.id = randomUUID();
    next.parentEvaluationId = evaluation.id;
    next.parentItemId = 'profit-coaching';
    next.status = 'queued';
    session.evaluationResponses.push({
      id: retry.id,
      evaluationId: evaluation.id,
      itemId: 'profit-coaching',
      kind: 'practice',
      text: 'Fictional revised answer',
      createdAt: session.createdAt,
      requestKey: randomUUID(),
    });
    state.rehearsals.push(retry);
    expect(project().reviewedSessions).toBe(1);
    expect(project().counts).toMatchObject({ practised: 1, improved: 0, attention: 0 });
    next.status = 'completed';
    if (!next.report) throw new Error('Missing report');
    next.report.coaching.comparison = {
      outcome: 'improved',
      explanation: 'The retry separated operations from the credit.',
      turnIds: [],
    };
    expect(project().counts.improved).toBe(1);
    session.evaluationResponses.push({
      id: randomUUID(),
      evaluationId: evaluation.id,
      itemId: 'profit-coaching',
      kind: 'dismissed',
      text: '',
      createdAt: session.createdAt,
      requestKey: randomUUID(),
    });
    expect(project().counts).toMatchObject({
      followups: 1,
      practised: 1,
      improved: 0,
      attention: 0,
    });
    expect(project().areas.flatMap((area) => area.actions)).toEqual([]);
  });

  it('excludes queued, unavailable, active and superseded claims from assessment counts', () => {
    const { state, session, evaluation, project } = preparationFixture();
    if (!evaluation.report) throw new Error('Missing report');
    const claim = evaluation.report.extraction.claims.find((item) => item.id === 'profit');
    if (!claim) throw new Error('Missing claim');
    claim.supersededByTurnId = 'later-answer';
    expect(project().counts.assessed).toBe(2);
    const queued = { ...structuredClone(session), id: randomUUID() };
    const pendingReview = queued.evaluations[0];
    if (!pendingReview) throw new Error('Missing review');
    pendingReview.status = 'queued';
    pendingReview.report = null;
    state.rehearsals.push(
      queued,
      { ...structuredClone(session), id: randomUUID(), evaluations: [] },
      { ...structuredClone(session), id: randomUUID(), status: 'active' },
    );
    expect(project()).toMatchObject({
      reviewedSessions: 1,
      pendingSessions: 1,
      unavailableSessions: 1,
    });
    expect(project().counts.assessed).toBe(2);
  });

  it('does not infer current financial figures without a selected statement or count failed reviews as completed', () => {
    const { state, session, evaluation, jobs, project } = preparationFixture();
    state.onboarding.snapshotId = null;
    expect(project().currentEvidence.snapshotId).toBeNull();
    expect(project().areas.flatMap((area) => area.facts)).toEqual([]);
    evaluation.status = 'queued';
    evaluation.report = null;
    jobs.push({
      id: 'failed-review',
      kind: `evaluate:${session.id}:${evaluation.id}`,
      status: 'failed',
      attempts: 3,
      createdAt: session.createdAt,
      error: 'failed',
      result: null,
    });
    expect(project()).toMatchObject({
      reviewedSessions: 0,
      pendingSessions: 0,
      unavailableSessions: 1,
      counts: { assessed: 0, improved: 0 },
    });
  });

  it('covers history beyond one follow-ups page, bounds previews and preserves deep-link offsets', () => {
    const { state, session, project } = preparationFixture();
    for (let index = 0; index < 12; index++)
      state.rehearsals.push({
        ...structuredClone(session),
        id: randomUUID(),
        createdAt: `2026-10-${String(16 - index).padStart(2, '0')}T12:00:00.000Z`,
      });
    const result = project();
    expect(result.reviewedSessions).toBe(13);
    expect(result.counts.followups).toBe(13);
    expect(result.recentSessions).toHaveLength(5);
    expect(result.areas.find((area) => area.id === 'profitability')?.actions).toHaveLength(3);
    expect(result.areas.flatMap((area) => area.actions).every((action) => action.fictional)).toBe(
      true,
    );
    const latest = state.rehearsals[0];
    if (!latest) throw new Error('Missing session');
    latest.createdAt = '2026-09-01T00:00:00.000Z';
    for (const saved of state.rehearsals.slice(1)) saved.evaluations = [];
    const action = project().areas.flatMap((area) => area.actions)[0];
    expect(action).toMatchObject({ sessionId: latest.id, offset: 10 });
  });

  it('keeps frozen feedback distinct from a newer selected statement and does not fabricate strengths', () => {
    const { state, session, evaluation, project } = preparationFixture();
    const original = state.snapshots[0];
    if (!original) throw new Error('Missing snapshot');
    const updated = { ...structuredClone(original), id: 'new-snapshot', fileName: 'Current.csv' };
    const row = updated.rows.at(-1);
    if (!row) throw new Error('Missing row');
    row.revenue = '100000.1234';
    state.snapshots.push(updated);
    state.onboarding.snapshotId = updated.id;
    const result = project();
    expect(result.currentEvidence.snapshotId).toBe('new-snapshot');
    expect(result.areas.find((area) => area.id === 'revenue')?.facts[0]?.value).toBe('100000.1234');
    expect(result.areas.flatMap((area) => area.actions)[0]?.snapshotId).toBe(
      session.evaluationContext?.snapshotId,
    );
    expect(result.areas.flatMap((area) => area.strengths)).toEqual([]);
    if (!evaluation.report) throw new Error('Missing report');
    evaluation.report.coaching.strengths = [
      { statement: 'Revenue was supported.', claimIds: ['revenue'], turnIds: ['answer'] },
    ];
    session.status = 'partial';
    expect(project().areas.find((area) => area.id === 'revenue')?.strengths[0]).toMatchObject({
      statement: 'Revenue was supported.',
      quote: 'September revenue was CAD 92000.',
      fictional: true,
      partial: true,
    });
  });
});
