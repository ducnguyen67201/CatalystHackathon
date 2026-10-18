import { z } from 'zod';
import { investorMatchAssessmentSchema } from './InvestorMatch.js';

const ref = z.string().min(1).max(100);
const prose = z.string().trim().min(1).max(3000);
export const preparationSourceSchema = z.strictObject({
  id: ref,
  title: z.string().max(500),
  excerpt: z.string().max(16000),
  url: z.url().nullable(),
  recordedAt: z.string().nullable(),
  fictional: z.boolean(),
});
export const connectedPitchSchema = z.strictObject({
  scope: z.enum(['shared', 'target']).optional(),
  targetId: z.uuid().optional(),
  revision: z.int().positive(),
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  text: prose,
  reason: prose,
  sourceHash: ref,
  sources: z.array(preparationSourceSchema).max(12),
  fictional: z.boolean(),
  createdAt: z.iso.datetime(),
});
const preparationLineage = {
  journeyId: z.uuid().optional(),
  targetId: z.uuid().optional(),
  assessmentId: z.uuid().optional(),
  briefVersionId: z.uuid().optional(),
  goalVersionId: z.uuid().optional(),
  scopeVersionId: z.uuid().optional(),
};
export const connectedBriefVersionSchema = z.strictObject({
  id: z.uuid(),
  cycleId: z.uuid(),
  goalId: z.uuid(),
  scopeVersionId: z.uuid().optional(),
  snapshotId: ref.nullable().optional(),
  journeyId: z.uuid().optional(),
  targetId: z.uuid().optional(),
  assessmentId: z.uuid().optional(),
  pitchId: z.uuid(),
  sourceHash: ref,
  investorSourceHash: ref,
  text: prose,
  sources: z.array(preparationSourceSchema).max(22),
  fictional: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const preparedPitchContextSchema = z.strictObject({
  ...preparationLineage,
  cycleId: z.uuid(),
  pitchId: z.uuid(),
  goalId: z.uuid(),
  sourceHash: ref,
  investorSourceHash: ref,
  pitch: prose,
  brief: prose,
  sources: z.array(preparationSourceSchema).max(12),
  fictional: z.boolean(),
});
const proposalSchema = z.strictObject({
  evaluationId: z.uuid(),
  sessionId: z.uuid(),
  basePitchId: z.uuid(),
  text: prose,
  reasons: z.array(prose).min(1).max(3),
  itemIds: z.array(ref).max(3),
});
export const preparationCycleSchema = z.strictObject({
  ...preparationLineage,
  id: z.uuid(),
  goalId: z.uuid(),
  sourceHash: ref,
  pitchId: z.uuid(),
  pitchApprovedAt: z.iso.datetime().nullable(),
  investorId: z.uuid().nullable(),
  investorSourceHash: ref.nullable(),
  brief: prose.nullable(),
  briefApprovedAt: z.iso.datetime().nullable(),
  generationId: z.uuid().nullable(),
  feedback: z.strictObject({ sessionId: z.uuid(), evaluationId: z.uuid() }).nullable(),
  proposal: proposalSchema.nullable(),
  processedEvaluationId: z.uuid().nullable(),
  outcome: z.enum(['accepted', 'rejected', 'reviewed', 'superseded']).nullable(),
  createdAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
});
export const connectedPreparationStateSchema = z.strictObject({
  version: z.int().nonnegative(),
  pitches: z.array(connectedPitchSchema),
  cycles: z.array(preparationCycleSchema),
  briefVersions: z.array(connectedBriefVersionSchema).default([]),
  commands: z.array(z.strictObject({ key: z.uuid(), hash: ref, resultId: z.uuid().optional() })),
});
export const preparationRecommendationSchema = z.strictObject({
  match: investorMatchAssessmentSchema.optional(),
  investorId: z.uuid().nullable(),
  suggestionId: z.uuid().nullable(),
  name: z.string().min(1).max(100),
  label: z.enum(['Recommended to review', 'Review tradeoffs', 'Needs verification']),
  reasons: z.array(prose).max(5),
  unknowns: z.array(prose).max(6),
  sources: z.array(preparationSourceSchema).max(10),
  stage: z.string().nullable(),
  sector: z.string().nullable(),
  geography: z.string().nullable(),
});
export const connectedPreparationViewSchema = z.strictObject({
  journeyId: z.uuid().nullable().default(null),
  historical: z.boolean().default(false),
  version: z.int().nonnegative(),
  goalId: z.uuid().nullable(),
  cycle: preparationCycleSchema.nullable(),
  pitch: connectedPitchSchema.nullable(),
  outdated: z.boolean(),
  paused: z.boolean(),
  steps: z
    .array(
      z.strictObject({
        id: z.enum(['story', 'investor', 'brief', 'practice', 'feedback', 'revision']),
        title: prose,
        status: z.enum([
          'blocked',
          'ready',
          'running',
          'needs_review',
          'complete',
          'failed',
          'outdated',
        ]),
        detail: prose,
        workflow: prose,
      }),
    )
    .length(6),
  recommendations: z.array(preparationRecommendationSchema).max(3),
  latestSession: z
    .strictObject({
      id: z.uuid(),
      evaluationId: z.uuid().nullable(),
      status: z.enum(['awaiting_transcript', 'pending', 'failed', 'ready', 'unavailable']),
      summary: z.string().max(3000).nullable(),
      hasGaps: z.boolean(),
    })
    .nullable(),
  generation: z
    .strictObject({
      id: z.uuid(),
      status: z.enum(['queued', 'running', 'succeeded', 'failed']),
      error: z.string().nullable(),
      scenarios: z
        .array(z.strictObject({ id: z.string(), title: z.string(), objective: z.string() }))
        .max(3),
    })
    .nullable(),
  history: z.array(preparationCycleSchema).max(10),
  briefVersions: z.array(connectedBriefVersionSchema).max(10).default([]),
  historyPitches: z.array(connectedPitchSchema).max(10),
  completedCycles: z.int().nonnegative(),
  cycleNumber: z.int().nonnegative(),
});
const commandBase = {
  version: z.int().nonnegative(),
  key: z.uuid(),
  targetId: z.uuid().optional(),
  journeyId: z.uuid().optional(),
};
export const connectedPreparationCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...commandBase,
    action: z.enum([
      'start',
      'refresh',
      'approve_pitch',
      'approve_brief',
      'reject_revision',
      'finish_cycle',
      'repeat',
    ]),
  }),
  z.strictObject({
    ...commandBase,
    action: z.enum(['save_pitch', 'accept_revision']),
    text: prose,
    scope: z.enum(['shared', 'target']).optional(),
  }),
  z.strictObject({ ...commandBase, action: z.literal('select_investor'), investorId: z.uuid() }),
  z.strictObject({
    ...commandBase,
    action: z.literal('review_feedback'),
    sessionId: z.uuid(),
    evaluationId: z.uuid(),
  }),
]);
export type ConnectedPreparationState = z.infer<typeof connectedPreparationStateSchema>;
export type PreparationCycle = z.infer<typeof preparationCycleSchema>;
export type ConnectedPitch = z.infer<typeof connectedPitchSchema>;
export type ConnectedBriefVersion = z.infer<typeof connectedBriefVersionSchema>;
export type PreparedPitchContext = z.infer<typeof preparedPitchContextSchema>;
export type ConnectedPreparationView = z.infer<typeof connectedPreparationViewSchema>;
export type ConnectedPreparationCommand = z.infer<typeof connectedPreparationCommandSchema>;
export type PreparationRecommendation = z.infer<typeof preparationRecommendationSchema>;
