import { z } from 'zod';
import { peerComparisonSchema, peerMetricSchema } from './PeerComparison.js';

const reference = z.string().min(1).max(200);
const criterion = z.enum(['stage', 'sector', 'geography']);
export const investorAssessmentContextSchema = z.strictObject({
  company: z.strictObject({
    stage: z.string().nullable(),
    sector: z.string().nullable(),
    geography: z.string().nullable(),
  }),
  observations: z
    .array(
      z.strictObject({
        sourceId: reference,
        stage: z.string().nullable(),
        sector: z.string().nullable(),
        geography: z.string().nullable(),
      }),
    )
    .max(10),
});
export const peerEvaluationSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(['available', 'limited', 'unavailable']),
  comparison: peerComparisonSchema.nullable(),
  limitations: z.array(z.string()).max(10),
});
export const investorEvaluationSchema = z.strictObject({
  version: z.literal(1),
  investorId: reference.nullable(),
  investorName: z.string().nullable(),
  status: z.enum(['available', 'limited', 'unavailable']),
  criteria: z
    .array(
      z.strictObject({
        criterion,
        companyValue: z.string().nullable(),
        outcome: z.enum(['aligned', 'gap', 'conflicting', 'unknown']),
        observations: z
          .array(
            z.strictObject({
              sourceId: reference,
              value: z.string(),
              quote: z.string(),
              url: z.url().nullable(),
              recordedAt: z.iso.datetime().nullable(),
              origin: z.enum(['public_unverified', 'fictional']),
            }),
          )
          .max(10),
      }),
    )
    .max(3),
  limitations: z.array(z.string()).max(10),
});
export const evaluationSynthesisSchema = z.strictObject({
  version: z.literal(1),
  actions: z
    .array(
      z.strictObject({
        coachingItemId: reference,
        claimId: reference,
        investorSourceIds: z.array(reference).max(10),
        peerMetrics: z.array(peerMetricSchema).max(3),
        instruction: z.string(),
      }),
    )
    .max(3),
});
export const combinedEvaluationSchema = z.strictObject({
  version: z.literal(1),
  peer: peerEvaluationSchema,
  investor: investorEvaluationSchema,
  synthesis: evaluationSynthesisSchema,
});
export type PeerEvaluation = z.infer<typeof peerEvaluationSchema>;
export type InvestorEvaluation = z.infer<typeof investorEvaluationSchema>;
export type EvaluationSynthesis = z.infer<typeof evaluationSynthesisSchema>;
