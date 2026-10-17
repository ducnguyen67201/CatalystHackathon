import { z } from 'zod';

const text = z.string().trim().min(1).max(1500);
const refs = z.array(z.string().min(1).max(200)).max(40);

/** Public teaching explanation, saved with its question; never model chain-of-thought. */
export const questionWhySchema = z.strictObject({
  brief: z.string().trim().min(1).max(240),
  explanation: text,
  answerObjective: text,
  sourceIds: refs,
  missingInputs: z.array(text).max(8),
});
export type QuestionWhy = z.infer<typeof questionWhySchema>;
