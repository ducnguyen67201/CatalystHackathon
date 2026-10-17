import { z } from 'zod';
import type { TranscriptTurn } from '../contracts/Workspace.js';
import { recordingPlaybackSchema } from '../contracts/RecordingPlayback.js';
import { RECORDING_BYTE_LIMIT, type RecordingProvider } from '../features/RecordingProvider.js';

const detailsSchema = z.object({
  has_audio: z.boolean(),
  metadata: z
    .object({ call_duration_secs: z.number().nonnegative().max(3600).nullable().optional() })
    .optional(),
  transcript: z
    .array(
      z.object({
        role: z.enum(['agent', 'user']),
        message: z.string().nullable(),
        time_in_call_secs: z.number().min(0).max(3600).optional(),
      }),
    )
    .max(200),
});

/** Only fixed provider URLs and server-resolved conversation IDs are accepted. No recording is persisted. */
export class ElevenLabsRecording implements RecordingProvider {
  private async fetch(apiKey: string, conversationId: string, suffix: string) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}${suffix}`,
      {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error('Provider recording is unavailable.');
    return response;
  }
  async describe(apiKey: string, conversationId: string, turns: TranscriptTurn[]) {
    const response = await this.fetch(apiKey, conversationId, '');
    const raw: unknown = await response.json();
    const details = detailsSchema.parse(raw);
    const transcript = details.transcript.filter((turn) => turn.message);
    const matches =
      transcript.length === turns.length &&
      transcript.every(
        (turn, index) =>
          turn.role === turns[index]?.role && turn.message?.slice(0, 10000) === turns[index].text,
      );
    const reportedDuration = details.metadata?.call_duration_secs ?? 0;
    const duration = reportedDuration > 0 ? reportedDuration : null;
    const segments = matches
      ? transcript.flatMap((turn, turnIndex) =>
          turn.time_in_call_secs === undefined
            ? []
            : [{ turnIndex, startSeconds: turn.time_in_call_secs }],
        )
      : [];
    const ordered = segments.every(
      (segment, index) =>
        segment.startSeconds >= (segments[index - 1]?.startSeconds ?? 0) &&
        (duration === null || segment.startSeconds <= duration),
    );
    return recordingPlaybackSchema.parse({
      available: details.has_audio,
      durationSeconds: duration,
      segments: ordered ? segments : [],
      label: 'ElevenLabs provider recording',
      reason: !details.has_audio
        ? 'The provider has no retained audio for this session.'
        : !matches || !ordered || !segments.length
          ? 'Audio is available, but provider timing could not be aligned with the saved transcript.'
          : null,
    });
  }
  async audio(apiKey: string, conversationId: string) {
    const response = await this.fetch(apiKey, conversationId, '/audio');
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (
      ![
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/x-wav',
        'audio/ogg',
        'audio/webm',
        'audio/mp4',
      ].includes(contentType) ||
      Number(response.headers.get('content-length') ?? 0) > RECORDING_BYTE_LIMIT ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new Error('Unsupported recording response.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > RECORDING_BYTE_LIMIT) throw new Error('Recording is too large.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    if (!size) throw new Error('Recording is empty.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes, contentType };
  }
}
