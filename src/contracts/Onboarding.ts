import { z } from 'zod';
import { profileLinksSchema } from './ProfileLinks.js';

export const meetingInputSchema = z.strictObject({
  name: z.string().trim().max(100),
  firm: z.string().trim().max(100),
  date: z.iso.date().nullable(),
  notes: z.string().trim().max(5000),
  links: profileLinksSchema,
});

export const meetingSchema = meetingInputSchema.extend({
  investorId: z.uuid().nullable(),
  revision: z.int().positive(),
});

export const onboardingSchema = z.strictObject({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  snapshotId: z.string().nullable().default(null),
  completedAt: z.iso.datetime().nullable().default(null),
  meeting: meetingSchema.nullable().default(null),
});

export type Onboarding = z.infer<typeof onboardingSchema>;
export type Meeting = z.infer<typeof meetingSchema>;
export type MeetingInput = z.infer<typeof meetingInputSchema>;
