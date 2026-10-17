import { defineConfig } from '@trigger.dev/sdk';
import { readWorkflowEnvironment } from './src/server/Env.js';
import { loadEnvironmentValues } from './src/server/LoadEnvironment.js';

const env = readWorkflowEnvironment(loadEnvironmentValues(process.env));
export default defineConfig({
  project: env.TRIGGER_PROJECT_REF,
  dirs: ['./src/jobs'],
  maxDuration: 300,
});
