import { z } from 'zod';
import { evaluationSourceSchema, metricFactSchema } from './RehearsalEvaluation.js';
import { scenarioSelectionSchema } from './Scenario.js';

const id = z.string().min(1).max(200);
const text = z.string().max(2000);
export const followupQuerySchema = z.strictObject({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export const followupTaskSchema = z.strictObject({
  id,
  title: text,
  gap: text,
  steps: z.array(text).max(3),
  missingInputs: z.array(text).max(10),
  practiceQuestion: text,
  successCriteria: z.array(text).max(5),
  quote: text,
  sources: z.array(evaluationSourceSchema).max(300),
  facts: z.array(metricFactSchema).max(300),
  status: z.enum([
    'open',
    'dismissed',
    'pending',
    'improved',
    'needs_evidence',
    'not_comparable',
    'review_failed',
  ]),
  comparison: text.nullable(),
  retrySessionId: id.nullable(),
});
export const investorFollowupSchema = z.strictObject({
  id,
  title: text,
  headline: text,
  summary: text,
  steps: z.array(text).min(1).max(3),
  quote: text,
  url: z.url().nullable(),
  observedAt: z.iso.datetime(),
  occurredAt: z.string().nullable(),
  fictional: z.boolean(),
  needsReview: z.boolean(),
});
export const followupSessionSchema = z.strictObject({
  id,
  createdAt: z.iso.datetime(),
  scenario: text,
  selection: scenarioSelectionSchema.nullable(),
  contextAt: z.iso.datetime().nullable(),
  investorId: id.nullable(),
  investorName: z.string().nullable(),
  fictional: z.boolean(),
  partial: z.boolean(),
  evaluationId: id.nullable(),
  reviewStatus: z.enum([
    'awaiting_transcript',
    'queued',
    'failed',
    'skipped',
    'ready',
    'unavailable',
  ]),
  tasks: z.array(followupTaskSchema).max(3),
  investorUpdates: z.array(investorFollowupSchema).max(3),
  additionalUpdates: z.int().nonnegative(),
});
export const followupsResponseSchema = z.strictObject({
  sessions: z.array(followupSessionSchema).max(20),
  nextOffset: z.int().nonnegative().nullable(),
});
export type FollowupSession = z.infer<typeof followupSessionSchema>;
export type FollowupTask = z.infer<typeof followupTaskSchema>;
export type FollowupsResponse = z.infer<typeof followupsResponseSchema>;
