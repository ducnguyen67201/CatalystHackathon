import type { InvestorProfileEstimateOutput } from '../src/contracts/InvestorProfileEstimate.js';

/** Hypothetical test data only; never used by the application runtime. */
export function fictionalInvestorProfile(): InvestorProfileEstimateOutput {
  return {
    stage: { value: 'Pre-seed and Seed', basis: 'Hypothetical early-stage market assumption.' },
    sector: { value: 'Software', basis: 'Hypothetical technology investment focus.' },
    geography: {
      value: 'North America',
      basis: 'A broad hypothetical region; eligibility is unverified.',
    },
    checkSize: {
      range: { min: '100000.25', max: '500000.75', currency: 'CAD' },
      basis: 'Hypothetical individual check range, not a company round total.',
    },
    priorities: {
      value: 'Technical founders and early products',
      basis: 'Hypothetical priorities to confirm.',
    },
    confidence: 'low',
  };
}
