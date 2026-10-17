import type { ResearchRun, ResearchRunList, ResearchRunQuery } from '../contracts/ResearchRun.js';

/** Workspace-scoped immutable archives, separate from the frequently polled workspace aggregate. */
export interface ResearchRunStore {
  saveResearchRun(run: ResearchRun): Promise<ResearchRun>;
  findResearchRun(id: string): Promise<ResearchRun | null>;
  listResearchRuns(query: ResearchRunQuery): Promise<ResearchRunList>;
}
