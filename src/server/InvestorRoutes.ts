import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
    return reply.code(202).send(await service.investors.enqueueCheck(id, key));
  });

  app.post('/api/investors/discover', async (request, reply) => {
    const { key } = radarRequestSchema.parse(request.body);
    return reply
      .code(202)
      .send(await service.store.enqueue(`investor-discovery:${key}`, InvestorJob.DISCOVER));
  });
}
