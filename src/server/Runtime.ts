import { ResendEmailSender } from '../infrastructure/EmailNotifications.js';
import { LogEvent, LogReason } from '../features/WorkflowLog.js';
import { WorkflowLogger } from '../infrastructure/WorkflowLogger.js';
import { PrismaStore } from '../infrastructure/PrismaStore.js';
import { LiveResearch } from '../infrastructure/Research.js';
import { WorkspaceService } from '../features/WorkspaceService.js';
import type { Environment } from './Env.js';
export function createRuntime(env: Environment) {
  const logger = new WorkflowLogger(env.LOG_LEVEL);
  const store = new PrismaStore(env.DATABASE_URL);
  const research = new LiveResearch(
    env.EXA_API_KEY,
    env.OPENAI_API_KEY,
    env.RESEARCH_MODEL,
    logger,
    store,
  );
  if (!env.EXA_API_KEY || !env.OPENAI_API_KEY) {
    logger.write(
      LogEvent.RESEARCH_UNAVAILABLE,
      { reason: LogReason.CONFIGURATION_MISSING },
      'warn',
    );
  }
  const service = new WorkspaceService(store, research, logger, store);
  if (env.RESEND_API_KEY && env.NOTIFICATION_FROM)
    service.radar.configure(
      new ResendEmailSender(env.RESEND_API_KEY),
      env.NOTIFICATION_FROM,
      env.WEB_ORIGIN,
    );
  return service;
}
