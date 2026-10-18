import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import {
  connectedPreparationCommandSchema,
  connectedPreparationViewSchema,
} from '../contracts/ConnectedPreparation.js';
import { generationSchema, scenarioPreviewSchema } from '../contracts/Scenario.js';
export function registerConnectedPreparationRoutes(
  app: FastifyInstance,
  service: WorkspaceService,
) {
  app.get('/api/preparation-loop', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const { targetId, cycleId } = z
      .strictObject({ targetId: z.uuid().optional(), cycleId: z.uuid().optional() })
      .parse(request.query);
    return connectedPreparationViewSchema.parse(await service.connected.view(targetId, cycleId));
  });
  app.post('/api/preparation-loop/commands', async (request) => {
    await service.connected.command(connectedPreparationCommandSchema.parse(request.body));
    return { ok: true };
  });
  app.post('/api/preparation-loop/scenario-preview', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const { cycleId } = z.strictObject({ cycleId: z.uuid() }).parse(request.body);
    return scenarioPreviewSchema.parse(await service.connected.scenarioPreview(cycleId));
  });
  app.post('/api/preparation-loop/scenarios', async (request, reply) => {
    const body = z
      .strictObject({
        cycleId: z.uuid(),
        key: z.uuid(),
        expectedInputHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(request.body);
    return reply
      .code(202)
      .send(
        generationSchema.parse(
          await service.connected.createScenario(body.cycleId, body.key, body.expectedInputHash),
        ),
      );
  });
  app.post('/api/preparation-loop/scenario-retry', async (request) => {
    const body = z.strictObject({ cycleId: z.uuid(), generationId: z.uuid() }).parse(request.body);
    await service.connected.retryScenario(body.cycleId, body.generationId);
    return { ok: true };
  });
  app.post(
    '/api/preparation-loop/rehearsals',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute', groupId: 'preparation-assessments' } },
    },
    async (request, reply) => {
      const body = z
        .strictObject({
          cycleId: z.uuid(),
          scenarioId: z.string().regex(/^[a-z0-9-]{1,60}$/),
          answer: z.string().trim().min(1).max(3000),
          key: z.uuid(),
        })
        .parse(request.body);
      const id = await service.connected.submitWritten(
        body.cycleId,
        body.scenarioId,
        body.answer,
        body.key,
      );
      return reply.code(202).send({ id });
    },
  );
}
