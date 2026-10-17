import { z } from 'zod';
import {
  stateResponseSchema,
  voiceResponseSchema,
  jobSchema,
  type StateResponse,
  type VoiceResponse,
  type Job,
} from '../contracts/Workspace.js';
const errorSchema = z.object({ error: z.string() });
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const raw: unknown = await response.json();
  if (!response.ok) {
    const error = errorSchema.safeParse(raw);
    throw new Error(error.success ? error.data.error : 'The request failed.');
  }
  return schema.parse(raw);
}
export async function startLocalSession(): Promise<void> {
  await request('/session', z.object({ ok: z.boolean() }));
}
export async function fetchState(): Promise<StateResponse> {
  return request('/state', stateResponseSchema, undefined, 'GET');
}
export async function command(path: string, body?: unknown, method = 'POST'): Promise<void> {
  await request(path, z.unknown(), body, method);
}
export async function startRadar(): Promise<Job> {
  return request('/radar', jobSchema, { key: crypto.randomUUID() });
}
export async function startRehearsal(
  briefId: string,
  mode: 'demo' | 'text' | 'elevenlabs',
): Promise<VoiceResponse> {
  return request('/rehearsals', voiceResponseSchema, { briefId, mode });
}
