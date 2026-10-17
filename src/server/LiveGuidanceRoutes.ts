import { liveGuidanceHistorySchema } from '../contracts/LiveGuidance.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LiveGuidanceService,
  type LiveGuidanceProvider,
  type LiveGuidanceWorkspace,
} from '../features/LiveGuidance.js';

export function registerLiveGuidanceRoutes(
  app: FastifyInstance,
  service: LiveGuidanceWorkspace,
  provider: LiveGuidanceProvider | null,
) {
  const guidance = provider ? new LiveGuidanceService(service, provider) : null;
  app.get('/api/rehearsals/:id/live-guidance', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const id = z.strictObject({ id: z.uuid() }).parse(request.params).id;
    const session = (await service.read()).rehearsals.find((item) => item.id === id);
    if (!session) return reply.code(404).send({ error: 'Practice session not found.' });
    return liveGuidanceHistorySchema.parse({
      entries: session.liveGuidance ?? [],
      context: session.evaluationContext,
    });
  });
  app.post(
    '/api/rehearsals/:id/live-guidance',
    {
      config: { rateLimit: { groupId: 'live-guidance', max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (!guidance)
        return reply.code(503).send({
          error: 'Live guidance needs the server’s OpenAI key. Your conversation can continue.',
        });
      return guidance.explain(
        z.strictObject({ id: z.uuid() }).parse(request.params).id,
        request.body,
      );
    },
  );
}
