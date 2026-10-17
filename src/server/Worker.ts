import { ResearchConfigurationError } from '../features/ResearchProvider.js';
import { LogEvent } from '../features/WorkflowLog.js';
import { describeResearchFailure } from '../infrastructure/WorkflowLogger.js';
import { InvestorJob } from '../features/InvestorTrackingService.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
export async function runWorkerTick(service: WorkspaceService): Promise<boolean> {
  await service.radar.backfill();
  await service.investors.tick(new Date());
  await service.investors.discovery.tick(new Date());
  await service.tickSchedule(new Date());
  await service.reviewDueMilestones(new Date());
  await service.preparation.reconcile();
  const job = await service.store.claimJob(new Date());
  if (!job) {
    return false;
  }
  await service.radar.heartbeat('checking', job.id);
  return service.logger.run(
    { jobId: job.id, jobKind: job.kind, attempt: job.attempts },
    async () => {
      const started = Date.now();
      service.logger.write(LogEvent.WORKFLOW_STARTED);
      try {
        if (job.kind.startsWith('guided-turn:')) {
          const [, sessionId, answerId] = job.kind.split(':');
          if (!sessionId || !answerId) throw new Error('Invalid practice turn job.');
          await service.guided.run(sessionId, answerId, job);
          await service.radar.heartbeat('waiting', null, true);
          service.logger.write(LogEvent.WORKFLOW_SUCCEEDED, { durationMs: Date.now() - started });
          return true;
        }
        if (job.kind === 'scenario') {
          if (!service.scenarios) throw new Error('Scenario runtime unavailable.');
          await service.scenarios.run(job);
          await service.radar.heartbeat('waiting', null, true);
          service.logger.write(LogEvent.WORKFLOW_SUCCEEDED, { durationMs: Date.now() - started });
          return true;
        }
        let result: string;
        if (job.kind.startsWith('evaluate:')) {
          const [, sessionId, evaluationId] = job.kind.split(':');
          if (!sessionId || !evaluationId) throw new Error('Invalid evaluation job.');
          await service.evaluations.run(sessionId, evaluationId, job);
          await service.radar.heartbeat('waiting', null, true);
          service.logger.write(LogEvent.WORKFLOW_SUCCEEDED, { durationMs: Date.now() - started });
          return true; // Result and job success were committed atomically under this lease.
        } else if (job.kind.startsWith('avatar-transcript:')) {
          if (!service.retrieveAvatarTranscript)
            throw new Error('Transcript provider unavailable.');
          await service.retrieveAvatarTranscript(job.kind.slice('avatar-transcript:'.length));
          result = 'Transcript saved.';
        } else if (job.kind.startsWith(InvestorJob.CHECK_PREFIX)) {
          result = await service.investors.check(
            job.kind.slice(InvestorJob.CHECK_PREFIX.length),
            job.id,
            job.attempts,
          );
        } else if (job.kind === InvestorJob.DISCOVER) {
          result = await service.investors.discover(job.id, job.attempts);
        } else if (job.kind === 'radar') {
          result = await service.runRadar(job.id, job.attempts);
        } else if (job.kind === 'rebuild') {
          result = await service.rebuild();
        } else {
          throw new Error('Unknown workflow kind.');
        }
        await service.store.finishJob(job, result);
        await service.radar.heartbeat('waiting', null, true);
        service.logger.write(LogEvent.WORKFLOW_SUCCEEDED, { durationMs: Date.now() - started });
      } catch (error) {
        const category =
          error instanceof ResearchConfigurationError
            ? error.message
            : error instanceof Error &&
                (error.message.startsWith('Profile changed') ||
                  error.message.startsWith('Investor identity changed'))
              ? 'Workspace changed; retrying.'
              : 'Workflow failed. Check provider configuration or retry after recovery.';
        await service.store.failJob(job, category);
        await service.radar.heartbeat(
          error instanceof ResearchConfigurationError || job.attempts >= 3 ? 'blocked' : 'retrying',
        );
        service.logger.write(
          LogEvent.WORKFLOW_FAILED,
          { ...describeResearchFailure(error), durationMs: Date.now() - started },
          'error',
        );
      }
      return true;
    },
  );
}
export function startWorker(service: WorkspaceService): () => void {
  let running = false;
  let delivering = false;
  const heartbeat = setInterval(() => {
    void service.radar.heartbeat().catch(() => undefined);
  }, 15000);
  void service.radar.heartbeat('waiting').catch(() => undefined);
  const deliveries = setInterval(() => {
    if (delivering) return;
    delivering = true;
    void service.radar
      .deliverOne()
      .catch(() => {
        service.logger.write(LogEvent.WORKER_TICK_FAILED, {}, 'error');
      })
      .finally(() => {
        delivering = false;
      });
  }, 2000);
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void runWorkerTick(service)
      .catch((error: unknown) => {
        service.logger.write(LogEvent.WORKER_TICK_FAILED, describeResearchFailure(error), 'error');
      })
      .finally(() => {
        running = false;
      });
  }, 2000);
  return () => {
    clearInterval(timer);
    clearInterval(heartbeat);
    clearInterval(deliveries);
  };
}
