import { loadEnvironmentValues } from './LoadEnvironment.js';
import { readEnvironment } from './Env.js';
import { createRuntime } from './Runtime.js';
import { createApi } from './Api.js';
try {
  const env = readEnvironment(loadEnvironmentValues(process.env));
  const service = createRuntime(env);
  await service.read();
  const app = await createApi(service, env);
  const host = env.HOSTING_MODE === 'hosted' ? '0.0.0.0' : '127.0.0.1';
  const port = env.HOSTING_MODE === 'hosted' ? (env.PORT ?? env.API_PORT) : env.API_PORT;
  await app.listen({ host, port });
  console.log(`June API ready on port ${port} (${env.HOSTING_MODE})`);
  let closing = false;
  const close = () => {
    if (closing) {
      return;
    }
    closing = true;
    void app.close().then(() => service.store.close());
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  console.error('June API could not start. Run pnpm setup and check Doppler or .env settings.');
  process.exitCode = 1;
}
