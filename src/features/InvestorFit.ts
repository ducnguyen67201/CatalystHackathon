import { Decimal } from 'decimal.js';
import type { Evidence, InvestorFit, Profile } from '../contracts/Workspace.js';
export function evaluateInvestorFit(profile: Profile, evidence: Evidence): InvestorFit {
  const compare = (value: string | null, target: string): 'aligned' | 'mismatch' | 'unknown' =>
    value === null
      ? 'unknown'
      : value.toLowerCase() === target.toLowerCase()
        ? 'aligned'
        : 'mismatch';
  const stage = compare(evidence.stage, profile.stage);
  const sector = compare(evidence.sector, profile.sector);
  const geography = compare(evidence.geography, profile.geography);
  const comparable = evidence.currency !== 'unspecified' && evidence.currency === profile.currency;
  const checkRange =
    !comparable || evidence.checkMin === null || evidence.checkMax === null
      ? 'unknown'
      : new Decimal(profile.raiseTarget).gte(evidence.checkMin) &&
          new Decimal(profile.raiseTarget).lte(evidence.checkMax)
        ? 'overlap'
        : 'participation';
  return {
    stage,
    sector,
    geography,
    checkRange,
    suitable: [stage, sector, geography].every((value) => value !== 'mismatch'),
  };
}
