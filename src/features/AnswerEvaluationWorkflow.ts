import type { Coaching, EvidenceCheck, Extraction } from '../contracts/RehearsalEvaluation.js';
import type { EvaluationInput, EvaluationProvider } from './EvaluationProvider.js';
import { checkClaims, validateCoaching } from './EvaluationChecks.js';
import { evaluationStage } from './EvaluationFailure.js';

export async function runAnswerEvaluation(
  provider: EvaluationProvider,
  input: EvaluationInput,
  extraction: Extraction,
): Promise<{ checks: EvidenceCheck[]; coaching: Coaching }> {
  const checks = checkClaims(extraction, input);
  const coaching = await evaluationStage('coaching', async () =>
    validateCoaching(await provider.coach(input, extraction, checks), extraction, input, checks),
  );
  return { checks, coaching };
}
