import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  guidedHistorySchema,
  guidedRevisionSchema,
  guidedViewSchema,
} from '../contracts/GuidedPractice.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
const params = z.strictObject({ id: z.uuid() });

export function registerGuidedPracticeRoutes(app: FastifyInstance, service: WorkspaceService) {
  app.post('/api/guided-practice/sessions', async (request, reply) => {
    if (!service.guided.ready)
      return reply
        .code(503)
        .send({ error: 'Guided practice requires OPENAI_API_KEY on the server.' });
    const id = await service.guided.start(request.body);
    return reply.code(201).send(guidedViewSchema.parse(await service.guided.get(id)));
  });
  app.get('/api/guided-practice/sessions', async (request, reply) => {
    const query = z
      .strictObject({ generationId: z.uuid(), scenarioId: z.string().regex(/^[a-z0-9-]{1,60}$/) })
      .parse(request.query);
    reply.header('Cache-Control', 'private, no-store');
    return guidedHistorySchema.parse(
      (await service.read()).rehearsals
        .filter(
          (session) =>
            session.guided &&
            session.context?.version === 2 &&
            session.context.selection.generationId === query.generationId &&
            session.context.selection.scenarioId === query.scenarioId,
        )
        .slice(-20)
        .reverse()
        .map(({ id, status, createdAt }) => ({ id, status, createdAt })),
    );
  });
  app.get(
    '/api/guided-practice/sessions/:id',
    { config: { rateLimit: { groupId: 'guided-reads' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return service.guided.get(params.parse(request.params).id);
    },
  );
  app.post('/api/guided-practice/sessions/:id/answers', async (request, reply) => {
    const { id } = params.parse(request.params);
    await service.guided.answer(id, request.body);
    return reply.code(202).send(await service.guided.get(id));
  });
  app.post('/api/guided-practice/sessions/:id/retry', async (request) => {
    const { id } = params.parse(request.params);
    await service.guided.retry(id, guidedRevisionSchema.parse(request.body).expectedRevision);
    return service.guided.get(id);
  });
  app.post('/api/guided-practice/sessions/:id/finish', async (request) => {
    const { id } = params.parse(request.params);
    await service.guided.finish(id, guidedRevisionSchema.parse(request.body).expectedRevision);
    return service.guided.get(id);
  });
}
