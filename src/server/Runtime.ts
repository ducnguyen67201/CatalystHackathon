import { ResendEmailSender } from '../infrastructure/EmailNotifications.js';
import { LiveEvaluation } from '../infrastructure/Evaluation.js';
import { LivePracticeTurn } from '../infrastructure/PracticeTurn.js';
import { LiveAvatarProvider } from '../infrastructure/LiveAvatar.js';
import { retrieveFinalAvatarTranscript } from '../features/AvatarTranscript.js';
import { LogEvent, LogReason } from '../features/WorkflowLog.js';
import { WorkflowLogger } from '../infrastructure/WorkflowLogger.js';
import { PrismaStore } from '../infrastructure/PrismaStore.js';
import { LiveResearch } from '../infrastructure/Research.js';
import { LiveInvestorProfileGeneration } from '../infrastructure/InvestorProfileGeneration.js';
import { WorkspaceService } from '../features/WorkspaceService.js';
import type { Environment } from './Env.js';
import {
  DemoScenarioGenerator,
  LiveScenarioGenerator,
} from '../infrastructure/ScenarioGeneration.js';
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
  const generator =
    env.SCENARIO_MODE === 'live' && env.OPENAI_API_KEY
      ? new LiveScenarioGenerator(env.OPENAI_API_KEY, env.SCENARIO_MODEL)
      : new DemoScenarioGenerator();
  const evaluator = new LiveEvaluation(env.OPENAI_API_KEY, env.EVALUATION_MODEL);
  const service = new WorkspaceService(
    store,
    research,
    evaluator,
    logger,
    store,
    {
      store,
      generator,
    },
    env.OPENAI_API_KEY ? new LivePracticeTurn(env.OPENAI_API_KEY, env.SCENARIO_MODEL) : undefined,
    env.OPENAI_API_KEY
      ? new LiveInvestorProfileGeneration(env.OPENAI_API_KEY, env.RESEARCH_MODEL)
      : undefined,
  );
  service.retrieveAvatarTranscript = async (id) => {
    if (
      !(await retrieveFinalAvatarTranscript(
        service,
        new LiveAvatarProvider(),
        env.LIVEAVATAR_API_KEY,
        id,
      ))
    )
      throw new Error('Transcript is still processing.');
  };
  if (env.RESEND_API_KEY && env.NOTIFICATION_FROM)
    service.radar.configure(
      new ResendEmailSender(env.RESEND_API_KEY),
      env.NOTIFICATION_FROM,
      env.WEB_ORIGIN,
    );
  return service;
}
