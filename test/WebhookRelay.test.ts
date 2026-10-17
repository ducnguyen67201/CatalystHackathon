import { describe, expect, it, vi } from 'vitest';
import { createWebhookRelay, ElevenLabsWebhookPath } from '../src/server/WebhookRelay.js';
import { readTunnelEnvironment } from '../src/server/Env.js';

describe('Webhook-only development relay', () => {
  it('forwards exact signed bytes to the fixed local API and strips unrelated headers', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const app = createWebhookRelay(4318, send);
    const payload = '{ "message": "café", "number": 1 }\n';
    try {
      const response = await app.inject({
        method: 'POST',
        url: ElevenLabsWebhookPath,
        payload,
        headers: {
          'content-type': 'application/json',
          'elevenlabs-signature': 't=1,v0=test',
          cookie: 'private-cookie',
          authorization: 'private-authorization',
        },
      });
      expect(response.statusCode).toBe(200);
      const call = send.mock.calls[0];
      expect(call?.[0]).toBe(`http://127.0.0.1:4318${ElevenLabsWebhookPath}`);
      expect(call?.[1]?.body).toEqual(new Uint8Array(Buffer.from(payload)));
      expect(call?.[1]?.headers).toEqual({
        'content-type': 'application/json',
        'elevenlabs-signature': 't=1,v0=test',
      });
      expect(call?.[1]?.redirect).toBe('error');
    } finally {
      await app.close();
    }
  });

  it('rejects other paths, methods, missing signatures, oversized bodies and non-JSON content', async () => {
    const send = vi.fn<typeof fetch>();
    const app = createWebhookRelay(4318, send);
    try {
      for (const url of [
        '/api/state',
        '/api/session',
        '/',
        `${ElevenLabsWebhookPath}?redirect=1`,
      ]) {
        expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(404);
      }
      expect((await app.inject({ method: 'GET', url: ElevenLabsWebhookPath })).statusCode).toBe(
        404,
      );
      expect(
        (await app.inject({ method: 'POST', url: ElevenLabsWebhookPath, payload: {} })).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: ElevenLabsWebhookPath,
            payload: 'x',
            headers: { 'content-type': 'text/plain', 'elevenlabs-signature': 'test' },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: ElevenLabsWebhookPath,
            payload: 'x'.repeat(2_000_001),
            headers: { 'content-type': 'application/json', 'elevenlabs-signature': 'test' },
          })
        ).statusCode,
      ).toBe(413);
      expect(send).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('preserves upstream rejection status without exposing its body', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private upstream detail', { status: 401 }));
    const app = createWebhookRelay(4318, send);
    try {
      const response = await app.inject({
        method: 'POST',
        url: ElevenLabsWebhookPath,
        payload: {},
        headers: { 'elevenlabs-signature': 'invalid' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.body).toBe('{"accepted":false}');
    } finally {
      await app.close();
    }
  });

  it('requires explicit tunnel enablement and rejects colliding ports', () => {
    expect(readTunnelEnvironment({}).DEV_WEBHOOK_TUNNEL).toBe('false');
    expect(() =>
      readTunnelEnvironment({ DEV_WEBHOOK_TUNNEL: 'true', DEV_WEBHOOK_PORT: '4318' }),
    ).toThrow();
    expect(() =>
      readTunnelEnvironment({ DEV_WEBHOOK_TUNNEL: 'true', DEV_WEBHOOK_PORT: '4317' }),
    ).toThrow();
    expect(() => readTunnelEnvironment({ DEV_WEBHOOK_TUNNEL: 'yes' })).toThrow();
  });
});
