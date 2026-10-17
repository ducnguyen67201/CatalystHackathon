import type { WorkerHeartbeat } from '../contracts/RadarDelivery.js';
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
  save(
    workspace: Workspace,
    expectedRevision: number,
    completedJob?: ClaimedJob,
    checkpointJob?: ClaimedJob,
  ): Promise<void>;
  enqueue(key: string, kind: string): Promise<Job>;
  listJobs(): Promise<Job[]>;
  claimJob(now: Date): Promise<ClaimedJob | null>;
  finishJob(job: ClaimedJob, result: string): Promise<void>;
  failJob(job: ClaimedJob, error: string): Promise<void>;
  recordHeartbeat?(heartbeat: WorkerHeartbeat): Promise<void>;
  readHeartbeat?(): Promise<WorkerHeartbeat | null>;
  close(): Promise<void>;
}
