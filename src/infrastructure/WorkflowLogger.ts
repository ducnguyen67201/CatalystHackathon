import {
  EvaluationFailure,
  evaluationStageSchema,
  evaluationFailureCodeSchema,
} from '../features/EvaluationFailure.js';
import { ResearchConfigurationError } from '../features/ResearchProvider.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import {
  LogReason,
  type LogFields,
  type LogLevel,
  type WorkflowLog,
} from '../features/WorkflowLog.js';

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};
const fieldsSchema = z.object({
  runId: z.uuid().optional(),
  jobId: z.string().max(100).optional(),
  jobKind: z.string().max(150).optional(),
  attempt: z.number().optional(),
  mode: z.enum(['demo', 'live']).optional(),
  provider: z.enum(['exa', 'openai']).optional(),
  sourceIndex: z.number().optional(),
  count: z.number().optional(),
  addedCount: z.number().optional(),
  changedCount: z.number().optional(),
  durationMs: z.number().optional(),
  statusCode: z.number().optional(),
  evaluationStage: evaluationStageSchema.optional(),
  evaluationCode: evaluationFailureCodeSchema.optional(),
  reason: z.enum(LogReason).optional(),
});

/** JSON lines to stdout; an allowlist prevents accidental extra fields from entering logs. */
export class WorkflowLogger implements WorkflowLog {
  private readonly context = new AsyncLocalStorage<LogFields>();

  constructor(
    private readonly level: LogLevel = 'debug',
    private readonly output: (line: string) => void = (line) => console.log(line),
  ) {}

  write(
    event: Parameters<WorkflowLog['write']>[0],
    fields: LogFields = {},
    level: LogLevel = 'info',
  ): void {
    if (
      this.level === 'silent' ||
      level === 'silent' ||
      priorities[level] < priorities[this.level]
    ) {
      return;
    }
    const safe = fieldsSchema.safeParse({ ...this.context.getStore(), ...fields });
    this.output(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        event,
        ...(safe.success ? safe.data : {}),
      }),
    );
  }

  run<T>(fields: LogFields, operation: () => Promise<T>): Promise<T> {
    return this.context.run(fields, operation);
  }
}

export class ProviderRequestError extends Error {
  constructor(
    readonly provider: 'exa' | 'openai',
    readonly statusCode: number,
  ) {
    super(`Research provider request failed (${statusCode}).`);
  }
}

/** Classifies failures without exposing provider error bodies or arbitrary exception messages. */
export function describeResearchFailure(error: unknown): LogFields {
  if (error instanceof EvaluationFailure) {
    return {
      reason: LogReason.EVALUATION_FAILED,
      evaluationStage: error.stage,
      evaluationCode: error.code,
      ...(error.statusCode === undefined
        ? {}
        : { provider: 'openai', statusCode: error.statusCode }),
    };
  }
  if (error instanceof ResearchConfigurationError) {
    return { reason: LogReason.CONFIGURATION_MISSING };
  }
  if (error instanceof ProviderRequestError) {
    return { reason: LogReason.HTTP_ERROR, provider: error.provider, statusCode: error.statusCode };
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return { reason: LogReason.INVALID_RESPONSE };
  }
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
    return { reason: LogReason.TIMEOUT };
  }
  if (error instanceof TypeError) {
    return { reason: LogReason.NETWORK_ERROR };
  }
  if (
    error instanceof Error &&
    (error.message.startsWith('Profile changed') ||
      error.message.startsWith('Investor identity changed'))
  ) {
    return { reason: LogReason.STALE_CONTEXT };
  }
  return { reason: LogReason.UNKNOWN };
}
