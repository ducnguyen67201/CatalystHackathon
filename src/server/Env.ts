import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
export function readEnvironment(values: NodeJS.ProcessEnv = process.env) {
  return createEnv({
    server: {
      DATABASE_URL: z.string().min(1),
      API_PORT: z.coerce.number().int().min(1024).max(65535).default(4318),
      WEB_ORIGIN: z.url().default('http://127.0.0.1:4317'),
      RESEARCH_MODE: z.enum(['demo', 'live']).default('demo'),
      EXA_API_KEY: z.string().optional(),
      OPENAI_API_KEY: z.string().optional(),
      RESEARCH_MODEL: z.string().default('gpt-4.1-mini'),
      DAILY_RESEARCH_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
      ELEVENLABS_API_KEY: z.string().optional(),
      ELEVENLABS_AGENT_ID: z.string().optional(),
      ELEVENLABS_WEBHOOK_SECRET: z.string().optional(),
      TRIGGER_PROJECT_REF: z.string().optional(),
    },
    runtimeEnv: values,
    emptyStringAsUndefined: true,
    onValidationError: () => {
      throw new Error('Invalid server settings. Check .env against .env.example.');
    },
  });
}
export type Environment = ReturnType<typeof readEnvironment>;
