import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LiveAvatarProvider } from '../src/infrastructure/LiveAvatar.js';
import { createEmptyPracticeContext } from '../src/contracts/PracticeContext.js';
import { readEnvironment } from '../src/server/Env.js';
import { isAvatarConfigured } from '../src/server/AvatarRoutes.js';

const avatarId = 'b672e83f-398a-4701-ac89-949fe3b680ea';
const secretId = 'b822515d-d4a5-431c-bbc4-059bfca7b702';
const providerSessionId = '67a1123f-a915-48c8-9d4c-aae60df15846';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LiveAvatar adapter', () => {
  it('creates a bounded ElevenLabs connector session with empty context and webhook correlation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 1000,
          data: { session_id: providerSessionId, session_token: 'short-lived-token' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await new LiveAvatarProvider().createToken(
      {
        apiKey: 'server-key',
        avatarId,
        agentId: 'eleven-agent',
        elevenLabsSecretId: secretId,
      },
      createEmptyPracticeContext(),
      'app-session',
      'test-nonce',
    );
    expect(response).toEqual({ token: 'short-lived-token', avatarSessionId: providerSessionId });
    const call = fetchMock.mock.calls.at(0);
    expect(call?.[0]).toBe('https://api.liveavatar.com/v1/sessions/token');
    const raw: unknown = JSON.parse(z.string().parse(call?.[1]?.body));
    expect(raw).toMatchObject({
      mode: 'LITE',
      max_session_duration: 600,
      avatar_id: avatarId,
      elevenlabs_agent_config: {
        agent_id: 'eleven-agent',
        secret_id: secretId,
        dynamic_variables: {
          june_session_id: 'app-session',
          june_session_nonce: 'test-nonce',
          company_name: 'the founder',
        },
      },
    });
    expect(JSON.stringify(raw)).not.toContain('server-key');
  });

  it('rejects malformed provider tokens and accepts stopping an already missing session', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"code":1000,"data":null}'))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new LiveAvatarProvider();
    await expect(
      provider.createToken(
        { apiKey: 'key', avatarId, agentId: 'agent', elevenLabsSecretId: secretId },
        createEmptyPracticeContext(),
        'app',
        'nonce',
      ),
    ).rejects.toThrow();
    await expect(provider.stopSession('key', providerSessionId)).resolves.toBeUndefined();
  });

  it('keeps video unavailable until the complete connector configuration is supplied', () => {
    const base = { DATABASE_URL: 'postgresql://example:example@localhost/example' };
    expect(isAvatarConfigured(readEnvironment(base))).toBe(false);
    expect(
      isAvatarConfigured(
        readEnvironment({
          ...base,
          LIVEAVATAR_API_KEY: 'key',
          LIVEAVATAR_AVATAR_ID: avatarId,
          LIVEAVATAR_ELEVENLABS_SECRET_ID: secretId,
          ELEVENLABS_AGENT_ID: 'agent',
          ELEVENLABS_WEBHOOK_SECRET: 'secret',
        }),
      ),
    ).toBe(true);
  });

  it('accepts the live API stop success code without a fallback lookup', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ code: 1000, data: null })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new LiveAvatarProvider().stopSession('key', providerSessionId),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-success envelope even when token fields are present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 100,
            data: { session_id: providerSessionId, session_token: 'untrusted-token' },
          }),
        ),
      ),
    );
    await expect(
      new LiveAvatarProvider().createToken(
        { apiKey: 'key', avatarId, agentId: 'agent', elevenLabsSecretId: secretId },
        createEmptyPracticeContext(),
        'app',
        'nonce',
      ),
    ).rejects.toThrow();
  });

  it('confirms an already-ended session after a duplicate stop, but rejects an active one', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 1000,
            data: {
              id: providerSessionId,
              end_at: '2026-10-17T01:00:00Z',
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 409 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 1000, data: { id: providerSessionId } })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new LiveAvatarProvider();
    await expect(provider.stopSession('key', providerSessionId)).resolves.toBeUndefined();
    await expect(provider.stopSession('key', providerSessionId)).rejects.toThrow(
      'could not be stopped',
    );
  });
});
