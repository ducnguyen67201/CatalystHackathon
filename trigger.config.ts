import { defineConfig } from '@trigger.dev/sdk';
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? 'configure-project-reference',
  dirs: ['./src/jobs'],
  maxDuration: 300,
});
