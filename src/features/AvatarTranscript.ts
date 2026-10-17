import type { WorkspaceService } from './WorkspaceService.js';
import type { AvatarProvider } from './AvatarProvider.js';

/** Shared browser/manual and durable-worker intake. Only the stored provider ID is trusted. */
export async function retrieveFinalAvatarTranscript(
  service: WorkspaceService,
  provider: AvatarProvider,
  apiKey: string | undefined,
  id: string,
): Promise<boolean> {
  const session = (await service.read()).rehearsals.find((s) => s.id === id);
  if (!session || session.mode !== 'liveavatar' || !session.avatarSessionId)
    throw new Error('LiveAvatar session unavailable.');
  if (session.transcriptReceivedAt) return true;
  if (!apiKey) throw new Error('LiveAvatar configuration unavailable.');
  if (session.status === 'active') return false;
  const turns = await provider.fetchTranscript(apiKey, session.avatarSessionId);
  if (!turns) return false;
  await service.finishRehearsal(id, turns, session.status === 'awaiting_transcript', true);
  return true;
}
