import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  goalProgressQuerySchema,
  journeyCommandSchema,
  goalProgressPageSchema,
  goalProgressEventSchema,
} from '../contracts/GoalJourney.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';

/** Uses the existing workspace/session/origin hooks; reads never create tracking records. */
export function registerGoalJourneyRoutes(app: FastifyInstance, service: WorkspaceService) {
  const readOptions = { config: { rateLimit: { groupId: 'goal-journey-read' } } };
  const commandOptions = {
    config: { rateLimit: { groupId: 'goal-journey-commands', max: 30, timeWindow: '1 minute' } },
  };
  const idOf = (params: unknown) => z.strictObject({ id: z.uuid() }).parse(params).id;
  app.get('/api/goal-journeys/current', readOptions, async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return service.journey.view();
  });
  app.post('/api/goal-journeys/commands', commandOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return service.journey.command(journeyCommandSchema.parse(request.body));
  });
  app.get('/api/goal-journeys', readOptions, async (_request, reply) => {
    const state = await service.read();
    reply.header('Cache-Control', 'private, no-store');
    return {
      items: [state.preparation?.journey, ...(state.preparation?.journeyHistory ?? [])].flatMap(
        (journey) =>
          journey
            ? [
                {
                  id: journey.id,
                  status: journey.status,
                  createdAt: journey.createdAt,
                  lastSequence: journey.lastSequence,
                },
              ]
            : [],
      ),
    };
  });
  app.get('/api/goal-journeys/:id', readOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return service.journey.view(idOf(request.params));
  });
  app.get('/api/goal-journeys/:id/progress', readOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return (await service.journey.view(idOf(request.params))).position;
  });
  app.get('/api/goal-journeys/:id/targets', readOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return (await service.journey.view(idOf(request.params))).targets;
  });
  app.get('/api/goal-journeys/:id/targets/:targetId', readOptions, async (request, reply) => {
    const params = z.strictObject({ id: z.uuid(), targetId: z.uuid() }).parse(request.params);
    reply.header('Cache-Control', 'private, no-store');
    const target = (await service.journey.view(params.id)).targets.find(
      (item) => item.id === params.targetId,
    );
    return target ?? reply.code(404).send({ error: 'Target unavailable.' });
  });
  app.get('/api/goal-journeys/:id/investor-matches', readOptions, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return (await service.journey.view(idOf(request.params))).assessments;
  });
  app.post('/api/goal-journeys/:id/investor-matches', commandOptions, async (request, reply) => {
    const body = z
      .strictObject({
        key: z.uuid(),
        revision: z.int().nonnegative(),
        investorId: z.uuid().optional(),
        eventId: z.string().max(100).optional(),
      })
      .parse(request.body);
    reply.header('Cache-Control', 'private, no-store');
    return service.journey.command({ ...body, action: 'assess', journeyId: idOf(request.params) });
  });
  app.post('/api/goal-journeys/:id/targets', commandOptions, async (request, reply) => {
    const body = z
      .strictObject({
        key: z.uuid(),
        revision: z.int().nonnegative(),
        investorId: z.uuid().optional(),
        eventId: z.string().max(100).optional(),
        assessmentId: z.uuid().optional(),
        rationale: z.string().trim().min(1).max(1000),
        included: z.boolean().default(true),
      })
      .parse(request.body);
    reply.header('Cache-Control', 'private, no-store');
    return service.journey.command({
      ...body,
      action: 'shortlist',
      journeyId: idOf(request.params),
    });
  });
  app.post(
    '/api/goal-journeys/:id/targets/:targetId/commands',
    commandOptions,
    async (request, reply) => {
      const params = z.strictObject({ id: z.uuid(), targetId: z.uuid() }).parse(request.params);
      const body = z
        .strictObject({
          key: z.uuid(),
          revision: z.int().nonnegative(),
          action: z.enum(['focus', 'archive', 'resume', 'include', 'exclude']),
        })
        .parse(request.body);
      reply.header('Cache-Control', 'private, no-store');
      return service.journey.command({ ...body, journeyId: params.id, targetId: params.targetId });
    },
  );
  app.get('/api/goal-journeys/:id/progress/events', readOptions, async (request, reply) => {
    const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
    const query = goalProgressQuerySchema.parse(request.query);
    reply.header('Cache-Control', 'private, no-store');
    return goalProgressPageSchema.parse(await service.journey.events(id, query));
  });
  app.get(
    '/api/goal-journeys/:id/progress/events/:eventId',
    readOptions,
    async (request, reply) => {
      const { id, eventId } = z
        .strictObject({ id: z.uuid(), eventId: z.uuid() })
        .parse(request.params);
      reply.header('Cache-Control', 'private, no-store');
      const event = service.store.findGoalProgress
        ? await service.store.findGoalProgress(id, eventId)
        : (await service.read()).preparation?.journey?.events.find(
            (item) => item.journeyId === id && item.id === eventId,
          );
      return event
        ? goalProgressEventSchema.parse(event)
        : reply.code(404).send({ error: 'Goal history unavailable.' });
    },
  );
}
