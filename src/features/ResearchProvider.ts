import type { Evidence, Profile } from '../contracts/Workspace.js';
export interface ResearchProvider {
  discover(profile: Profile): Promise<Evidence[]>;
}
