import { z } from 'zod';
import { EvaluationFailure, type EvaluationStage } from '../features/EvaluationFailure.js';
import {
  coachingGenerationSchema,
  extractionSchema,
  type EvidenceCheck,
  type Extraction,
} from '../contracts/RehearsalEvaluation.js';
import {
  COACHING_PROMPT,
  EXTRACTION_PROMPT,
  type EvaluationInput,
  type EvaluationProvider,
} from '../features/EvaluationProvider.js';

/** Structured extraction/coaching calls; the caller permits one numeric correction. */
export class LiveEvaluation implements EvaluationProvider {
  constructor(
    private readonly apiKey: string | undefined,
    readonly model: string,
  ) {}
  private async generate<T>(
    name: string,
    stage: EvaluationStage,
    prompt: string,
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.apiKey)
      throw new EvaluationFailure(
        stage,
        'configuration_missing',
        'Evaluation requires OPENAI_API_KEY.',
      );
    const serialized = JSON.stringify(input);
    if (serialized.length > 160000)
      throw new EvaluationFailure(
        stage,
        'input_too_large',
        'Evaluation input exceeds the supported size.',
      );
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        store: false,
        max_completion_tokens: 8000,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: serialized },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name, strict: true, schema: z.toJSONSchema(schema) },
        },
      }),
    });
    if (!response.ok)
      throw new EvaluationFailure(
        stage,
        'http_error',
        'Evaluation provider unavailable.',
        response.status,
      );
    const body: unknown = await response.json();
    const completion = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string(),
              message: z.object({ content: z.string().nullable() }),
            }),
          )
          .min(1),
      })
      .parse(body).choices[0];
    if (!completion || completion.finish_reason !== 'stop' || !completion.message.content)
      throw new EvaluationFailure(stage, 'incomplete_output', 'Evaluation output incomplete.');
    const parsed: unknown = JSON.parse(completion.message.content);
    return schema.parse(parsed);
  }
  extract(input: EvaluationInput, correction?: 'unstated_claim_value') {
    const prompt = correction
      ? `${EXTRACTION_PROMPT}\nCorrection: a prior extraction contained an unstated numeric value. Re-extract from the original transcript. Set value to null whenever that value does not appear as digits in its exact quote. Do not infer percentages or multipliers from words such as double. Keep the qualitative claim; do not invent or rewrite quotes.`
      : EXTRACTION_PROMPT;
    return this.generate('extract_claims', 'extraction', prompt, input, extractionSchema);
  }
  coach(input: EvaluationInput, extraction: Extraction, checks: EvidenceCheck[]) {
    return this.generate(
      'coach_founder',
      'coaching',
      COACHING_PROMPT,
      { ...input, extraction, checks },
      coachingGenerationSchema,
    );
  }
}
