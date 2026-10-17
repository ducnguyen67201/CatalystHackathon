import type { Job, Workspace } from '../contracts/Workspace.js';
export class ConflictError extends Error {}
export interface ClaimedJob {
  id: string;
  kind: string;
  leaseToken: string;
  attempts: number;
}
export interface WorkspaceStore {
  load(): Promise<Workspace | null>;
  initialize(workspace: Workspace): Promise<void>;
  save(workspace: Workspace, expectedRevision: number): Promise<void>;
  enqueue(key: string, kind: string): Promise<Job>;
  listJobs(): Promise<Job[]>;
  countResearchAttemptsSince(since: Date): Promise<number>;
  claimJob(now: Date): Promise<ClaimedJob | null>;
  finishJob(job: ClaimedJob, result: string): Promise<void>;
  failJob(job: ClaimedJob, error: string): Promise<void>;
  close(): Promise<void>;
}
