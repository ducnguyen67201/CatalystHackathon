import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

const databaseUrlSchema = z.url({ protocol: /^postgres(?:ql)?:?$/ });
const apiPortSchema = z.coerce.number().int().min(1024).max(65535).default(4318);
const webOriginSchema = z
  .url()
  .pipe(
    z.string().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password &&
        Number(url.port) >= 1024 &&
        Number(url.port) <= 65535
      );
    }),
  )
  .default('http://127.0.0.1:4317');

function rejectSettings(): never {
  throw new Error('Invalid environment settings. Check Doppler or .env against .env.example.');
}

/** Validate caller-supplied settings without reading or mutating process.env. */
export function readEnvironment(values: EnvironmentValues) {
  const env = createEnv({
    server: {
      DATABASE_URL: databaseUrlSchema,
      API_PORT: apiPortSchema,
      WEB_ORIGIN: webOriginSchema,
      EVALUATION_MODEL: z.string().min(1).default('gpt-6.1-sol'),
      RESEARCH_MODE: z.enum(['demo', 'live']).default('demo'),
      EXA_API_KEY: z.string().optional(),
      OPENAI_API_KEY: z.string().optional(),
      RESEARCH_MODEL: z.string().default('gpt-6.1-sol'),
      ELEVENLABS_API_KEY: z.string().optional(),
      ELEVENLABS_AGENT_ID: z.string().optional(),
      ELEVENLABS_WEBHOOK_SECRET: z.string().optional(),
      LIVEAVATAR_API_KEY: z.string().optional(),
      LIVEAVATAR_AVATAR_ID: z.uuid().optional(),
      LIVEAVATAR_VOICE_ID: z.uuid().optional(),
      LIVEAVATAR_CONTEXT_ID: z.uuid().optional(),
      TRIGGER_PROJECT_REF: z.string().optional(),
    },
    runtimeEnv: { ...values },
    emptyStringAsUndefined: true,
    onValidationError: rejectSettings,
  });
  if (env.RESEARCH_MODE === 'live' && (!env.EXA_API_KEY || !env.OPENAI_API_KEY)) {
    rejectSettings();
  }
  return env;
}

export type Environment = ReturnType<typeof readEnvironment>;

/** Tooling validates only the settings needed for that command. */
export function readDatabaseEnvironment(values: EnvironmentValues) {
  return createEnv({
    server: { DATABASE_URL: databaseUrlSchema },
    runtimeEnv: { ...values },
    emptyStringAsUndefined: true,
    onValidationError: rejectSettings,
  });
}

export function readDevelopmentEnvironment(values: EnvironmentValues) {
  const env = createEnv({
    server: { API_PORT: apiPortSchema, WEB_ORIGIN: webOriginSchema },
    runtimeEnv: { ...values },
    emptyStringAsUndefined: true,
    onValidationError: rejectSettings,
  });
  if (new URL(env.WEB_ORIGIN).port === String(env.API_PORT)) {
    rejectSettings();
  }
  return env;
}

export function readWorkflowEnvironment(values: EnvironmentValues) {
  return createEnv({
    server: { TRIGGER_PROJECT_REF: z.string().min(1) },
    runtimeEnv: { ...values },
    emptyStringAsUndefined: true,
    onValidationError: rejectSettings,
  });
}

/** Optional local tunnel settings; never consumed by the browser. */
export function readTunnelEnvironment(values: EnvironmentValues) {
  const env = createEnv({
    server: {
      API_PORT: apiPortSchema,
      WEB_ORIGIN: webOriginSchema,
      DEV_WEBHOOK_TUNNEL: z.enum(['true', 'false']).default('false'),
      DEV_WEBHOOK_PORT: z.coerce.number().int().min(1024).max(65535).default(4319),
      DEV_WEBHOOK_URL: z.url({ protocol: /^https$/ }).optional(),
      NGROK_AUTHTOKEN: z.string().optional(),
    },
    runtimeEnv: { ...values },
    emptyStringAsUndefined: true,
    onValidationError: rejectSettings,
  });
  if (
    env.DEV_WEBHOOK_TUNNEL === 'true' &&
    [env.API_PORT, Number(new URL(env.WEB_ORIGIN).port)].includes(env.DEV_WEBHOOK_PORT)
  ) {
    rejectSettings();
  }
  return env;
}
