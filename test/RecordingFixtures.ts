import type { RecordingProvider } from '../src/features/RecordingProvider.js';

/** Synthetic tones for test/preview playback only. This is not a recording of a person. */
export function fictionalRecordingAudio(): Uint8Array {
  const rate = 8000;
  const seconds = 18;
  const data = new ArrayBuffer(44 + rate * seconds * 2);
  const view = new DataView(data);
  const word = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++)
      view.setUint8(offset + index, text.charCodeAt(index));
  };
  word(0, 'RIFF');
  view.setUint32(4, data.byteLength - 8, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, 'data');
  view.setUint32(40, data.byteLength - 44, true);
  for (let index = 0; index < rate * seconds; index++) {
    const time = index / rate;
    const envelope = Math.max(0, Math.sin(time * 2.1)) * 0.24;
    view.setInt16(
      44 + index * 2,
      Math.round(Math.sin(time * Math.PI * 2 * 220) * envelope * 32767),
      true,
    );
  }
  return new Uint8Array(data);
}
export const fictionalRecordingProvider: RecordingProvider = {
  describe: (_apiKey, _conversationId, turns) =>
    Promise.resolve({
      available: true,
      durationSeconds: 18,
      segments: turns.map((_turn, turnIndex) => ({
        turnIndex,
        startSeconds: turnIndex === 0 ? 0 : turnIndex === 1 ? 4 : 11,
      })),
      label: 'Fictional synthetic audio · tones, not speech',
      reason: null,
    }),
  audio: () => Promise.resolve({ bytes: fictionalRecordingAudio(), contentType: 'audio/wav' }),
};
