import { z } from 'zod';
import {
  investorProfileEstimateInputSchema,
  investorProfileEstimateOutputSchema,
  type InvestorProfileEstimateInput,
} from '../contracts/InvestorProfileEstimate.js';
import type { InvestorProfileProvider } from '../features/InvestorProfileProvider.js';
import { INVESTOR_PROFILE_PROMPT } from '../prompts/InvestorProfilePrompt.js';

export class LiveInvestorProfileGeneration implements InvestorProfileProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generate(input: InvestorProfileEstimateInput) {
    const data = investorProfileEstimateInputSchema.parse(input);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        store: false,
        max_completion_tokens: 4000,
        messages: [
          { role: 'system', content: INVESTOR_PROFILE_PROMPT },
          { role: 'user', content: JSON.stringify(data) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'investor_profile_estimates',
            strict: true,
            schema: z.toJSONSchema(investorProfileEstimateOutputSchema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error('Investor profile: model provider unavailable.');
    const raw: unknown = await response.json();
    const completion = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string(),
              message: z.object({ content: z.string().max(15000).nullable() }),
            }),
          )
          .min(1),
      })
      .parse(raw).choices[0];
    if (!completion || completion.finish_reason !== 'stop' || !completion.message.content)
      throw new Error('Investor profile: model output incomplete.');
    const output: unknown = JSON.parse(completion.message.content);
    return investorProfileEstimateOutputSchema.parse(output);
  }
}
