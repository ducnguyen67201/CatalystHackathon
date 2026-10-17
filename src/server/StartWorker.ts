import 'dotenv/config';
import { readEnvironment } from './Env.js';
import { createRuntime } from './Runtime.js';
import { startWorker } from './Worker.js';
try {
  const env = readEnvironment();
  const service = createRuntime(env);
  await service.read();
  const stop = startWorker(service, env.DAILY_RESEARCH_ATTEMPT_LIMIT);
  console.log('June worker ready. Schedules begin paused.');
  const close = () => {
    stop();
    void service.store.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  console.error('Worker could not start. Run pnpm setup and check .env.');
  process.exitCode = 1;
}
