import 'dotenv/config';
import { schedules, task } from '@trigger.dev/sdk';
import { readEnvironment } from '../server/Env.js';
import { createRuntime } from '../server/Runtime.js';
import { runWorkerTick } from '../server/Worker.js';
export const processJuneWork = task({
  id: 'june-process-work',
  maxDuration: 300,
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  run: async () => {
    const env = readEnvironment();
    const service = createRuntime(env);
    try {
      await runWorkerTick(service, env.DAILY_RESEARCH_ATTEMPT_LIMIT);
    } finally {
      await service.store.close();
    }
  },
});
export const checkJuneSchedules = schedules.task({
  id: 'june-check-schedules',
  cron: '* * * * *',
  run: async () => {
    await processJuneWork.trigger();
  },
});
