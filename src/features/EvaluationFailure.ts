import { z } from 'zod';

export const evaluationStageSchema = z.enum(['extraction', 'coaching']);
export const evaluationFailureCodeSchema = z.enum([
  'unstated_claim_value',
  'invalid_evidence',
  'invalid_response',
  'incomplete_output',
  'configuration_missing',
  'http_error',
  'timeout',
  'network_error',
  'input_too_large',
]);
export type EvaluationStage = z.infer<typeof evaluationStageSchema>;
export type EvaluationFailureCode = z.infer<typeof evaluationFailureCodeSchema>;

/** Only stage/code/status enter workflow logs; messages and evidence remain private. */
export class EvaluationFailure extends Error {
  constructor(
    readonly stage: EvaluationStage,
    readonly code: EvaluationFailureCode,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

export async function evaluationStage<T>(
  stage: EvaluationStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof EvaluationFailure) throw error;
    const code =
      error instanceof z.ZodError || error instanceof SyntaxError
        ? 'invalid_response'
        : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
          ? 'timeout'
          : error instanceof TypeError
            ? 'network_error'
            : 'invalid_evidence';
    throw new EvaluationFailure(stage, code, 'Evaluation stage failed.');
  }
}
