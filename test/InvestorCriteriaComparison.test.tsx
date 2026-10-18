import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  InvestorMatchInput,
  InvestorMatchAssessment,
} from '../src/contracts/InvestorMatch.js';
import type { InvestorProfileEstimateView } from '../src/contracts/InvestorProfileEstimate.js';
import { assessInvestorMatch } from '../src/features/InvestorMatch.js';
import { fictionalInvestorProfile } from './InvestorProfileFixtures.js';
import { compareInvestorCriteria } from '../src/web/InvestorCriteriaComparison.js';
import { InvestorCriteriaTable } from '../src/web/InvestorCriteriaTable.js';

const goal: InvestorMatchInput['goal'] = {
  round: 'Pre-seed',
  sector: 'Tech',
  geography: 'Toronto',
  desiredCheck: null,
  preferences: [],
};
function fixture() {
  const assessment = assessInvestorMatch({
    goal,
    identity: {
      investorId: randomUUID(),
      subjectKey: 'fictional-investor',
      status: 'needs_review',
    },
    facts: [],
    now: '2026-10-17T12:00:00.000Z',
  });
  const profile: InvestorProfileEstimateView = {
    ready: true,
    outdated: false,
    job: null,
    estimate: {
      id: randomUUID(),
      jobId: randomUUID(),
      provenance: 'ai_estimate',
      generatedAt: '2026-10-17T12:00:00.000Z',
      model: 'fictional-test-model',
      inputHash: 'a'.repeat(64),
      input: {
        investor: { id: randomUUID(), name: 'Fictional VC', url: null, profileLinks: [] },
        contextSources: [],
      },
      output: fictionalInvestorProfile(),
    },
  };
  return { assessment, profile };
}
function setState(
  assessment: InvestorMatchAssessment,
  criterion: string,
  state: InvestorMatchAssessment['criteria'][number]['state'],
) {
  return {
    ...assessment,
    criteria: assessment.criteria.map((row) =>
      row.criterion === criterion ? { ...row, state } : row,
    ),
  };
}

describe('investor goal comparison with AI estimates', () => {
  it('connects generated stage, sector and geography to the actual goal without claiming sourced eligibility', () => {
    const { assessment, profile } = fixture();
    const snapshot = structuredClone(assessment);
    const rows = compareInvestorCriteria(assessment, goal, profile);
    expect(rows[0]).toMatchObject({
      goal: 'Pre-seed',
      investor: 'Pre-seed and Seed',
      result: 'Potential match',
      basis: 'AI estimate',
    });
    expect(rows[1]).toMatchObject({
      goal: 'Tech',
      investor: 'Software',
      result: 'Review estimate',
      basis: 'AI estimate',
    });
    expect(rows[2]).toMatchObject({
      goal: 'Toronto',
      investor: 'North America',
      result: 'Review estimate',
      basis: 'AI estimate',
    });
    expect(assessment).toEqual(snapshot);
    expect(assessment.score).toBeNull();
    expect(assessment.coverage).toBe('0');
  });

  it('keeps missing founder input and optional preferences distinct from missing investor research', () => {
    const { assessment, profile } = fixture();
    const rows = compareInvestorCriteria(assessment, goal, profile);
    expect(rows[3]).toMatchObject({
      goal: 'Not set',
      investor: 'CAD 100000.25–500000.75 (AI estimate)',
      result: 'Add goal details',
      basis: 'Goal input',
    });
    expect(rows[4]).toMatchObject({ result: 'Not applicable', basis: 'Optional' });
    expect(compareInvestorCriteria(assessment, { ...goal, round: null }, profile)[0]?.result).toBe(
      'Add goal details',
    );
  });

  it('never overwrites sourced mismatches, conflicts or expired criteria with a positive estimate', () => {
    const { assessment, profile } = fixture();
    const mismatch = setState(assessment, 'stage', 'mismatch');
    expect(compareInvestorCriteria(mismatch, goal, profile)[0]).toMatchObject({
      result: 'Mismatch',
      basis: 'Sourced criteria',
    });
    expect(
      compareInvestorCriteria(setState(assessment, 'stage', 'conflict'), goal, profile)[0]?.result,
    ).toBe('Sources conflict');
    expect(
      compareInvestorCriteria(setState(assessment, 'stage', 'outdated'), goal, profile)[0]?.result,
    ).toBe('Research outdated');
    expect(compareInvestorCriteria(mismatch, goal, profile, true)[0]?.result).toBe(
      'Reassess saved match',
    );
  });

  it('requires fresh estimates and leaves abstained or missing output as research needed', () => {
    const { assessment, profile } = fixture();
    expect(
      compareInvestorCriteria(assessment, goal, { ...profile, outdated: true })[0]?.result,
    ).toBe('Refresh AI profile');
    expect(compareInvestorCriteria(assessment, goal, null)[0]?.result).toBe('Research needed');
    if (!profile.estimate) throw new Error('Missing test estimate.');
    profile.estimate.output.stage.value = null;
    expect(compareInvestorCriteria(assessment, goal, profile)[0]?.result).toBe('Research needed');
  });

  it('compares exact check ranges inclusively and never converts mismatched currencies', () => {
    const { assessment, profile } = fixture();
    const withCheck = {
      ...goal,
      desiredCheck: { min: '500000.7500', max: '500000.7501', currency: 'CAD' as const },
    };
    expect(compareInvestorCriteria(assessment, withCheck, profile)[3]?.result).toBe(
      'Estimated overlap',
    );
    expect(
      compareInvestorCriteria(
        assessment,
        { ...withCheck, desiredCheck: { ...withCheck.desiredCheck, min: '500000.7501' } },
        profile,
      )[3]?.result,
    ).toBe('Estimated mismatch');
    expect(
      compareInvestorCriteria(
        assessment,
        { ...withCheck, desiredCheck: { ...withCheck.desiredCheck, currency: 'USD' } },
        profile,
      )[3]?.result,
    ).toBe('Check currency');
  });

  it('does not equate pre-seed with seed or infer eligibility from negative prose', () => {
    const { assessment, profile } = fixture();
    if (!profile.estimate) throw new Error('Missing test estimate.');
    profile.estimate.output.stage.value = 'Pre-seed';
    expect(
      compareInvestorCriteria(assessment, { ...goal, round: 'Seed' }, profile)[0]?.result,
    ).toBe('Review estimate');
    profile.estimate.output.stage.value = 'Not Pre-seed; Seed only';
    expect(compareInvestorCriteria(assessment, goal, profile)[0]?.result).toBe('Review estimate');
    profile.estimate.output.stage.value = 'Beyond Pre-seed; mainly Series A';
    expect(compareInvestorCriteria(assessment, goal, profile)[0]?.result).toBe('Review estimate');
  });

  it('renders the connected comparison and retains exact saved research reasons under details', () => {
    const { assessment, profile } = fixture();
    const html = renderToStaticMarkup(
      <InvestorCriteriaTable assessment={assessment} goal={goal} profile={profile} />,
    );
    const table = html.split('</table>')[0];
    expect(table).toContain('Your goal');
    expect(table).toContain('Investor criteria');
    expect(table).toContain('Potential match');
    expect(table).toContain('AI estimate');
    expect(table).not.toContain('>unknown<');
    expect(html).toContain('Saved research assessment &amp; gaps');
    expect(html).toContain(assessment.criteria[0]?.reason);
  });
});
