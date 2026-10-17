import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { voiceSessionRequestSchema } from '../contracts/VoicePractice.js';
import { avatarSessionResponseSchema } from '../contracts/AvatarPractice.js';
import { practiceContextSchema } from '../contracts/PracticeContext.js';
import { idSchema, RehearsalMode } from '../contracts/Workspace.js';
import type { AvatarProvider } from '../features/AvatarProvider.js';
import type { PracticeContextProvider } from '../features/PracticeContextProvider.js';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import type { Environment } from './Env.js';

export function isAvatarConfigured(env: Environment): boolean {
  return Boolean(
    env.LIVEAVATAR_API_KEY &&
    env.LIVEAVATAR_AVATAR_ID &&
    env.LIVEAVATAR_VOICE_ID &&
    env.LIVEAVATAR_CONTEXT_ID,
  );
}

export function registerAvatarRoutes(
  app: FastifyInstance,
  service: WorkspaceService,
  env: Environment,
  contextProvider: PracticeContextProvider,
  provider: AvatarProvider,
): void {
  async function saveTranscript(id: string): Promise<boolean> {
    const session = (await service.read()).rehearsals.find((item) => item.id === id);
    if (
      !session ||
      session.mode !== RehearsalMode.LIVEAVATAR ||
      !session.avatarSessionId ||
      !env.LIVEAVATAR_API_KEY
    ) {
      throw new Error('LiveAvatar session unavailable.');
    }
    if (session.transcriptReceivedAt) {
      return true;
    }
    if (session.status === 'active') {
      return false;
    }
    const turns = await provider.fetchTranscript(env.LIVEAVATAR_API_KEY, session.avatarSessionId);
    if (!turns) {
      return false;
    }
    await service.finishRehearsal(id, turns, session.status === 'awaiting_transcript', true);
    return true;
  }

  app.post('/api/avatar/sessions', async (request, reply) => {
    const { selection } = voiceSessionRequestSchema.parse(request.body);
    if (
      !env.LIVEAVATAR_API_KEY ||
      !env.LIVEAVATAR_AVATAR_ID ||
      !env.LIVEAVATAR_VOICE_ID ||
      !env.LIVEAVATAR_CONTEXT_ID
    ) {
      return reply.code(503).send({
        error:
          'Configure the LiveAvatar API key, avatar, voice and context to enable the live interviewer.',
      });
    }
    const context = practiceContextSchema.parse(await contextProvider.loadContext(selection));
    const session = await service.createRehearsal(null, RehearsalMode.LIVEAVATAR, null, context);
    let avatarSessionId: string | null = null;
    try {
      const credentials = await provider.createToken(
        {
          apiKey: env.LIVEAVATAR_API_KEY,
          avatarId: env.LIVEAVATAR_AVATAR_ID,
          voiceId: env.LIVEAVATAR_VOICE_ID,
          contextId: env.LIVEAVATAR_CONTEXT_ID,
        },
        context,
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
    if (session.mode === RehearsalMode.LIVEAVATAR) {
      await saveTranscript(id).catch(() => {
        console.warn(JSON.stringify({ event: 'avatar_transcript_pending', sessionId: id }));
      });
    }
    return { ok: true };
  });

  app.post('/api/avatar/sessions/:id/transcript', async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    z.strictObject({}).parse(request.body);
    return { saved: await saveTranscript(id) };
  });
}
