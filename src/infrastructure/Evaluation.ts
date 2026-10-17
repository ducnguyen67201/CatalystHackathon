import { z } from 'zod';
import {
  coachingSchema,
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

/** Two bounded structured calls; no search tools or logging of inputs. */
export class LiveEvaluation implements EvaluationProvider {
  constructor(
    private readonly apiKey: string | undefined,
    readonly model: string,
  ) {}
  private async generate<T>(
    name: string,
    prompt: string,
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!this.apiKey) throw new Error('Evaluation requires OPENAI_API_KEY.');
    const serialized = JSON.stringify(input);
    if (serialized.length > 160000) throw new Error('Evaluation input exceeds the supported size.');
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
    if (!response.ok) throw new Error('Evaluation provider unavailable.');
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
      throw new Error('Evaluation output incomplete.');
    const parsed: unknown = JSON.parse(completion.message.content);
    return schema.parse(parsed);
  }
  extract(input: EvaluationInput) {
    return this.generate('extract_claims', EXTRACTION_PROMPT, input, extractionSchema);
  }
  coach(input: EvaluationInput, extraction: Extraction, checks: EvidenceCheck[]) {
    return this.generate(
      'coach_founder',
      COACHING_PROMPT,
      { ...input, extraction, checks },
      coachingSchema,
    );
  }
}
