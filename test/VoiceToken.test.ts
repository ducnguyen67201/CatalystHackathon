import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceToken } from '../src/infrastructure/Voice.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ElevenLabs token boundary', () => {
  it('keeps the server-issued conversation identity with the browser token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'temporary-token',
          conversation_id: 'provider-conversation',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await createVoiceToken('server-only-key', 'private-agent')).toEqual({
      token: 'temporary-token',
      conversationId: 'provider-conversation',
    });
    const call = fetchMock.mock.calls.at(0);
    expect(call?.[0]).toEqual(
      new URL('https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=private-agent'),
    );
    expect(call?.[1]?.headers).toEqual({ 'xi-api-key': 'server-only-key' });
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a provider response without a verifiable conversation mapping', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{"token":"temporary-token"}')),
    );
    await expect(createVoiceToken('key', 'agent')).rejects.toThrow();
  });
});
