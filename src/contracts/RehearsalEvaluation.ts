import { z } from 'zod';
import {
  combinedEvaluationSchema,
  investorAssessmentContextSchema,
  investorEvaluationSchema,
  peerEvaluationSchema,
} from './CombinedEvaluation.js';
import { peerComparisonSchema, peerInsightSchema } from './PeerComparison.js';

const id = z.string().min(1).max(200);
const text = z.string().min(1).max(2000);
const amount = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,8})?$/)
  .max(40);

/** Add new data through attributed sources; never arbitrary prompt instructions. */
export const financialLocationSchema = z.strictObject({
  kind: z.literal('csv'),
  snapshotId: id,
  fileName: z.string().min(1).max(200),
  sourceRow: z.int().positive(),
});
export const evaluationSourceSchema = z.strictObject({
  id,
  kind: z.enum(['financial', 'investor', 'company', 'meeting', 'supplemental']),
  title: text,
  text: z.string().max(16000),
  url: z.url().nullable(),
  recordedAt: z.iso.datetime().nullable(),
  origin: z.enum(['uploaded', 'founder', 'public_unverified', 'fictional']),
  // Optional with no default: historic context hashes must stay byte-for-byte reproducible.
  financialLocation: financialLocationSchema.optional(),
});
export const metricFactSchema = z.strictObject({
  id,
  metric: id,
  value: amount,
  unit: z.string().max(30),
  period: z.string().max(30),
  sourceIds: z.array(id).min(1).max(20),
  calculation: z.string().max(500),
});
export const evaluationContextSchema = z.strictObject({
  version: z.literal(1),
  peerComparison: peerComparisonSchema.optional(),
  investorAssessment: investorAssessmentContextSchema.optional(),
  capturedAt: z.iso.datetime(),
  workspaceRevision: z.int().nonnegative(),
  companyName: z.string().max(100),
  profileVersion: z.int().positive(),
  snapshotId: id.nullable(),
  investorId: id.nullable(),
  investorName: z.string().max(200).nullable().default(null),
  scenario: text,
  interviewerContextMode: z.enum(['empty', 'provided', 'legacy']),
  sources: z.array(evaluationSourceSchema).max(300),
  facts: z.array(metricFactSchema).max(300),
  limitations: z.array(text).max(30),
});
export type EvaluationContext = z.infer<typeof evaluationContextSchema>;
export type MetricFact = z.infer<typeof metricFactSchema>;

export const evaluationTurnSchema = z.strictObject({
  id,
  role: z.enum(['agent', 'user']),
  text: z.string().min(1).max(10000),
});
export const claimSchema = z.strictObject({
  id,
  turnId: id,
  questionTurnId: id.nullable(),
  quote: text,
  metric: id.nullable(),
  value: amount.nullable(),
  period: z.string().max(30).nullable(),
  unit: z.string().max(30).nullable(),
  kind: z.enum(['actual', 'forecast', 'hypothetical', 'opinion']),
  supersededByTurnId: id.nullable(),
  uncertainty: z.string().max(1000),
});
export const extractionSchema = z.strictObject({
  claims: z.array(claimSchema).max(30),
  focusAreas: z
    .array(
      z.strictObject({ observation: text, hypothesis: text, turnIds: z.array(id).min(1).max(20) }),
    )
    .max(5),
});
export type Extraction = z.infer<typeof extractionSchema>;
export const evidenceCheckSchema = z.strictObject({
  claimId: id,
  support: z.enum([
    'supported',
    'contradicted',
    'insufficient_evidence',
    'ambiguous',
    'not_checked',
  ]),
  factIds: z.array(id).max(20),
  explanation: text,
});
export type EvidenceCheck = z.infer<typeof evidenceCheckSchema>;
const analystAnalysisSchema = z.strictObject({
  financialInterpretation: z.string().min(1).max(700),
  investorImplication: z.string().min(1).max(700),
  preparationSteps: z.array(z.string().min(1).max(400)).min(1).max(3),
});
const strengthsSchema = z
  .array(
    z.strictObject({
      statement: z.string().min(1).max(500),
      significance: z.string().min(1).max(500).optional(),
      claimIds: z.array(id).min(1).max(10),
      turnIds: z.array(id).min(1).max(10),
    }),
  )
  .max(3);
