import { z } from 'zod';
import { rehearsalSchema } from './Workspace.js';

export const avatarSessionResponseSchema = z.strictObject({
  session: rehearsalSchema,
  token: z.string().min(1),
});

export const avatarCorrelationSchema = z.object({
  june_session_id: z.uuid(),
  june_session_nonce: z.string().regex(/^[a-f0-9]{64}$/),
});

export type AvatarSessionResponse = z.infer<typeof avatarSessionResponseSchema>;
