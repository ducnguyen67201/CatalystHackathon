import type { PracticeContext } from '../contracts/PracticeContext.js';
import type { TranscriptTurn } from '../contracts/Workspace.js';

export interface AvatarSettings {
  apiKey: string;
  avatarId: string;
  voiceId: string;
  contextId: string;
}

export interface AvatarProvider {
  createToken(
    settings: AvatarSettings,
    context: PracticeContext,
  ): Promise<{ token: string; avatarSessionId: string }>;
  stopSession(apiKey: string, avatarSessionId: string): Promise<void>;
  fetchTranscript(apiKey: string, avatarSessionId: string): Promise<TranscriptTurn[] | null>;
}
