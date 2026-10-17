import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { z } from 'zod';
import {
  profileSchema,
  scheduleSchema,
  uploadSchema,
  finishSchema,
  radarRequestSchema,
  idSchema,
  stateResponseSchema,
} from '../contracts/Workspace.js';
import { ConflictError } from '../features/WorkspaceStore.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import {
  buildVoiceContext,
  createVoiceToken,
  verifyVoiceWebhook,
  voiceWebhookSchema,
} from '../infrastructure/Voice.js';
import type { Environment } from './Env.js';

/** Single-user localhost API. Remote hosting requires an account/membership auth adapter. */
export async function createApi(service: WorkspaceService, env: Environment) {
  const app = Fastify({ logger: false, bodyLimit: 2200000 });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const localSession = randomBytes(32).toString('hex');
  const allowedOrigins = new Set([
    env.WEB_ORIGIN,
    `http://127.0.0.1:${env.API_PORT}`,
    `http://localhost:${env.API_PORT}`,
  ]);
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/webhooks/elevenlabs') {
      return;
    }
    if (!request.url.startsWith('/api/')) {
      return;
    }
    const origin = request.headers.origin;
    if (
      (origin && !allowedOrigins.has(origin)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      await reply.code(403).send({ error: 'Origin is not allowed.' });
      return;
    }
    if (request.url === '/api/session' || request.url === '/api/health') {
      return;
    }
    const value = request.cookies.june_session ?? '';
    if (
      value.length !== localSession.length ||
      !timingSafeEqual(Buffer.from(value), Buffer.from(localSession))
    ) {
      await reply.code(401).send({ error: 'Open the workspace to start a local session.' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        error: 'The request is invalid.',
        fields: error.issues.map((issue) => issue.path.join('.')),
      });
      return;
    }
    if (error instanceof ConflictError) {
      void reply.code(409).send({ error: 'The workspace changed. Please retry.' });
      return;
    }
    if (
      error instanceof Error &&
      /^(Row |CSV format:|Duplicate month|Choose an existing|Upload financial|Brief unavailable|Session unavailable|Follow-up unavailable|End an active|Finish this|This practice|Snapshots use different|Financial evidence unavailable)/.test(
        error.message,
      )
    ) {
      void reply.code(400).send({ error: error.message });
      return;
    }
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
    console.warn(
      JSON.stringify({
        event: 'api_request_failed',
        stage: request.routeOptions.url,
        code,
        category: error instanceof Error ? error.name : 'unknown',
      }),
    );
    void reply
      .code(500)
      .send({ error: 'The operation failed. Check server configuration and try again.' });
  });
  app.post('/api/session', async (_request, reply) => {
    reply.setCookie('june_session', localSession, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 86400,
    });
    return { ok: true };
  });
  app.get('/api/health', () => ({ status: 'ready', localOnly: true }));
  app.get('/api/state', async () =>
    stateResponseSchema.parse({
      workspace: await service.read(),
      jobs: await service.store.listJobs(),
      capabilities: {
        researchMode: env.RESEARCH_MODE,
        voiceReady: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID),
        researchReady:
          env.RESEARCH_MODE === 'demo' || Boolean(env.EXA_API_KEY && env.OPENAI_API_KEY),
        localOnly: true,
      },
    }),
  );
  app.put('/api/profile', async (request) => {
    await service.updateProfile(profileSchema.omit({ version: true }).parse(request.body));
    return { ok: true };
  });
  app.post('/api/financials', async (request) => {
    const body = uploadSchema.parse(request.body);
    const id = await service.upload(body.csv, body.fileName, body.currency);
    await service.store.enqueue(`snapshot:${id}`, 'rebuild');
    return { id };
  });
  app.put('/api/schedule', async (request) => {
    await service.setSchedule(
      scheduleSchema.pick({ frequency: true, timezone: true }).parse(request.body),
    );
    return { ok: true };
  });
  app.post('/api/radar', async (request, reply) => {
    const body = radarRequestSchema.parse(request.body);
    const job = await service.store.enqueue(`manual:${body.key}`, 'radar');
    return reply.code(202).send(job);
  });
  app.post('/api/briefs', async () => {
    await service.rebuild();
    return { ok: true };
  });
  app.post('/api/rehearsals', async (request, reply) => {
    const body = z
      .strictObject({ briefId: idSchema, mode: z.enum(['demo', 'text', 'elevenlabs']) })
      .parse(request.body);
    const state = await service.read();
    const brief = state.briefs.find((item) => item.id === body.briefId);
    if (!brief) {
      throw new Error('Brief unavailable.');
    }
    let token: string | null = null;
    let conversationId: string | null = null;
    if (body.mode === 'elevenlabs') {
      if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_AGENT_ID) {
        return reply.code(503).send({
          error: 'Configure ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID to start browser voice.',
        });
      }
      const active = state.rehearsals.filter(
        (item) => item.mode === 'elevenlabs' && item.status === 'active',
      );
      if (active.length) {
        throw new Error('End an active rehearsal before starting another.');
      }
      const credentials = await createVoiceToken(env.ELEVENLABS_API_KEY, env.ELEVENLABS_AGENT_ID);
      token = credentials.token;
      conversationId = credentials.conversationId;
    }
    const session = await service.createRehearsal(brief.id, body.mode, conversationId);
    return {
      session,
      token,
      conversationId,
      context: buildVoiceContext(state, brief),
      previousSummary:
        state.rehearsals
          .filter((item) => item.review !== null)
          .at(-1)
          ?.review?.answer.slice(0, 3000) ?? 'No previous rehearsal.',
    };
  });
  app.post('/api/rehearsals/:id/answers', async (request) => {
    const params = z.object({ id: idSchema }).parse(request.params);
    const body = z.strictObject({ text: z.string().trim().min(1).max(10000) }).parse(request.body);
    await service.answer(params.id, body.text);
    return { ok: true };
  });
  app.post('/api/rehearsals/:id/end', async (request) => {
    const params = z.object({ id: idSchema }).parse(request.params);
    const body = finishSchema.parse(request.body);
    await service.finishRehearsal(params.id, body.turns, body.completed);
    return { ok: true };
  });
  app.post('/api/milestones', async (request) => {
    const body = z.strictObject({ briefId: idSchema }).parse(request.body);
    await service.trackFollowup(body.briefId);
    return { ok: true };
  });
  app.post('/api/milestones/:id/review', async (request) => {
    const params = z.object({ id: idSchema }).parse(request.params);
    await service.reviewMilestone(params.id);
    return { ok: true };
  });
  app.post('/api/notices/read', async () => {
    await service.change((state) => {
      for (const notice of state.notices) {
        notice.read = true;
      }
    });
    return { ok: true };
  });
  await app.register((scope, _options, done) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, body);
      },
    );
    scope.post('/api/webhooks/elevenlabs', async (request, reply) => {
      if (!env.ELEVENLABS_WEBHOOK_SECRET) {
        return reply.code(503).send({ error: 'Webhook is not configured.' });
      }
      const signature = request.headers['elevenlabs-signature'];
      if (typeof signature !== 'string' || typeof request.body !== 'string') {
        return reply.code(401).send({ error: 'Invalid webhook.' });
      }
      let raw: unknown;
      try {
        raw = await verifyVoiceWebhook(request.body, signature, env.ELEVENLABS_WEBHOOK_SECRET);
      } catch {
        return reply.code(401).send({ error: 'Invalid webhook signature.' });
      }
      const event = voiceWebhookSchema.safeParse(raw);
      if (!event.success) {
        return reply.code(202).send({ ignored: true });
      }
      if (event.data.data.agent_id !== env.ELEVENLABS_AGENT_ID) {
        return reply.code(403).send({ error: 'Unexpected agent.' });
      }
      const state = await service.read();
      const session = state.rehearsals.find(
        (item) => item.conversationId === event.data.data.conversation_id,
      );
      if (!session) {
        return reply.code(202).send({ ignored: true });
      }
      const turns = event.data.data.transcript.flatMap((turn) =>
        turn.message ? [{ role: turn.role, text: turn.message.slice(0, 10000) }] : [],
      );
      const complete =
        event.data.data.status !== 'failed' && turns.some((turn) => turn.role === 'user');
      await service.finishRehearsal(session.id, turns, complete, true);
      return { ok: true };
    });
    done();
  });
  const webRoot = path.resolve('dist/web');
  if (existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Route unavailable.' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
