import type { ScenarioGeneration, ScenarioOutput } from '../contracts/Scenario.js';
import type { ClaimedJob } from './WorkspaceStore.js';

export type NewScenarioGeneration = Omit<
  ScenarioGeneration,
  'id' | 'jobId' | 'status' | 'output' | 'createdAt' | 'error'
>;
export interface ScenarioStore {
  createGeneration(requestKey: string, input: NewScenarioGeneration): Promise<ScenarioGeneration>;
  getGenerationByRequestKey(key: string): Promise<ScenarioGeneration | null>;
  getGeneration(id: string): Promise<ScenarioGeneration | null>;
  getGenerationForJob(jobId: string): Promise<ScenarioGeneration | null>;
  listGenerations(investorId: string): Promise<ScenarioGeneration[]>;
  completeGeneration(job: ClaimedJob, output: ScenarioOutput): Promise<void>;
}
