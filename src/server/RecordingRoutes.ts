import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { WorkspaceService } from '../features/WorkspaceService.js';
import type { Environment } from './Env.js';
import { recordingPlaybackSchema } from '../contracts/RecordingPlayback.js';
import type { RecordingProvider } from '../features/RecordingProvider.js';
import { ElevenLabsRecording } from '../infrastructure/ElevenLabsRecording.js';

export function registerRecordingRoutes(
  app: FastifyInstance,
  service: WorkspaceService,
  env: Environment,
  provider: RecordingProvider = new ElevenLabsRecording(),
) {
  const sessionFor = async (params: unknown) => {
    const { id } = z.object({ id: z.uuid() }).parse(params);
    return (await service.read()).rehearsals.find((session) => session.id === id);
  };
  app.get(
    '/api/rehearsals/:id/playback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute', groupId: 'recording-reads' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const session = await sessionFor(request.params);
      if (!session) return reply.code(404).send({ error: 'Session unavailable.' });
      if (
        session.mode !== 'elevenlabs' ||
        !session.conversationId ||
        !session.transcriptReceivedAt ||
        !env.ELEVENLABS_API_KEY
      ) {
        return recordingPlaybackSchema.parse({
          available: false,
          durationSeconds: null,
          segments: [],
          label: 'Transcript-only session',
          reason:
            session.mode === 'text'
              ? 'Written practice has no audio recording.'
              : 'No supported provider recording is available for this saved session.',
        });
      }
      try {
        return recordingPlaybackSchema.parse(
          await provider.describe(env.ELEVENLABS_API_KEY, session.conversationId, session.turns),
        );
      } catch {
        return reply
          .code(503)
          .send({ error: 'Recording could not be loaded. Retry later; your transcript is saved.' });
      }
    },
  );
  app.get(
    '/api/rehearsals/:id/recording',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute', groupId: 'recording-audio' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const session = await sessionFor(request.params);
      if (!session) return reply.code(404).send({ error: 'Session unavailable.' });
      if (
        session.mode !== 'elevenlabs' ||
        !session.conversationId ||
        !session.transcriptReceivedAt ||
        !env.ELEVENLABS_API_KEY
      )
        return reply.code(404).send({ error: 'Recording unavailable.' });
      try {
        const recording = await provider.audio(env.ELEVENLABS_API_KEY, session.conversationId);
        return await reply
          .header('X-Content-Type-Options', 'nosniff')
          .type(recording.contentType)
          .send(Buffer.from(recording.bytes));
      } catch {
        return reply.code(503).send({ error: 'Recording could not be loaded. Retry later.' });
      }
    },
  );
}
