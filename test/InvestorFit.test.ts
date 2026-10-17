import { describe, it, expect } from 'vitest';
import { ResearchFixture } from './fixtures/ResearchFixture.js';
import { evaluateInvestorFit } from '../src/features/InvestorFit.js';
import type { Profile } from '../src/contracts/Workspace.js';
const profile: Profile = {
  name: 'Example',
  stage: 'Seed',
  sector: 'B2B software',
  geography: 'Canada',
  raiseTarget: '1000000',
  currency: 'unspecified',
  goal: '',
  version: 1,
  watchlist: [],
};
describe('Investor fit', () => {
  it('leaves currency comparisons unknown until both currencies are known and equal', async () => {
    const [evidence] = await new ResearchFixture().discover(profile);
    if (!evidence) {
      throw new Error('Missing fixture');
    }
    expect(evaluateInvestorFit(profile, evidence).checkRange).toBe('unknown');
    expect(evaluateInvestorFit({ ...profile, currency: 'CAD' }, evidence).checkRange).toBe(
      'overlap',
    );
    expect(evaluateInvestorFit({ ...profile, currency: 'USD' }, evidence).checkRange).toBe(
      'unknown',
    );
  });
  it('rejects a mismatching stage and leaves missing stage unknown', async () => {
    const [evidence] = await new ResearchFixture().discover(profile);
    if (!evidence) {
      throw new Error('Missing fixture');
    }
    expect(evaluateInvestorFit({ ...profile, stage: 'Series B' }, evidence).suitable).toBe(false);
    expect(evaluateInvestorFit(profile, { ...evidence, stage: null }).stage).toBe('unknown');
  });
});
