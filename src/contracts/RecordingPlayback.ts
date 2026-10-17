import { z } from 'zod';

export const recordingSegmentSchema = z.strictObject({
  turnIndex: z.int().min(0).max(199),
  startSeconds: z.number().min(0).max(3600),
});
export const recordingPlaybackSchema = z.strictObject({
  available: z.boolean(),
  durationSeconds: z.number().positive().max(3600).nullable(),
  segments: z.array(recordingSegmentSchema).max(200),
  label: z.string().max(500),
  reason: z.string().max(1000).nullable(),
});
export type RecordingPlayback = z.infer<typeof recordingPlaybackSchema>;
