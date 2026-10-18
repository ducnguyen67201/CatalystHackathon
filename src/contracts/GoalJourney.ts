import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { investorMatchAssessmentSchema } from './InvestorMatch.js';

const id = z.uuid();
const text = z.string().max(3000);
export const desiredCheckSchema = z
  .strictObject({
    min: z.string().regex(/^\d{1,16}(?:\.\d{1,4})?$/),
    max: z.string().regex(/^\d{1,16}(?:\.\d{1,4})?$/),
    currency: z.enum(['CAD', 'USD', 'EUR', 'GBP']),
  })
  .refine((value) => new Decimal(value.min).gt(0) && new Decimal(value.min).lte(value.max), {
    message: 'Individual check amounts must be positive and ordered.',
  });
export const savedInvestorMatchSchema = z.strictObject({
  id,
  journeyId: id,
  goalVersionId: id,
  investorId: id,
  evidenceIds: z.array(z.string()).max(100),
  assessment: investorMatchAssessmentSchema,
});
export const goalInvestorTargetSchema = z.strictObject({
  id,
  investorId: id,
  assessmentId: id.nullable(),
  rationale: z.string().trim().min(1).max(1000),
  status: z.enum(['active', 'archived']),
  included: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  eventId: z.string().max(100).nullable(),
});
export const goalScopeSchema = z.strictObject({
  id,
  version: z.int().positive(),
  targetIds: z.array(id).max(50),
  createdAt: z.iso.datetime(),
  reason: text,
});
export const goalProgressStepSchema = z.strictObject({
  id: z.enum(['story', 'investor', 'brief', 'practice', 'feedback', 'revision']),
  complete: z.boolean(),
  status: z.enum(['blocked', 'ready', 'running', 'needs_review', 'complete', 'failed', 'outdated']),
  reason: text,
});
export const goalTrackPositionSchema = z.strictObject({
  targetId: id,
  investorId: id,
  name: z.string(),
  cycleId: id.nullable(),
  pitchId: id.nullable(),
  briefVersionId: id.nullable(),
  sessionId: id.nullable(),
  evaluationId: id.nullable(),
  fictional: z.boolean(),
  outdated: z.boolean(),
  hasGaps: z.boolean(),
  steps: z.array(goalProgressStepSchema).length(6),
  completed: z.int().nonnegative(),
  required: z.int().positive(),
  nextAction: text,
  href: z.string(),
});
export const goalPositionSchema = z.strictObject({
  projectionVersion: z.literal('goal-progress-v1'),
  goalVersionId: id,
  scopeVersionId: id,
  scopeVersion: z.int().positive(),
  completed: z.int().nonnegative(),
  required: z.int().positive(),
  percentage: z.string(),
  readiness: z.enum([
    'in_progress',
    'assessment_pending',
    'needs_review',
    'reviewed_with_gaps',
    'preparation_reviewed',
    'outdated',
    'paused',
  ]),
  nextAction: text,
  href: z.string(),
  tracks: z.array(goalTrackPositionSchema).max(50),
  practices: z
    .array(
      z.strictObject({
        sessionId: id,
        evaluationId: id.nullable(),
        targetId: id,
        createdAt: z.iso.datetime(),
        fictional: z.boolean(),
        partial: z.boolean(),
        status: z.enum(['pending', 'failed', 'assessed', 'unavailable']),
        assessed: z.int().nonnegative(),
        supported: z.int().nonnegative(),
        contradicted: z.int().nonnegative(),
        unresolved: z.int().nonnegative(),
        improved: z.int().nonnegative(),
      }),
    )
    .max(100)
    .default([]),
  remainingHours: z.string(),
  estimatedReadyDate: z.iso.date().nullable(),
  estimateReason: text,
});
export const goalProgressEventSchema = z.strictObject({
  id,
  journeyId: id,
  sequence: z.int().positive(),
  recordedAt: z.iso.datetime(),
  reason: text,
  fingerprint: z.string(),
  position: goalPositionSchema,
});
export const goalJourneySchema = z.strictObject({
  id,
  currentGoalId: id,
  status: z.enum(['active', 'archived']),
  createdAt: z.iso.datetime(),
  revision: z.int().nonnegative(),
  focusedTargetId: id.nullable(),
  targets: z.array(goalInvestorTargetSchema).max(50),
  assessments: z.array(savedInvestorMatchSchema),
  scopes: z.array(goalScopeSchema).min(1),
  events: z.array(goalProgressEventSchema),
  lastSequence: z.int().nonnegative(),
  lastFingerprint: z.string().nullable(),
  commands: z.array(z.strictObject({ key: id, hash: z.string(), resultId: id.nullable() })),
});
export const goalJourneyViewSchema = z.strictObject({
  journey: goalJourneySchema
    .omit({ commands: true, events: true, assessments: true })
    .strip()
    .nullable(),
  revision: z.int().nonnegative(),
  intent: z.string(),
  position: goalPositionSchema.nullable(),
  assessments: z.array(savedInvestorMatchSchema),
  targets: z.array(
    goalInvestorTargetSchema.extend({
      name: z.string(),
      assessment: savedInvestorMatchSchema.nullable(),
      matchOutdated: z.boolean(),
      track: goalTrackPositionSchema.nullable(),
    }),
  ),
  events: z.array(goalProgressEventSchema),
  historyAvailable: z.boolean(),
});
export const goalProgressQuerySchema = z.strictObject({
  cursor: z.coerce.number().int().nonnegative().optional(),
  beforeSequence: z.coerce.number().int().positive().optional(),
  targetId: id.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const goalProgressPageSchema = z.strictObject({
  items: z.array(goalProgressEventSchema),
  nextCursor: z.int().nonnegative().nullable(),
  beforeSequence: z.int().nonnegative(),
});
const base = { key: id, revision: z.int().nonnegative(), journeyId: id.optional() };
export const journeyCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...base, action: z.literal('activate') }),
  z.strictObject({ ...base, action: z.literal('new_goal') }),
  z.strictObject({
    ...base,
    action: z.literal('assess'),
    investorId: id.optional(),
    eventId: z.string().max(100).optional(),
  }),
  z.strictObject({
    ...base,
    action: z.literal('shortlist'),
    investorId: id.optional(),
    eventId: z.string().max(100).optional(),
    assessmentId: id.optional(),
    rationale: z.string().trim().min(1).max(1000),
    included: z.boolean().default(true),
  }),
  z.strictObject({
    ...base,
    action: z.enum(['focus', 'archive', 'resume', 'include', 'exclude']),
    targetId: id,
  }),
]);
export type GoalJourney = z.infer<typeof goalJourneySchema>;
export type GoalInvestorTarget = z.infer<typeof goalInvestorTargetSchema>;
export type SavedInvestorMatch = z.infer<typeof savedInvestorMatchSchema>;
export type GoalPosition = z.infer<typeof goalPositionSchema>;
export type GoalTrackPosition = z.infer<typeof goalTrackPositionSchema>;
export type GoalProgressEvent = z.infer<typeof goalProgressEventSchema>;
export type GoalProgressQuery = z.infer<typeof goalProgressQuerySchema>;
export type GoalProgressPage = z.infer<typeof goalProgressPageSchema>;
export type GoalJourneyView = z.infer<typeof goalJourneyViewSchema>;
export type JourneyCommand = z.infer<typeof journeyCommandSchema>;
