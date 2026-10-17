import { z } from 'zod';
import { followupTaskSchema } from './Followups.js';
import { metricFactSchema } from './RehearsalEvaluation.js';

export const preparationAreaSchema = z.enum([
  'revenue',
  'margins',
  'expenses',
  'profitability',
  'cash',
  'explanation',
]);
const countsSchema = z.strictObject({
  assessed: z.int().nonnegative(),
  supported: z.int().nonnegative(),
  contradicted: z.int().nonnegative(),
  unresolved: z.int().nonnegative(),
  followups: z.int().nonnegative(),
  practised: z.int().nonnegative(),
  improved: z.int().nonnegative(),
  attention: z.int().nonnegative(),
});
const actionSchema = z.strictObject({
  sessionId: z.string(),
  investorId: z.string().nullable(),
  snapshotId: z.string().nullable(),
  offset: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  fictional: z.boolean(),
  partial: z.boolean(),
  task: followupTaskSchema,
  interpretation: z.string().nullable(),
  implication: z.string().nullable(),
});
export const preparationProgressSchema = z.strictObject({
  reviewedSessions: z.int().nonnegative(),
  pendingSessions: z.int().nonnegative(),
  unavailableSessions: z.int().nonnegative(),
  counts: countsSchema,
  currentEvidence: z.strictObject({
    snapshotId: z.string().nullable(),
    fileName: z.string().nullable(),
    fictional: z.boolean(),
    period: z.string().nullable(),
    sourceRow: z.int().positive().nullable(),
  }),
  areas: z
    .array(
      z.strictObject({
        id: preparationAreaSchema,
        title: z.string(),
        description: z.string(),
        drill: z.string(),
        missingEvidence: z.array(z.string()),
        counts: countsSchema,
        facts: z.array(metricFactSchema).max(8),
        actions: z.array(actionSchema).max(3),
        strengths: z
          .array(
            z.strictObject({
              statement: z.string(),
              quote: z.string(),
              createdAt: z.iso.datetime(),
              fictional: z.boolean(),
              partial: z.boolean(),
            }),
          )
          .max(3),
      }),
    )
    .length(6),
  recentSessions: z
    .array(
      z.strictObject({
        id: z.string(),
        scenario: z.string(),
        createdAt: z.iso.datetime(),
        fictional: z.boolean(),
        partial: z.boolean(),
        reviewStatus: z.string(),
        counts: countsSchema,
        offset: z.int().nonnegative(),
      }),
    )
    .max(5),
});
export type PreparationArea = z.infer<typeof preparationAreaSchema>;
export type PreparationProgress = z.infer<typeof preparationProgressSchema>;
export type PreparationAction = PreparationProgress['areas'][number]['actions'][number];
