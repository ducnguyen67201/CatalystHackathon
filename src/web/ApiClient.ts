import { z } from 'zod';
import { LocalSessionError } from '../contracts/LocalSession.js';
import {
  stateResponseSchema,
  voiceResponseSchema,
  jobSchema,
  type StateResponse,
  type VoiceResponse,
  type Job,
} from '../contracts/Workspace.js';
const errorSchema = z.object({ error: z.string(), code: z.string().optional() });

let pendingSession: Promise<void> | null = null;

/** Only explicit pre-handler session rejections are replayed, once, without reloading the form. */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const options: RequestInit = {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
  let response = await fetch(`/api${path}`, options);
  let raw: unknown = await response.json();
  const rejected = errorSchema.safeParse(raw);

  if (
    path !== '/session' &&
    response.status === 401 &&
    rejected.success &&
    rejected.data.code === LocalSessionError.REQUIRED
  ) {
    await startLocalSession();
    response = await fetch(`/api${path}`, options);
    raw = await response.json();
  }

  if (!response.ok) {
    const error = errorSchema.safeParse(raw);
    throw new Error(error.success ? error.data.error : 'The request failed.');
  }
  return schema.parse(raw);
}

export async function startLocalSession(): Promise<void> {
  /* Polling and a form submission can both discover a stale cookie at the same time. */
  pendingSession ??= request('/session', z.object({ ok: z.literal(true) }))
    .then(() => undefined)
    .finally(() => {
      pendingSession = null;
    });
  await pendingSession;
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
