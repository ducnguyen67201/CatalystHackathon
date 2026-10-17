import { z } from 'zod';
import { questionWhySchema } from './QuestionWhy.js';
import { evaluationContextSchema } from './RehearsalEvaluation.js';

export const liveGuidanceRequestSchema = z
  .strictObject({
    turnIndex: z.int().min(0).max(199).optional(),
    turns: z
      .array(
        z.strictObject({
          role: z.enum(['agent', 'user']),
          text: z.string().trim().min(1).max(10000),
        }),
      )
      .min(1)
      .max(8),
  })
  .refine((input) => input.turns.at(-1)?.role === 'agent', 'End with the interviewer turn.')
  .refine(
    (input) => input.turns.reduce((size, turn) => size + turn.text.length, 0) <= 16000,
    'Live caption context is too large.',
  );

export const liveGuidanceOutputSchema = z.strictObject({
  why: questionWhySchema,
  factIds: z.array(z.string().min(1).max(200)).max(40),
});
export const liveGuidanceResponseSchema = liveGuidanceOutputSchema.extend({
  question: z.string().min(1).max(10000),
  context: evaluationContextSchema,
});
export type LiveGuidanceRequest = z.infer<typeof liveGuidanceRequestSchema>;
export type LiveGuidanceOutput = z.infer<typeof liveGuidanceOutputSchema>;
export type LiveGuidanceResponse = z.infer<typeof liveGuidanceResponseSchema>;

export const savedLiveGuidanceSchema = liveGuidanceOutputSchema.extend({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  turnIndex: z.int().min(0).max(199).nullable(),
  question: z.string().min(1).max(10000),
  createdAt: z.iso.datetime(),
});
export const liveGuidanceHistorySchema = z.strictObject({
  entries: z.array(savedLiveGuidanceSchema).max(200),
  context: evaluationContextSchema.nullable(),
});
export type SavedLiveGuidance = z.infer<typeof savedLiveGuidanceSchema>;
