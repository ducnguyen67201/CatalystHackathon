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

/** Safe message for missing configuration; never contains credential values. */
export class ResearchConfigurationError extends Error {
  constructor() {
    super(
      'Research is not configured. Add EXA_API_KEY and OPENAI_API_KEY in Doppler, then restart the API and worker.',
    );
  }
}
