import { z } from 'zod';
import { practiceTurnOutputSchema } from '../contracts/GuidedPractice.js';
import type { PracticeTurnInput, PracticeTurnProvider } from '../features/PracticeTurnProvider.js';
import { PRACTICE_TURN_PROMPT } from '../prompts/PracticeTurnPrompt.js';

export class LivePracticeTurn implements PracticeTurnProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}
  async generate(input: PracticeTurnInput) {
    const data = JSON.stringify(input);
    if (data.length > 160000) throw new Error('Practice turn input exceeds the supported size.');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        store: false,
        max_completion_tokens: 4000,
        messages: [
          { role: 'system', content: PRACTICE_TURN_PROMPT },
          { role: 'user', content: data },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'practice_question_why',
            strict: true,
            schema: z.toJSONSchema(practiceTurnOutputSchema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error('Practice turn provider unavailable.');
    const raw: unknown = await response.json();
    const completion = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string(),
              message: z.object({ content: z.string().max(40000).nullable() }),
            }),
          )
          .min(1),
      })
      .parse(raw).choices[0];
    if (!completion || completion.finish_reason !== 'stop' || !completion.message.content)
      throw new Error('Practice turn output incomplete.');
    const output: unknown = JSON.parse(completion.message.content);
    return practiceTurnOutputSchema.parse(output);
  }
}
