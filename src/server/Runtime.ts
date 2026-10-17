import { LiveEvaluation } from '../infrastructure/Evaluation.js';
import { LiveAvatarProvider } from '../infrastructure/LiveAvatar.js';
import { retrieveFinalAvatarTranscript } from '../features/AvatarTranscript.js';
import { PrismaStore } from '../infrastructure/PrismaStore.js';
import { DemoResearch, LiveResearch } from '../infrastructure/Research.js';
import { WorkspaceService } from '../features/WorkspaceService.js';
import type { Environment } from './Env.js';
export function createRuntime(env: Environment) {
  const store = new PrismaStore(env.DATABASE_URL);
  if (env.RESEARCH_MODE === 'live' && (!env.EXA_API_KEY || !env.OPENAI_API_KEY)) {
    throw new Error('Live research requires EXA_API_KEY and OPENAI_API_KEY.');
  }
  const research =
    env.RESEARCH_MODE === 'live' && env.EXA_API_KEY && env.OPENAI_API_KEY
      ? new LiveResearch(env.EXA_API_KEY, env.OPENAI_API_KEY, env.RESEARCH_MODEL)
      : new DemoResearch();
  const evaluator = new LiveEvaluation(env.OPENAI_API_KEY, env.EVALUATION_MODEL);
  const service = new WorkspaceService(store, research, evaluator);
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
  return service;
}
