import type { Evidence, Profile } from '../contracts/Workspace.js';
import type { InvestorResearchTarget } from '../contracts/InvestorTracking.js';

export interface ResearchProvider {
  discover(profile: Profile, target?: InvestorResearchTarget): Promise<Evidence[]>;
}
