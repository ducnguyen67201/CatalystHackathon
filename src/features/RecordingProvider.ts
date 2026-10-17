import type { TranscriptTurn } from '../contracts/Workspace.js';
import type { RecordingPlayback } from '../contracts/RecordingPlayback.js';

export const RECORDING_BYTE_LIMIT = 20 * 1024 * 1024;
export interface RecordingProvider {
  describe(
    apiKey: string,
    conversationId: string,
    turns: TranscriptTurn[],
  ): Promise<RecordingPlayback>;
  audio(
    apiKey: string,
    conversationId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string }>;
}
