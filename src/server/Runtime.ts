import { PrismaStore } from '../infrastructure/PrismaStore.js';
import { DemoResearch, LiveResearch } from '../infrastructure/Research.js';
import { WorkspaceService } from '../features/WorkspaceService.js';
import type { Environment } from './Env.js';
import {
  DemoScenarioGenerator,
  LiveScenarioGenerator,
} from '../infrastructure/ScenarioGeneration.js';
export function createRuntime(env: Environment) {
  const store = new PrismaStore(env.DATABASE_URL);
  if (env.RESEARCH_MODE === 'live' && (!env.EXA_API_KEY || !env.OPENAI_API_KEY)) {
    throw new Error('Live research requires EXA_API_KEY and OPENAI_API_KEY.');
  }
  const research =
    env.RESEARCH_MODE === 'live' && env.EXA_API_KEY && env.OPENAI_API_KEY
      ? new LiveResearch(env.EXA_API_KEY, env.OPENAI_API_KEY, env.RESEARCH_MODEL)
      : new DemoResearch();
  const generator =
    env.SCENARIO_MODE === 'live' && env.OPENAI_API_KEY
      ? new LiveScenarioGenerator(env.OPENAI_API_KEY, env.SCENARIO_MODEL)
      : new DemoScenarioGenerator();
  return new WorkspaceService(store, research, { store, generator });
}
