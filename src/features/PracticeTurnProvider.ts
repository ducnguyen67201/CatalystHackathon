import type { EvidenceCheck, Extraction } from '../contracts/RehearsalEvaluation.js';
import type { EvaluationInput } from './EvaluationProvider.js';
import type { PracticeTurnOutput } from '../contracts/GuidedPractice.js';

export interface PracticeTurnInput {
  evaluation: EvaluationInput;
  extraction: Extraction;
  checks: EvidenceCheck[];
  resolvedFindingIds: string[];
}
export interface PracticeTurnProvider {
  readonly model: string;
  generate(input: PracticeTurnInput): Promise<PracticeTurnOutput>;
}
