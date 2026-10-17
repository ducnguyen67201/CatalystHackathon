import {
  voiceSessionResponseSchema,
  type VoiceSessionResponse,
} from '../contracts/VoicePractice.js';
import { command, request } from './ApiClient.js';

/** The server supplies context. The browser cannot submit company facts or a prompt. */
export async function startVoicePractice(): Promise<VoiceSessionResponse> {
  return request('/voice/sessions', voiceSessionResponseSchema, {});
}

export async function endVoicePractice(sessionId: string, completed: boolean): Promise<void> {
  await command(`/rehearsals/${encodeURIComponent(sessionId)}/end`, { turns: [], completed });
}
