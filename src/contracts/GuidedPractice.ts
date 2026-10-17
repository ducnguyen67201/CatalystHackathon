import { z } from 'zod';
import { questionWhySchema } from './QuestionWhy.js';
import { evaluationContextSchema, evidenceCheckSchema } from './RehearsalEvaluation.js';

const id = z.uuid();
const refs = z.array(z.string().min(1).max(200)).max(20);
export const practiceTurnOutputSchema = z.strictObject({
  decision: z.enum(['keep', 'clarify', 'correct', 'pivot', 'request_evidence']),
  gap: z.string().max(1500),
  reply: z.string().trim().min(1).max(2000),
  question: z.string().trim().min(1).max(2000),
  why: questionWhySchema,
  claimIds: refs,
  factIds: refs,
  investorSourceIds: refs,
  resolvedFindingIds: refs,
});
export type PracticeTurnOutput = z.infer<typeof practiceTurnOutputSchema>;
export const guidedTurnSchema = practiceTurnOutputSchema.extend({
  id,
  sequence: z.int().nonnegative(),
  answerId: id.nullable(),
  createdAt: z.iso.datetime(),
  promptVersion: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  checks: z.array(evidenceCheckSchema).max(30),
});
export const guidedAnswerSchema = z.strictObject({
  id,
  questionId: id,
  text: z.string().trim().min(1).max(3000),
  requestKey: id,
  expectedRevision: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export const guidedStateSchema = z.strictObject({
  version: z.literal(1),
  startKey: id,
  revision: z.int().nonnegative(),
  contextHash: z.string().length(64),
  model: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(100),
  turns: z.array(guidedTurnSchema).min(1).max(25),
  answers: z.array(guidedAnswerSchema).max(24),
  pending: z.strictObject({ answerId: id, generation: z.int().nonnegative() }).nullable(),
});
export type GuidedState = z.infer<typeof guidedStateSchema>;
export const guidedStartSchema = z.strictObject({
  generationId: id,
  scenarioId: z.string().regex(/^[a-z0-9-]{1,60}$/),
  requestKey: id,
});
export const guidedAnswerRequestSchema = guidedAnswerSchema.omit({ id: true, createdAt: true });
export const guidedRevisionSchema = z.strictObject({ expectedRevision: z.int().nonnegative() });
export const guidedViewSchema = z.strictObject({
  id,
  status: z.enum(['active', 'completed', 'partial']),
  createdAt: z.iso.datetime(),
  transcriptReceivedAt: z.iso.datetime().nullable(),
  guided: guidedStateSchema,
  context: evaluationContextSchema,
  pendingStatus: z.enum(['queued', 'running', 'failed']).nullable(),
});
export type GuidedView = z.infer<typeof guidedViewSchema>;
export const guidedHistorySchema = z
  .array(
    z.strictObject({
      id,
      status: z.enum(['active', 'completed', 'partial']),
      createdAt: z.iso.datetime(),
    }),
  )
  .max(20);
