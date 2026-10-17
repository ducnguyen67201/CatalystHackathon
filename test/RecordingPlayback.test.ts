import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElevenLabsRecording } from '../src/infrastructure/ElevenLabsRecording.js';
import { RECORDING_BYTE_LIMIT } from '../src/features/RecordingProvider.js';
import { waveformPeaks, playbackTurn, playbackTime } from '../src/web/RecordingPlayback.js';
import { fictionalRecordingAudio } from './RecordingFixtures.js';

afterEach(() => vi.unstubAllGlobals());
describe('recording retrieval and timing', () => {
  const turns = [
    { role: 'agent' as const, text: 'Question' },
    { role: 'user' as const, text: 'Answer' },
  ];
  function details() {
    return {
      has_audio: true,
      metadata: { call_duration_secs: 12 },
      transcript: [
        { role: 'agent', message: 'Question', time_in_call_secs: 0 },
        { role: 'user', message: 'Answer', time_in_call_secs: 4 },
      ],
    };
  }
  it('uses fixed authenticated provider URLs and aligns timing only with the saved transcript', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(details()));
    vi.stubGlobal('fetch', fetcher);
    const result = await new ElevenLabsRecording().describe('test-key', 'conversation/id', turns);
    expect(result.segments).toEqual([
      { turnIndex: 0, startSeconds: 0 },
      { turnIndex: 1, startSeconds: 4 },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.elevenlabs.io/v1/convai/conversations/conversation%2Fid',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      headers: { 'xi-api-key': 'test-key' },
    });
    fetcher.mockResolvedValue(Response.json(details()));
    expect(
      (
        await new ElevenLabsRecording().describe('test-key', 'id', [
          { role: 'user', text: 'Different transcript' },
        ])
      ).segments,
    ).toEqual([]);
  });
  it('rejects unsorted or out-of-duration alignment and accepts unavailable audio without a duration', async () => {
    const body = details();
    body.transcript[0] = { role: 'agent', message: 'Question', time_in_call_secs: 8 };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    expect((await new ElevenLabsRecording().describe('test-key', 'id', turns)).segments).toEqual(
      [],
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ ...details(), has_audio: false, metadata: { call_duration_secs: 0 } }),
        ),
    );
    expect(await new ElevenLabsRecording().describe('test-key', 'id', turns)).toMatchObject({
      available: false,
      durationSeconds: null,
    });
  });
  it('retrieves bounded audio and rejects HTML, oversize bodies and provider failures', async () => {
    const bytes = fictionalRecordingAudio();
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(new Uint8Array(bytes).buffer, { headers: { 'content-type': 'audio/wav' } }),
        ),
    );
    expect((await new ElevenLabsRecording().audio('test-key', 'id')).bytes).toEqual(bytes);
    for (const response of [
      new Response('HTML', { headers: { 'content-type': 'text/html' } }),
      new Response('audio', {
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': String(RECORDING_BYTE_LIMIT + 1),
        },
      }),
      new Response('private provider error', { status: 403 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response));
      await expect(new ElevenLabsRecording().audio('test-key', 'id')).rejects.toThrow();
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array(RECORDING_BYTE_LIMIT + 1), {
          headers: { 'content-type': 'audio/wav' },
        }),
      ),
    );
    await expect(new ElevenLabsRecording().audio('test-key', 'id')).rejects.toThrow('too large');
  });
  it('calculates waveform peaks from actual channels, including silence, without fabricating amplitudes', () => {
    expect(waveformPeaks([new Float32Array([0, 0.5, 0, -0.75])], 2)).toEqual([0.5, 0.75]);
    expect(waveformPeaks([new Float32Array(4)], 2)).toEqual([0, 0]);
    expect(waveformPeaks([], 2)).toEqual([]);
    expect(
      playbackTurn(
        [
          { turnIndex: 0, startSeconds: 2 },
          { turnIndex: 1, startSeconds: 5 },
        ],
        1,
      ),
    ).toBeNull();
    expect(
      playbackTurn(
        [
          { turnIndex: 0, startSeconds: 2 },
          { turnIndex: 1, startSeconds: 5 },
        ],
        6,
      ),
    ).toBe(1);
    expect(playbackTime(65)).toBe('1:05');
  });
});
