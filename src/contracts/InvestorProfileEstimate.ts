import { z } from 'zod';
import { investorCheckRangeSchema } from './InvestorMatch.js';

const estimateFieldSchema = z.strictObject({
  value: z.string().trim().min(1).max(240).nullable(),
  basis: z.string().trim().min(1).max(400),
});

/** Model hypotheses are separate from source-backed mandate facts. */
export const investorProfileEstimateOutputSchema = z.strictObject({
  stage: estimateFieldSchema,
  sector: estimateFieldSchema,
  geography: estimateFieldSchema,
  checkSize: z.strictObject({
    range: investorCheckRangeSchema.nullable(),
    basis: z.string().trim().min(1).max(400),
  }),
  priorities: estimateFieldSchema,
  confidence: z.enum(['low', 'medium']),
});

/** Only investor identity and saved public excerpts are sent to the model. */
export const investorProfileEstimateInputSchema = z.strictObject({
  investor: z.strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(100),
    url: z.url().nullable(),
    profileLinks: z.array(z.url()).max(3),
  }),
  contextSources: z
    .array(
      z.strictObject({
        id: z.string().max(200),
        title: z.string().max(500),
        url: z.url(),
        excerpt: z.string().max(1200),
      }),
    )
    .max(5),
});

export const savedInvestorProfileEstimateSchema = z.strictObject({
  id: z.uuid(),
  jobId: z.string(),
  provenance: z.literal('ai_estimate'),
  generatedAt: z.iso.datetime(),
  model: z.string().min(1).max(150),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  input: investorProfileEstimateInputSchema,
  output: investorProfileEstimateOutputSchema,
});

export const investorProfileEstimateViewSchema = z.strictObject({
  ready: z.boolean(),
  estimate: savedInvestorProfileEstimateSchema.nullable(),
  outdated: z.boolean(),
  job: z
    .strictObject({
      id: z.string(),
      status: z.enum(['queued', 'running', 'succeeded', 'failed']),
      attempts: z.int(),
      error: z.string().nullable(),
      result: z.string().nullable(),
    })
    .nullable(),
});

export type InvestorProfileEstimateInput = z.infer<typeof investorProfileEstimateInputSchema>;
export type InvestorProfileEstimateOutput = z.infer<typeof investorProfileEstimateOutputSchema>;
export type SavedInvestorProfileEstimate = z.infer<typeof savedInvestorProfileEstimateSchema>;
export type InvestorProfileEstimateView = z.infer<typeof investorProfileEstimateViewSchema>;
