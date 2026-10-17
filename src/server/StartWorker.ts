import { LogEvent } from '../features/WorkflowLog.js';
import { loadEnvironmentValues } from './LoadEnvironment.js';
import { readEnvironment } from './Env.js';
import { createRuntime } from './Runtime.js';
import { startWorker } from './Worker.js';
try {
  const env = readEnvironment(loadEnvironmentValues(process.env));
  const service = createRuntime(env);
  await service.read();
  const stop = startWorker(service);
  service.logger.write(LogEvent.WORKER_READY, { mode: env.RESEARCH_MODE });
  const close = () => {
    stop();
    void service.store.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  console.error('Worker could not start. Run pnpm setup and check Doppler or .env settings.');
  process.exitCode = 1;
}
