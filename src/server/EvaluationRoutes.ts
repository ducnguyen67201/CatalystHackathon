import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluationResponseSchema } from '../contracts/RehearsalEvaluation.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import { evidenceReviewSchema } from '../contracts/EvidenceReview.js';
import { followupQuerySchema, followupsResponseSchema } from '../contracts/Followups.js';
import { projectFollowups } from '../features/Followups.js';

const paramsSchema = z.object({ id: z.uuid(), evaluationId: z.uuid().optional() });
export function registerEvaluationRoutes(app: FastifyInstance, service: WorkspaceService): void {
  app.get('/api/followups', async (request, reply) => {
    const { offset, limit } = followupQuerySchema.parse(request.query);
    const [state, jobs] = await Promise.all([service.read(), service.store.listJobs()]);
    reply.header('Cache-Control', 'private, no-store');
    return followupsResponseSchema.parse(projectFollowups(state, jobs, offset, limit));
  });
  app.get(
    '/api/rehearsals/:id/evaluations/:evaluationId/evidence',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute', groupId: 'evaluation-reads' } } },
    async (request, reply) => {
      const { id, evaluationId } = paramsSchema
        .extend({ evaluationId: z.uuid() })
        .parse(request.params);
      const evidence = await service.evaluations.getEvidence(id, evaluationId);
      reply.header('Cache-Control', 'private, no-store');
      if (!evidence) return reply.code(404).send({ error: 'Review unavailable.' });
      return evidenceReviewSchema.parse(evidence);
    },
  );
  app.get(
    '/api/rehearsals/:id/evaluations',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute', groupId: 'evaluation-reads' } } },
    async (request) => {
      const { id } = paramsSchema.parse(request.params);
      return evaluationResponseSchema.parse(await service.evaluations.get(id));
    },
  );
  app.post('/api/rehearsals/:id/evaluations/:evaluationId/retry', async (request) => {
    const { id, evaluationId } = paramsSchema
      .extend({ evaluationId: z.uuid() })
      .parse(request.params);
    const { generation } = z
      .strictObject({ generation: z.int().nonnegative() })
      .parse(request.body);
    await service.evaluations.retry(id, evaluationId, generation);
    return { ok: true };
  });
  app.post('/api/rehearsals/:id/evaluations/:evaluationId/responses', async (request) => {
    const { id, evaluationId } = paramsSchema
      .extend({ evaluationId: z.uuid() })
      .parse(request.params);
    const body = z
      .strictObject({
        itemId: z.string().min(1).max(200),
        kind: z.enum(['clarification', 'dismissed', 'practice']),
        text: z.string().trim().max(3000),
        requestKey: z.uuid(),
      })
      .refine((value) => value.kind === 'dismissed' || value.text.length > 0)
      .parse(request.body);
    const responseId = await service.evaluations.respond(
      id,
      evaluationId,
      body.itemId,
      body.kind,
      body.text,
      body.requestKey,
    );
    return { id: responseId };
  });
}
