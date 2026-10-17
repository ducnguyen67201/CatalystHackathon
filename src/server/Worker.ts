import { InvestorJob } from '../features/InvestorTrackingService.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
export async function runWorkerTick(service: WorkspaceService): Promise<boolean> {
  await service.investors.tick(new Date());
  await service.tickSchedule(new Date());
  await service.reviewDueMilestones(new Date());
  const job = await service.store.claimJob(new Date());
  if (!job) {
    return false;
  }
  try {
    let result: string;
    if (job.kind.startsWith(InvestorJob.CHECK_PREFIX)) {
      result = await service.investors.check(
        job.kind.slice(InvestorJob.CHECK_PREFIX.length),
        job.id,
      );
    } else if (job.kind === InvestorJob.DISCOVER) {
      result = await service.investors.discover();
    } else if (job.kind === 'radar') {
      result = await service.runRadar();
    } else if (job.kind === 'rebuild') {
      result = await service.rebuild();
    } else {
      throw new Error('Unknown workflow kind.');
    }
    await service.store.finishJob(job, result);
  } catch (error) {
    const category =
      error instanceof Error &&
      (error.message.startsWith('Profile changed') ||
        error.message.startsWith('Investor identity changed'))
        ? 'Workspace changed; retrying.'
        : 'Workflow failed. Check provider configuration or retry after recovery.';
    await service.store.failJob(job, category);
    console.warn(
      JSON.stringify({ event: 'workflow_failed', stage: job.kind, attempt: job.attempts }),
    );
  }
  return true;
}
export function startWorker(service: WorkspaceService): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void runWorkerTick(service)
      .catch(() => {
        console.warn(JSON.stringify({ event: 'worker_tick_failed' }));
      })
      .finally(() => {
        running = false;
      });
  }, 2000);
  return () => {
    clearInterval(timer);
  };
}
