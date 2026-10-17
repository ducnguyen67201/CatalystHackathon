import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LogEvent } from '../features/WorkflowLog.js';
import { DiscoveryFrequency, SuggestionStatus } from '../contracts/InvestorDiscovery.js';
import { CheckFrequency, investorInputSchema } from '../contracts/InvestorTracking.js';
import { radarRequestSchema } from '../contracts/Workspace.js';
import { InvestorJob } from '../features/InvestorTrackingService.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';

/** Inherits the API's local session, origin, rate and body-size boundaries. */
export function registerInvestorRoutes(app: FastifyInstance, service: WorkspaceService): void {
  const paramsSchema = z.object({ id: z.uuid() });

  app.post('/api/investors', async (request, reply) => {
    const investor = await service.investors.add(investorInputSchema.parse(request.body));
    return reply.code(201).send(investor);
  });

  app.put('/api/investors/:id/identity', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { name } = z
      .strictObject({ name: z.string().trim().min(1).max(100) })
      .parse(request.body);
    await service.investors.rename(id, name);
    return { ok: true };
  });

  app.put('/api/investors/:id/schedule', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { frequency } = z.strictObject({ frequency: z.enum(CheckFrequency) }).parse(request.body);
    await service.investors.setFrequency(id, frequency);
    return { ok: true };
  });

  app.post('/api/investors/:id/check', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const { key } = radarRequestSchema.parse(request.body);
    const job = await service.investors.enqueueCheck(id, key);
    service.logger.write(LogEvent.WORKFLOW_QUEUED, { jobId: job.id, jobKind: job.kind });
    return reply.code(202).send(job);
  });

  app.put('/api/investors/discovery/schedule', async (request) => {
    const { frequency } = z
      .strictObject({ frequency: z.enum(DiscoveryFrequency) })
      .parse(request.body);
    await service.investors.discovery.setFrequency(frequency);
    return { ok: true };
  });

  app.post('/api/investors/suggestions/:id/decision', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { decision } = z
      .strictObject({ decision: z.enum([SuggestionStatus.TRACKED, SuggestionStatus.DISMISSED]) })
      .parse(request.body);
    await service.investors.discovery.decide(id, decision);
    return { ok: true };
  });

  app.post('/api/investors/discover', async (request, reply) => {
    const { key } = radarRequestSchema.parse(request.body);
    const job = await service.store.enqueue(`investor-discovery:${key}`, InvestorJob.DISCOVER);
    service.logger.write(LogEvent.WORKFLOW_QUEUED, { jobId: job.id, jobKind: job.kind });
    return reply.code(202).send(job);
  });
}
