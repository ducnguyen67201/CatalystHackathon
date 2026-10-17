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

const hostedOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
});
const hostedAccountsSchema = z
  .string()
  .transform((value, context) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid account configuration.' });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.strictObject({
          username: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
          passwordSha256: z.string().regex(/^[a-f0-9]{64}$/),
          workspaceId: z.literal('tidewell'),
        }),
      )
      .min(1)
      .max(20),
  )
  .refine(
    (accounts) => new Set(accounts.map((account) => account.username)).size === accounts.length,
  );

function rejectSettings(): never {
  throw new Error('Invalid environment settings. Check Doppler or .env against .env.example.');
}

/** Validate caller-supplied settings without reading or mutating process.env. */
export function readEnvironment(values: EnvironmentValues) {
  const env = createEnv({
    server: {
      DATABASE_URL: databaseUrlSchema,
      HOSTING_MODE: z.enum(['local', 'hosted']).default('local'),
      HOSTED_ACCESS_MODE: z.enum(['accounts', 'public-demo']).default('accounts'),
      PORT: z.coerce.number().int().min(1024).max(65535).optional(),
      HOSTED_ACCOUNTS: hostedAccountsSchema.optional(),
      API_PORT: apiPortSchema,
      WEB_ORIGIN: z.string().default('http://127.0.0.1:4317'),
      EVALUATION_MODEL: z.string().min(1).default('gpt-6.1-sol'),
      LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('debug'),
      RESEND_API_KEY: z.string().optional(),
      NOTIFICATION_FROM: z.email().optional(),
      EXA_API_KEY: z.string().optional(),
      OPENAI_API_KEY: z.string().optional(),
      RESEARCH_MODEL: z.string().default('gpt-6.1-sol'),
      SCENARIO_MODE: z.enum(['demo', 'live']).default('demo'),
      SCENARIO_MODEL: z.string().min(1).max(200).default('gpt-6.1-sol'),
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
  const origin = env.HOSTING_MODE === 'hosted' ? hostedOriginSchema : webOriginSchema;
  if (!origin.safeParse(env.WEB_ORIGIN).success) rejectSettings();
  if (
    env.HOSTING_MODE === 'hosted' &&
    env.HOSTED_ACCESS_MODE === 'accounts' &&
    !env.HOSTED_ACCOUNTS
  )
    rejectSettings();
  if (env.SCENARIO_MODE === 'live' && !env.OPENAI_API_KEY) rejectSettings();
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
