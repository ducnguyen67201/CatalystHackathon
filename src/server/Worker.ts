import type { WorkspaceService } from '../features/WorkspaceService.js';
export async function runWorkerTick(
  service: WorkspaceService,
  attemptLimit = 10,
): Promise<boolean> {
  await service.tickSchedule(new Date());
  await service.reviewDueMilestones(new Date());
  const job = await service.store.claimJob(new Date());
  if (!job) {
    return false;
  }
  try {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    if (
      job.kind === 'radar' &&
      (await service.store.countResearchAttemptsSince(day)) > attemptLimit
    ) {
      throw new Error('Daily research attempt limit reached.');
    }
    const result = job.kind === 'radar' ? await service.runRadar() : await service.rebuild();
    await service.store.finishJob(job, result);
  } catch (error) {
    const category =
      error instanceof Error && error.message.startsWith('Profile changed')
        ? 'Workspace changed; retrying.'
        : error instanceof Error && error.message.startsWith('Daily research')
          ? 'Daily research limit reached. Try again tomorrow.'
          : 'Workflow failed. Check provider configuration or retry after recovery.';
    await service.store.failJob(job, category);
    console.warn(
      JSON.stringify({ event: 'workflow_failed', stage: job.kind, attempt: job.attempts }),
    );
  }
  return true;
}
export function startWorker(service: WorkspaceService, attemptLimit = 10): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void runWorkerTick(service, attemptLimit)
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
