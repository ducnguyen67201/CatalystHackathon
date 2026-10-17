import {
  SuggestionStatus,
  suggestionLimit,
  type InvestorSuggestion,
} from '../contracts/InvestorDiscovery.js';
import type { Evidence, Workspace } from '../contracts/Workspace.js';

export function investorNameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

interface DiscoveryProfile {
  stage: string | null;
  sector: string;
  geography: string;
}

export function hasDiscoveryProfile(profile: DiscoveryProfile): boolean {
  return Boolean(profile.stage && profile.sector.trim() && profile.geography.trim());
}

/** Stale suggestions stay in history, but never appear as current recommendations. */
export function listCurrentSuggestions(
  state: Pick<Workspace, 'profile' | 'investors' | 'discovery'>,
): InvestorSuggestion[] {
  const tracked = new Set(state.investors.map((investor) => investorNameKey(investor.name)));
  return state.discovery.suggestions
    .filter(
      (suggestion) =>
        suggestion.status === SuggestionStatus.SUGGESTED &&
        suggestion.profileVersion === state.profile.version &&
        !tracked.has(investorNameKey(suggestion.name)),
    )
    .slice(0, suggestionLimit);
}

export function supportsComparableCompany(profile: DiscoveryProfile, evidence: Evidence): boolean {
  const deal = evidence.comparableDeal;
  if (!deal || !profile.stage || !profile.sector) {
    return false;
  }
  return (
    deal.stage.toLowerCase() === profile.stage.toLowerCase() &&
    deal.sector.toLowerCase() === profile.sector.toLowerCase()
  );
}
