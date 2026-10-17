import type { PracticeContext } from '../contracts/PracticeContext.js';

export interface AvatarSettings {
  apiKey: string;
  avatarId: string;
  agentId: string;
  elevenLabsSecretId: string;
}

export interface AvatarProvider {
  createToken(
    settings: AvatarSettings,
    context: PracticeContext,
    sessionId: string,
    nonce: string,
  ): Promise<{ token: string; avatarSessionId: string }>;
  stopSession(apiKey: string, avatarSessionId: string): Promise<void>;
}
