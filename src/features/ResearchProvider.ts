import type { ResearchDiscoveryContext } from '../contracts/InvestorDiscovery.js';
import type { Evidence, Profile } from '../contracts/Workspace.js';
import type { InvestorResearchTarget } from '../contracts/InvestorTracking.js';

export interface ResearchProvider {
  readonly mode?: 'demo' | 'live';
  discover(
    profile: Profile,
    target?: InvestorResearchTarget,
    discovery?: ResearchDiscoveryContext,
  ): Promise<Evidence[]>;
}
