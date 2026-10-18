import { z } from 'zod';

/** A preparation aid, never a founder response or an assessment record. */
export const practiceAnswerGuideSchema = z.strictObject({
  text: z.string().min(1).max(3000),
  basis: z.literal('approved_story'),
  pitchId: z.uuid(),
  sourceIds: z.array(z.string().min(1).max(100)).max(12),
  fictional: z.boolean(),
  checkpoints: z.array(z.string().min(1).max(2000)).min(2).max(4),
});
export type PracticeAnswerGuide = z.infer<typeof practiceAnswerGuideSchema>;
