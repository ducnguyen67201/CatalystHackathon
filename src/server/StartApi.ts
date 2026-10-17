import { loadEnvironmentValues } from './LoadEnvironment.js';
import { readEnvironment } from './Env.js';
import { createRuntime } from './Runtime.js';
import { createApi } from './Api.js';
try {
  const env = readEnvironment(loadEnvironmentValues(process.env));
  const service = createRuntime(env);
  await service.read();
  const app = await createApi(service, env);
  await app.listen({ host: '127.0.0.1', port: env.API_PORT });
  console.log(`June API ready at http://127.0.0.1:${env.API_PORT}`);
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