export const coachingSchema = z.strictObject({
  summary: text,
  // Absent in historical reports; do not backfill or invent praise.
  strengths: strengthsSchema.optional(),
  items: z
    .array(
      z.strictObject({
        id,
        claimId: id,
        relevance: z.enum([
          'directly_useful',
          'useful_but_incomplete',
          'potentially_misplaced',
          'unclear',
        ]),
        establishes: text,
        gap: text,
        suggestion: text,
        analysis: analystAnalysisSchema.optional(),
        sourceIds: z.array(id).max(20),
        factIds: z.array(id).max(20),
        missingInputs: z.array(text).max(10),
        investorSourceIds: z.array(id).max(10),
        exampleAnswer: text,
        clarificationQuestion: text,
        practiceQuestion: text,
        successCriteria: z.array(text).min(1).max(5),
      }),
    )
    .max(3),
  comparison: z
    .strictObject({
      outcome: z.enum(['improved', 'needs_evidence', 'not_comparable']),
      explanation: text,
      turnIds: z.array(id).max(20),
    })
    .nullable(),
});
export type Coaching = z.infer<typeof coachingSchema>;
/** New model responses must explicitly assess strengths, including an empty result. */
export const coachingGenerationSchema = coachingSchema.extend({
  strengths: z
    .array(strengthsSchema.element.extend({ significance: z.string().min(1).max(500) }))
    .max(3),
  items: z
    .array(coachingSchema.shape.items.element.extend({ analysis: analystAnalysisSchema }))
    .max(3),
});
export const evaluationReportSchema = z.strictObject({
  workflows: combinedEvaluationSchema.optional(),
  peerInsights: z.array(peerInsightSchema).max(3).optional(),
  extraction: extractionSchema,
  checks: z.array(evidenceCheckSchema).max(30),
  coaching: coachingSchema,
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export const evaluationProgressSchema = z.strictObject({
  version: z.literal(1),
  extraction: extractionSchema.optional(),
  peer: peerEvaluationSchema.optional(),
  investor: investorEvaluationSchema.optional(),
  answer: z
    .strictObject({ checks: z.array(evidenceCheckSchema).max(30), coaching: coachingSchema })
    .optional(),
});
export type EvaluationProgress = z.infer<typeof evaluationProgressSchema>;
const currentEvaluationRecordSchema = z.strictObject({
  id,
  version: z.literal(1),
  legacyDemo: z.boolean().default(false),
  evaluatorVersion: id,
  progress: evaluationProgressSchema.optional(),
  model: id,
  contextHash: id,
  transcriptHash: id,
  turns: z.array(evaluationTurnSchema).max(200),
  scope: z.enum(['complete', 'partial', 'transcript_only']),
  status: z.enum(['queued', 'completed', 'skipped']),
  reason: z.string().max(500).nullable(),
  generation: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  parentEvaluationId: id.nullable(),
  parentItemId: id.nullable(),
  clarification: z.string().max(3000).nullable(),
  requestKey: id.nullable(),
  report: evaluationReportSchema.nullable(),
});
/** Read old saved reports without enabling the removed demo execution path. */
export const evaluationRecordSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('mode' in value))
    return value;
  if (value.mode !== 'demo' && value.mode !== 'live') return value;
  const { mode, ...record } = value;
  return { ...record, legacyDemo: mode === 'demo' };
}, currentEvaluationRecordSchema);
export type EvaluationRecord = z.infer<typeof evaluationRecordSchema>;
export const evaluationResponseSchema = z.strictObject({
  context: evaluationContextSchema.nullable(),
  evaluations: z.array(evaluationRecordSchema),
  jobs: z.array(
    z.strictObject({ kind: z.string(), status: z.string(), error: z.string().nullable() }),
  ),
  responses: z.array(
    z.strictObject({
      id,
      evaluationId: id,
      itemId: id,
      kind: z.enum(['clarification', 'dismissed', 'practice']),
      text: z.string().max(3000),
      createdAt: z.iso.datetime(),
      requestKey: id,
    }),
  ),
});
export const evaluationResponseRecordSchema = evaluationResponseSchema.shape.responses.element;
export type EvaluationResponse = z.infer<typeof evaluationResponseSchema>;

/** Peer comparisons are computed locally, not supplied as model-assessable company facts. */
export function withoutPeerComparison(context: EvaluationContext): EvaluationContext {
  const evidence = { ...context };
  delete evidence.peerComparison;
  delete evidence.investorAssessment;
  return evidence;
}
