import { readTunnelEnvironment } from './Env.js';
import { createWebhookRelay } from './WebhookRelay.js';

try {
  const env = readTunnelEnvironment(process.env);
  const app = createWebhookRelay(env.API_PORT);
  await app.listen({ host: '127.0.0.1', port: env.DEV_WEBHOOK_PORT });
  console.log(`Webhook-only relay ready on 127.0.0.1:${env.DEV_WEBHOOK_PORT}.`);

  const close = (): void => {
    void app.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  console.error('Webhook relay could not start. Check local ports and development settings.');
  process.exitCode = 1;
}
