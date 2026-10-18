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
let retryAt = 0;
const pendingReads = new Map<string, Promise<unknown>>();

export class ApiRateLimitError extends Error {
  constructor(readonly retryAt: number) {
    super(
      `Too many requests to June. Try again in ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} seconds.`,
    );
    this.name = 'ApiRateLimitError';
  }
}

async function send(path: string, options: RequestInit): Promise<Response> {
  // All polling components share a budget. Respect the server's pause instead of flooding it.
  if (Date.now() < retryAt) throw new ApiRateLimitError(retryAt);
  const response = await fetch(`/api${path}`, options);
  if (response.status === 429) {
    const header = response.headers.get('retry-after');
    const seconds = header === null ? NaN : Number(header);
    const until = Number.isFinite(seconds)
      ? Date.now() + Math.max(1, seconds) * 1000
      : Date.parse(header ?? '');
    retryAt = Math.max(retryAt, Number.isFinite(until) ? until : Date.now() + 60000);
    throw new ApiRateLimitError(retryAt);
  }
  return response;
}

/** Only explicit pre-handler session rejections are replayed, once, without reloading the form. */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  if (method === 'GET' && body === undefined) {
    let pending = pendingReads.get(path);
    if (!pending) {
      pending = performRequest(path, body, method).finally(() => {
        if (pendingReads.get(path) === pending) pendingReads.delete(path);
      });
      pendingReads.set(path, pending);
    }
    // Share the read, but validate separately for every caller. No response cache.
    return schema.parse(await pending);
  }
  // A read started before a command must not satisfy a post-command refresh.
  pendingReads.clear();
  return schema.parse(await performRequest(path, body, method));
}

async function performRequest(path: string, body: unknown, method: string): Promise<unknown> {
  const options: RequestInit = {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
  let response = await send(path, options);
  let raw: unknown = await response.json();
  const rejected = errorSchema.safeParse(raw);

  if (
    path !== '/session' &&
    response.status === 401 &&
    rejected.success &&
    rejected.data.code === LocalSessionError.REQUIRED
  ) {
    await startLocalSession();
    response = await send(path, options);
    raw = await response.json();
  }

  if (!response.ok) {
    const error = errorSchema.safeParse(raw);
    throw new Error(error.success ? error.data.error : 'The request failed.');
  }
  return raw;
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
