import { preparationCsvSource } from '../features/PreparationSource.js';
import {
  financialPerformanceQuerySchema,
  financialPerformanceSchema,
} from '../contracts/FinancialPerformance.js';
import { buildFinancialPerformance } from '../features/FinancialPerformance.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import {
  preparationGoalInputSchema,
  preparationIntentSchema,
  preparationScheduleInputSchema,
  preparationViewSchema,
} from '../contracts/FundraisingPreparation.js';

export function registerPreparationRoutes(app: FastifyInstance, service: WorkspaceService) {
  app.get('/api/financial-performance', async (request, reply) => {
    const query = financialPerformanceQuerySchema.parse(request.query);
    const state = await service.read();
    const snapshot = state.snapshots.find((item) => item.id === state.onboarding.snapshotId);
    reply.header('Cache-Control', 'private, no-store');
    return financialPerformanceSchema.parse(buildFinancialPerformance(snapshot, query));
  });
  app.get('/api/preparation-plan/:planId/sources/:artifactId', async (request, reply) => {
    const { planId, artifactId } = z
      .strictObject({ planId: z.string().min(1).max(100), artifactId: z.string().min(1).max(100) })
      .parse(request.params);
    reply.header('Cache-Control', 'private, no-store');
    return preparationCsvSource(await service.read(), planId, artifactId);
  });
  app.get('/api/preparation-plan', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return preparationViewSchema.parse(await service.preparation.view());
  });
  app.post('/api/preparation-plan/intent', async (request) => {
    const body = z
      .strictObject({
        intent: preparationIntentSchema,
        version: z.int().nonnegative(),
        profileVersion: z.int().positive(),
      })
      .parse(request.body);
    await service.preparation.setIntent(body.intent, body.version, body.profileVersion);
    return { ok: true };
  });
  app.post('/api/preparation-plan/goal', async (request) => {
    const body = z
      .strictObject({
        goal: preparationGoalInputSchema,
        version: z.int().nonnegative(),
        automatic: z.boolean(),
      })
      .parse(request.body);
    await service.preparation.confirmGoal(body.goal, body.version, body.automatic);
    return { ok: true };
  });
  app.post('/api/preparation-plan/schedule', async (request) => {
    const body = z
      .strictObject({
        assumptions: preparationScheduleInputSchema,
        version: z.int().nonnegative(),
        planId: z.string().min(1).max(100),
      })
      .parse(request.body);
    await service.preparation.saveSchedule(body.assumptions, body.version, body.planId);
    return { ok: true };
  });
  app.post('/api/preparation-plan/automatic', async (request) => {
    const body = z
      .strictObject({ automatic: z.boolean(), version: z.int().nonnegative() })
      .parse(request.body);
    await service.preparation.setAutomatic(body.automatic, body.version);
    return { ok: true };
  });
  app.post('/api/preparation-plan/refresh', async (request) => {
    z.strictObject({}).parse(request.body);
    await service.preparation.reconcile(true);
    return { ok: true };
  });
  app.post('/api/preparation-plan/decisions', async (request) => {
    const body = z
      .strictObject({
        planId: z.string().min(1).max(100),
        artifactId: z.string().min(1).max(100),
        kind: z.enum(['accepted', 'rejected']),
        note: z.string().trim().max(1000),
        requestKey: z.uuid(),
      })
      .parse(request.body);
    await service.preparation.decide(
      body.planId,
      body.artifactId,
      body.kind,
      body.note,
      body.requestKey,
    );
    return { ok: true };
  });
  app.post(
    '/api/preparation-plan/rehearsals',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute', groupId: 'preparation-assessments' } },
    },
    async (request, reply) => {
      const body = z
        .strictObject({
          planId: z.string().min(1).max(100),
          artifactId: z.string().min(1).max(100),
          answer: z.string().trim().min(1).max(3000),
          requestKey: z.uuid(),
        })
        .parse(request.body);
      const id = await service.preparation.rehearse(
        body.planId,
        body.artifactId,
        body.answer,
        body.requestKey,
      );
      return reply.code(202).send({ id });
    },
  );
}
