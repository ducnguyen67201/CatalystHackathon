import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

export const ElevenLabsWebhookPath = '/api/webhooks/elevenlabs';

/** Exposes one fixed callback route; the API remains responsible for HMAC verification. */
export function createWebhookRelay(
  apiPort: number,
  sendRequest: typeof fetch = fetch,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST' || request.raw.url !== ElevenLabsWebhookPath) {
      await reply.code(404).send({ error: 'Not found.' });
    }
  });

  app.post(ElevenLabsWebhookPath, async (request, reply) => {
    const signature = request.headers['elevenlabs-signature'];
    if (typeof signature !== 'string' || !signature || !Buffer.isBuffer(request.body)) {
      return reply.code(400).send({ error: 'A signed JSON webhook is required.' });
    }

    try {
      const response = await sendRequest(`http://127.0.0.1:${apiPort}${ElevenLabsWebhookPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'elevenlabs-signature': signature },
        body: new Uint8Array(request.body),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      // Keep provider callbacks and upstream error details out of the public response.
      return await reply.code(response.status).send({ accepted: response.ok });
    } catch {
      console.warn(JSON.stringify({ event: 'webhook_relay_failed' }));
      return reply.code(502).send({ error: 'Local callback service unavailable.' });
    }
  });

  return app;
}
