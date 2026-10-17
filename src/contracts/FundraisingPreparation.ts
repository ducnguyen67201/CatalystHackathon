import { z } from 'zod';

const id = z.string().min(1).max(100);
const text = z.string().max(3000);
export const preparationGoalInputSchema = z.strictObject({
  round: z.string().trim().min(1).max(100),
  previousRounds: z.int().min(0).max(30).nullable(),
  amount: z
    .string()
    .regex(/^\d{1,16}(?:\.\d{1,4})?$/)
    .nullable(),
  currency: z.enum(['unspecified', 'USD', 'CAD', 'EUR', 'GBP']),
  targetDate: z.iso.date().nullable(),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Use an IANA timezone'),
  investorId: z.uuid().nullable(),
});
export const preparationGoalSchema = preparationGoalInputSchema.extend({
  id: z.uuid(),
  confirmedAt: z.iso.datetime(),
});
export const preparationArtifactSchema = z.strictObject({
  id,
  kind: z.enum(['financial', 'investor']),
  title: text,
  narrative: text,
  why: text,
  question: text,
  criteria: z.array(text).max(5),
  snapshotId: id.nullable(),
  investorId: id.nullable(),
  fictional: z.boolean(),
  sources: z
    .array(
      z.strictObject({
        id,
        title: text,
        excerpt: z.string().max(16000),
        url: z.url().nullable(),
        recordedAt: z.string().nullable(),
        fictional: z.boolean(),
      }),
    )
    .max(12),
  chart: z
    .strictObject({
      period: z.string(),
      fileName: z.string(),
      sourceRow: z.int().positive(),
      currency: z.string(),
      operatingIncome: z.string(),
      credit: z.string(),
      netIncome: z.string(),
    })
    .nullable(),
});
export const preparationPlanSchema = z.strictObject({
  id,
  goalId: z.uuid(),
  inputHash: id,
  createdAt: z.iso.datetime(),
  summary: text,
  changes: z.array(text).max(5),
  artifacts: z.array(preparationArtifactSchema).max(2),
});
export const preparationDecisionSchema = z.strictObject({
  id: z.uuid(),
  planId: id,
  artifactId: id,
  kind: z.enum(['accepted', 'rejected']),
  note: z.string().max(1000),
  createdAt: z.iso.datetime(),
});

export const preparationScheduleInputSchema = z.strictObject({
  dailyHours: z.number().min(0.25).max(12),
  cashExpectedDate: z.iso.date().nullable(),
  hours: z.strictObject({
    financial: z.number().min(0.25).max(80),
    investor: z.number().min(0.25).max(80),
    brief: z.number().min(0.25).max(80),
    rehearse: z.number().min(0.25).max(80),
  }),
});
export const preparationScheduleSchema = preparationScheduleInputSchema.extend({
  id: z.uuid(),
  goalId: z.uuid(),
  planId: id,
  confirmedAt: z.iso.datetime(),
});
export type PreparationScheduleInput = z.infer<typeof preparationScheduleInputSchema>;
export type PreparationSchedule = z.infer<typeof preparationScheduleSchema>;

export const preparationStateSchema = z.strictObject({
  version: z.int().nonnegative().default(0),
  automatic: z.boolean().default(false),
  goals: z.array(preparationGoalSchema).default([]),
  schedules: z.array(preparationScheduleSchema).default([]),
  plans: z.array(preparationPlanSchema).default([]),
  decisions: z.array(preparationDecisionSchema).default([]),
  rehearsals: z
    .array(
      z.strictObject({
        requestKey: z.uuid(),
        requestHash: id,
        sessionId: z.uuid(),
        planId: id,
        artifactId: id,
      }),
    )
    .default([]),
});
export const preparationViewSchema = z.strictObject({
  version: z.int(),
  automatic: z.boolean(),
  goal: preparationGoalSchema.nullable(),
  schedule: preparationScheduleSchema.nullable().default(null),
  plan: preparationPlanSchema.nullable(),
  outdated: z.boolean(),
  heartbeatAt: z.iso.datetime().nullable(),
  decisions: z.array(preparationDecisionSchema),
  milestones: z
    .array(
      z.strictObject({
        id,
        title: z.string(),
        status: z.enum(['complete', 'available', 'blocked', 'needs_review']),
        detail: text,
      }),
    )
    .length(5),
  reviews: z
    .array(
      z.strictObject({
        sessionId: z.uuid(),
        artifactId: id,
        current: z.boolean(),
        status: z.enum(['pending', 'failed', 'assessed', 'needs_attention', 'unavailable']),
        summary: text.nullable(),
      }),
    )
    .max(5),
  nextAction: z.string(),
  feedback: z
    .array(
      z.strictObject({
        title: text,
        status: z.string(),
        sessionId: id,
        taskId: id,
        offset: z.int().nonnegative(),
      }),
    )
    .max(3),
});
export type PreparationGoalInput = z.infer<typeof preparationGoalInputSchema>;
export type PreparationGoal = z.infer<typeof preparationGoalSchema>;
export type PreparationArtifact = z.infer<typeof preparationArtifactSchema>;
export type PreparationPlan = z.infer<typeof preparationPlanSchema>;
export type PreparationState = z.infer<typeof preparationStateSchema>;
export type PreparationView = z.infer<typeof preparationViewSchema>;
