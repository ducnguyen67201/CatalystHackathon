import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generationSchema,
  generationViewSchema,
  generationListSchema,
  scenarioRequestSchema,
  scenarioPreviewRequestSchema,
  scenarioPreviewSchema,
} from '../contracts/Scenario.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';

export function registerScenarioRoutes(app: FastifyInstance, service: WorkspaceService): void {
  app.post('/api/scenario-generations/preview', async (request, reply) => {
    const body = scenarioPreviewRequestSchema.parse(request.body);
    if (!service.scenarios)
      return reply.code(503).send({ error: 'Scenario generation is unavailable.' });
    return scenarioPreviewSchema.parse(
      await service.scenarios.preview(body.investorId, body.objective),
    );
  });
  app.post('/api/scenario-generations', async (request, reply) => {
    const body = scenarioRequestSchema.parse(request.body);
    if (!service.scenarios)
      return reply.code(503).send({ error: 'Scenario generation is unavailable.' });
    return reply
      .code(202)
      .send(
        generationSchema.parse(
          await service.scenarios.create(
            body.investorId,
            body.objective,
            body.key,
            body.expectedInputHash,
          ),
        ),
      );
  });
  app.get('/api/scenario-generations/:id', async (request, reply) => {
    const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
    if (!service.scenarios)
      return reply.code(503).send({ error: 'Scenario generation is unavailable.' });
    return generationViewSchema.parse(await service.scenarios.get(id));
  });
  app.get('/api/investors/:id/scenario-generations', async (request, reply) => {
    const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
    if (!service.scenarios)
      return reply.code(503).send({ error: 'Scenario generation is unavailable.' });
    return generationListSchema.parse(await service.scenarios.list(id));
  });
}
