import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  importResearchRunSchema,
  researchRunSchema,
  researchRunQuerySchema,
  researchRunListSchema,
  ResearchRunOrigin,
  ResearchRunStatus,
} from '../contracts/ResearchRun.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';

/** Uses the same session/origin boundaries as the rest of the local API. */
export function registerResearchRunRoutes(app: FastifyInstance, service: WorkspaceService): void {
  app.post('/api/research-runs', async (request, reply) => {
    if (!service.researchRuns) {
      return reply.code(503).send({ error: 'Research storage is unavailable.' });
    }
    const input = importResearchRunSchema.parse(request.body);
    const state = await service.read();
    if (input.investorId && !state.investors.some((investor) => investor.id === input.investorId)) {
      return reply.code(404).send({ error: 'Investor unavailable.' });
    }
    const saved = await service.researchRuns.saveResearchRun(
      researchRunSchema.parse({
        ...input,
        origin: ResearchRunOrigin.IMPORT,
        status: ResearchRunStatus.SOURCE_ONLY,
        jobId: null,
        attempt: null,
        model: null,
        decisions: [],
        evidence: [],
        failure: null,
      }),
    );
    return reply.code(201).header('Cache-Control', 'no-store').send(saved);
  });

  app.get('/api/research-runs', async (request, reply) => {
    if (!service.researchRuns) {
      return reply.code(503).send({ error: 'Research storage is unavailable.' });
    }
    const result = await service.researchRuns.listResearchRuns(
      researchRunQuerySchema.parse(request.query),
    );
    return reply.header('Cache-Control', 'no-store').send(researchRunListSchema.parse(result));
  });

  app.get('/api/research-runs/:id', async (request, reply) => {
    if (!service.researchRuns) {
      return reply.code(503).send({ error: 'Research storage is unavailable.' });
    }
    const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
    const run = await service.researchRuns.findResearchRun(id);
    return run
      ? reply.header('Cache-Control', 'no-store').send(researchRunSchema.parse(run))
      : reply.code(404).send({ error: 'Research run unavailable.' });
  });
}
