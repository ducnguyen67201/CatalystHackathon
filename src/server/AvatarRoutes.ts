import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avatarSessionResponseSchema } from '../contracts/AvatarPractice.js';
import { practiceContextSchema } from '../contracts/PracticeContext.js';
import { idSchema } from '../contracts/Workspace.js';
import type { AvatarProvider } from '../features/AvatarProvider.js';
import type { PracticeContextProvider } from '../features/PracticeContextProvider.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import type { Environment } from './Env.js';

export function isAvatarConfigured(env: Environment): boolean {
  return Boolean(
    env.LIVEAVATAR_API_KEY &&
    env.LIVEAVATAR_AVATAR_ID &&
    env.LIVEAVATAR_ELEVENLABS_SECRET_ID &&
    env.ELEVENLABS_AGENT_ID &&
    env.ELEVENLABS_WEBHOOK_SECRET,
  );
}

export function registerAvatarRoutes(
  app: FastifyInstance,
  service: WorkspaceService,
  env: Environment,
  contextProvider: PracticeContextProvider,
  provider: AvatarProvider,
): void {
  app.post('/api/avatar/sessions', async (request, reply) => {
    z.strictObject({}).parse(request.body);
    if (
      !env.LIVEAVATAR_API_KEY ||
      !env.LIVEAVATAR_AVATAR_ID ||
      !env.LIVEAVATAR_ELEVENLABS_SECRET_ID ||
      !env.ELEVENLABS_AGENT_ID ||
      !env.ELEVENLABS_WEBHOOK_SECRET
    ) {
      return reply.code(503).send({
        error: 'Configure LiveAvatar and its ElevenLabs connector to enable the live interviewer.',
      });
    }
    const context = practiceContextSchema.parse(await contextProvider.loadContext());
    const nonce = randomBytes(32).toString('hex');
    const correlationHash = createHash('sha256').update(nonce).digest('hex');
    const session = await service.createRehearsal(
      null,
      'elevenlabs',
      null,
      context,
      correlationHash,
    );
    let avatarSessionId: string | null = null;
    try {
      const credentials = await provider.createToken(
        {
          apiKey: env.LIVEAVATAR_API_KEY,
          avatarId: env.LIVEAVATAR_AVATAR_ID,
          elevenLabsSecretId: env.LIVEAVATAR_ELEVENLABS_SECRET_ID,
          agentId: env.ELEVENLABS_AGENT_ID,
        },
        context,
        session.id,
        nonce,
      );
      avatarSessionId = credentials.avatarSessionId;
      await service.attachAvatarSession(session.id, avatarSessionId);
      return avatarSessionResponseSchema.parse({
        session: { ...session, avatarSessionId },
        token: credentials.token,
      });
    } catch (error) {
      if (avatarSessionId) {
        await provider.stopSession(env.LIVEAVATAR_API_KEY, avatarSessionId).catch(() => {
          console.warn(JSON.stringify({ event: 'avatar_cleanup_failed', sessionId: session.id }));
        });
      }
      await service.finishRehearsal(session.id, [], false);
      throw error;
    }
  });

  app.post('/api/avatar/sessions/:id/end', async (request, reply) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { completed } = z.strictObject({ completed: z.boolean() }).parse(request.body);
    const session = (await service.read()).rehearsals.find((item) => item.id === id);
    if (!session?.avatarSessionId) {
      return reply.code(404).send({ error: 'Avatar session unavailable.' });
    }
    if (!env.LIVEAVATAR_API_KEY) {
      return reply.code(503).send({ error: 'LiveAvatar is not configured.' });
    }
    await provider.stopSession(env.LIVEAVATAR_API_KEY, session.avatarSessionId);
    await service.finishRehearsal(id, [], completed);
    return { ok: true };
  });
}
