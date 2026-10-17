import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { radarQuerySchema, updatePreferencesSchema } from '../contracts/RadarDelivery.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
export function registerRadarRoutes(app: FastifyInstance, service: WorkspaceService): void {
  const id = (params: unknown) => z.strictObject({ id: z.uuid() }).parse(params).id;
  const readOptions = { config: { rateLimit: { groupId: 'state-polling' } } };
  app.get('/api/radar/events', readOptions, async (request) =>
    service.radar.feed(radarQuerySchema.parse(request.query)),
  );
  app.get('/api/radar/events/:id', readOptions, async (request, reply) => {
    const item = await service.radar.event(id(request.params));
    return item ?? reply.code(404).send({ error: 'Radar update unavailable.' });
  });
  app.patch('/api/radar/events/:id/read', async (request) => {
    const { read } = z.strictObject({ read: z.boolean() }).parse(request.body);
    await service.radar.markRead(id(request.params), read);
    return { ok: true };
  });
  app.post('/api/radar/events/:id/dismiss', async (request) => {
    z.strictObject({}).parse(request.body);
    await service.radar.dismiss(id(request.params));
    return { ok: true };
  });
  app.get('/api/radar/status', readOptions, async () => service.radar.status());
  app.get('/api/notification-preferences', readOptions, async () => service.radar.preferences());
  app.put('/api/notification-preferences', async (request) => {
    await service.radar.updatePreferences(updatePreferencesSchema.parse(request.body));
    return { ok: true };
  });
  app.post(
    '/api/notification-preferences/confirmations',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request) => {
      const { recipient } = z.strictObject({ recipient: z.email().max(254) }).parse(request.body);
      await service.radar.requestConfirmation(recipient);
      return { ok: true };
    },
  );
  app.post(
    '/api/notification-preferences/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request) => {
      const { code } = z.strictObject({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
      await service.radar.confirm(code);
      return { ok: true };
    },
  );
  app.post('/api/notification-deliveries/:id/retry', async (request) => {
    z.strictObject({}).parse(request.body);
    await service.radar.retry(id(request.params));
    return { ok: true };
  });
}
