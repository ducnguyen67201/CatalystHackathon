import { z } from 'zod';
import { rehearsalSchema } from './Workspace.js';
import { scenarioSelectionSchema } from './Scenario.js';

export const voiceSessionRequestSchema = z.strictObject({
  selection: scenarioSelectionSchema.optional(),
});

export const voiceSessionResponseSchema = z.strictObject({
  session: rehearsalSchema,
  token: z.string().min(1),
  dynamicVariables: z.strictObject({
    company_name: z.string(),
    brief_context: z.string(),
    previous_session_summary: z.string(),
  }),
});

export type VoiceSessionResponse = z.infer<typeof voiceSessionResponseSchema>;
