import { trackedInvestorSchema } from '../src/contracts/InvestorTracking.js';
import { LocalSessionError } from '../src/contracts/LocalSession.js';
import { loadEnvironmentValues } from '../src/server/LoadEnvironment.js';
import { randomUUID, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  stateResponseSchema,
  profileSchema,
  voiceResponseSchema,
  jobSchema,
  JobStatus,
} from '../src/contracts/Workspace.js';
import { PrismaStore } from '../src/infrastructure/PrismaStore.js';
import { DemoResearch } from '../src/infrastructure/Research.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import { readEnvironment } from '../src/server/Env.js';
import { createApi } from '../src/server/Api.js';
import { runWorkerTick } from '../src/server/Worker.js';
import { NoopPracticeContextProvider } from '../src/features/PracticeContextProvider.js';
import { voiceSessionResponseSchema } from '../src/contracts/VoicePractice.js';
import type { createVoiceToken } from '../src/infrastructure/Voice.js';
import type { AvatarProvider } from '../src/features/AvatarProvider.js';
import { avatarSessionResponseSchema } from '../src/contracts/AvatarPractice.js';
let app: FastifyInstance;
let store: PrismaStore;
let service: WorkspaceService;
let sessionCookie = '';
const databaseName = 'june_test_' + randomUUID().replaceAll('-', '');
const injectedValues = loadEnvironmentValues(process.env);
const adminUrl = injectedValues.DATABASE_URL ?? 'postgresql://june:june_local@127.0.0.1:55436/june';
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = '/' + databaseName;
const admin = new Client({ connectionString: adminUrl });
beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const result = spawnSync('pnpm', ['db:deploy'], {
    env: { ...injectedValues, DATABASE_URL: databaseUrl.href },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error('Temporary database migration failed.');
  }
  store = new PrismaStore(databaseUrl.href);
  service = new WorkspaceService(store, new DemoResearch());
  await service.initialize(readFileSync('fixtures/Tidewell.csv', 'utf8'));
  await service.rebuild();
  app = await createApi(
    service,
    readEnvironment({ DATABASE_URL: databaseUrl.href, WEB_ORIGIN: 'http://127.0.0.1:4317' }),
  );
  await app.ready();
  const response = await app.inject({ method: 'POST', url: '/api/session' });
  sessionCookie = response.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
}, 60000);
afterAll(async () => {
  await app.close();
  await store.close();
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
});
async function state() {
  const response = await app.inject({ url: '/api/state', headers: { cookie: sessionCookie } });
  return stateResponseSchema.parse(response.json());
}
describe('PostgreSQL-backed application workflow', () => {
  it('binds video transcripts through signed correlation and stops the stored provider session', async () => {
    const avatarId = 'b672e83f-398a-4701-ac89-949fe3b680ea';
    const createToken = vi
      .fn<AvatarProvider['createToken']>()
      .mockResolvedValue({ token: 'video-token', avatarSessionId: avatarId });
    const stopSession = vi.fn<AvatarProvider['stopSession']>().mockResolvedValue(undefined);
    const videoApi = await createApi(
      service,
      readEnvironment({
        DATABASE_URL: databaseUrl.href,
        LIVEAVATAR_API_KEY: 'avatar-key',
        LIVEAVATAR_AVATAR_ID: avatarId,
        LIVEAVATAR_ELEVENLABS_SECRET_ID: 'b822515d-d4a5-431c-bbc4-059bfca7b702',
        ELEVENLABS_AGENT_ID: 'video-agent',
        ELEVENLABS_WEBHOOK_SECRET: 'video-secret',
      }),
      {
        contextProvider: new NoopPracticeContextProvider(),
        createToken: vi.fn<typeof createVoiceToken>(),
        avatarProvider: { createToken, stopSession },
      },
    );
    try {
      const login = await videoApi.inject({ method: 'POST', url: '/api/session' });
      const headers = {
        cookie: login.cookies.map((item) => `${item.name}=${item.value}`).join('; '),
      };
      const response = await videoApi.inject({
        method: 'POST',
        url: '/api/avatar/sessions',
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      const started = avatarSessionResponseSchema.parse(response.json());
      expect(started.session.context?.mode).toBe('empty');
      expect(started.session.conversationId).toBeNull();
      const nonce = createToken.mock.calls.at(0)?.[3];
      expect(nonce).toHaveLength(64);
      expect(response.body).not.toContain(nonce);
      const before = (await service.read()).briefs.length;
      async function deliver(
        correlationNonce: string | undefined,
        conversationId = 'video-conversation',
      ) {
        const body = JSON.stringify({
          type: 'post_call_transcription',
          data: {
            agent_id: 'video-agent',
            conversation_id: conversationId,
            status: 'done',
            conversation_initiation_client_data: {
              dynamic_variables: {
                june_session_id: started.session.id,
                june_session_nonce: correlationNonce,
              },
            },
            transcript: [
              { role: 'agent', message: 'Tell me about your business.' },
              { role: 'user', message: 'We help teams prepare.' },
            ],
          },
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac('sha256', 'video-secret')
          .update(`${timestamp}.${body}`)
          .digest('hex');
        return videoApi.inject({
          method: 'POST',
          url: '/api/webhooks/elevenlabs',
          headers: {
            'content-type': 'application/json',
            'elevenlabs-signature': `t=${timestamp},v0=${signature}`,
          },
          payload: body,
        });
      }
      expect((await deliver('0'.repeat(64))).statusCode).toBe(202);
      expect((await deliver(nonce)).statusCode).toBe(200);
      expect((await deliver(nonce, 'different-conversation')).statusCode).toBe(202);
      expect((await deliver(nonce)).statusCode).toBe(200);
      const saved = (await service.read()).rehearsals.find(
        (item) => item.id === started.session.id,
      );
      expect(saved?.conversationId).toBe('video-conversation');
      expect(saved?.turns).toHaveLength(2);
      expect(saved?.status).toBe('completed');
      expect((await service.read()).briefs).toHaveLength(before);
      expect(
        (
          await videoApi.inject({
            method: 'POST',
            url: `/api/avatar/sessions/${started.session.id}/end`,
            headers,
            payload: { completed: true },
          })
        ).statusCode,
      ).toBe(200);
      expect(stopSession).toHaveBeenCalledWith('avatar-key', avatarId);
      createToken.mockRejectedValueOnce(new Error('Provider unavailable'));
      expect(
        (
          await videoApi.inject({
            method: 'POST',
            url: '/api/avatar/sessions',
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(500);
      expect((await service.read()).rehearsals.at(-1)?.status).toBe('partial');
    } finally {
      await videoApi.close();
    }
  });
  it('starts with empty context and persists only a verified transcript without changing briefs', async () => {
    const tokenProvider = vi.fn<typeof createVoiceToken>().mockResolvedValue({
      token: 'test-short-lived-token',
      conversationId: 'standalone-conversation',
    });
    const voiceApi = await createApi(
      service,
      readEnvironment({
        DATABASE_URL: databaseUrl.href,
        ELEVENLABS_API_KEY: 'test-server-key',
        ELEVENLABS_AGENT_ID: 'test-agent',
        ELEVENLABS_WEBHOOK_SECRET: 'test-secret',
      }),
      { contextProvider: new NoopPracticeContextProvider(), createToken: tokenProvider },
    );
    try {
      const login = await voiceApi.inject({ method: 'POST', url: '/api/session' });
      const headers = {
        cookie: login.cookies.map((item) => `${item.name}=${item.value}`).join('; '),
      };
      const before = await service.read();
      expect(
        (await voiceApi.inject({ method: 'POST', url: '/api/voice/sessions', payload: {} }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await voiceApi.inject({
            method: 'POST',
            url: '/api/voice/sessions',
            headers,
            payload: { context: { company: 'fake' } },
          })
        ).statusCode,
      ).toBe(400);
      expect(tokenProvider).not.toHaveBeenCalled();
      const response = await voiceApi.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      const started = voiceSessionResponseSchema.parse(response.json());
      expect(started.session.briefId).toBeNull();
      expect(started.session.context?.mode).toBe('empty');
      expect(started.dynamicVariables.company_name).toBe('the founder');
      expect(started.dynamicVariables.brief_context).not.toContain('Tidewell');
      expect(started.dynamicVariables.previous_session_summary).toBe(
        'No previous rehearsal supplied.',
      );
      expect(tokenProvider).toHaveBeenCalledWith('test-server-key', 'test-agent');
      expect(
        (
          await voiceApi.inject({
            method: 'POST',
            url: '/api/voice/sessions',
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(400);
      expect(tokenProvider).toHaveBeenCalledTimes(1);

      await voiceApi.inject({
        method: 'POST',
        url: `/api/rehearsals/${started.session.id}/end`,
        headers,
        payload: {
          turns: [{ role: 'user', text: 'Forged browser transcript' }],
          completed: true,
        },
      });
      const pending = (await service.read()).rehearsals.find(
        (item) => item.id === started.session.id,
      );
      expect(pending?.status).toBe('awaiting_transcript');
      expect(pending?.turns).toEqual([]);

      async function deliver(conversationId: string, agentId: string, signatureValid = true) {
        const body = JSON.stringify({
          type: 'post_call_transcription',
          data: {
            conversation_id: conversationId,
            agent_id: agentId,
            status: 'done',
            transcript: [
              { role: 'agent', message: 'What does your company do?' },
              { role: 'user', message: 'We help teams prepare for meetings.' },
            ],
          },
        });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac('sha256', 'test-secret')
          .update(`${timestamp}.${body}`)
          .digest('hex');
        return voiceApi.inject({
          method: 'POST',
          url: '/api/webhooks/elevenlabs',
          headers: {
            'content-type': 'application/json',
            'elevenlabs-signature': `t=${timestamp},v0=${signatureValid ? signature : 'bad'}`,
          },
          payload: body,
        });
      }
      expect((await deliver('standalone-conversation', 'test-agent', false)).statusCode).toBe(401);
      expect((await deliver('unknown-conversation', 'test-agent')).statusCode).toBe(202);
      expect((await deliver('standalone-conversation', 'wrong-agent')).statusCode).toBe(403);
      expect((await deliver('standalone-conversation', 'test-agent')).statusCode).toBe(200);
      const completed = (await service.read()).rehearsals.find(
        (item) => item.id === started.session.id,
      );
      expect(completed?.status).toBe('completed');
      expect(completed?.turns).toHaveLength(2);
      expect(completed?.review).toBeNull();
      expect(completed?.transcriptReceivedAt).toEqual(expect.any(String));
      await deliver('standalone-conversation', 'test-agent');
      await voiceApi.inject({
        method: 'POST',
        url: `/api/rehearsals/${started.session.id}/end`,
        headers,
        payload: { turns: [], completed: false },
      });
      const reloaded = new PrismaStore(databaseUrl.href);
      try {
        const persisted = await reloaded.load();
        expect(persisted?.rehearsals.find((item) => item.id === started.session.id)).toEqual(
          completed,
        );
        expect(persisted?.briefs).toEqual(before.briefs);
        expect(persisted?.snapshots).toEqual(before.snapshots);
      } finally {
        await reloaded.close();
      }
    } finally {
      await voiceApi.close();
    }
  });

  it('keeps a verified partial transcript when a delayed browser end arrives', async () => {
    const context = await new NoopPracticeContextProvider().loadContext();
    const session = await service.createRehearsal(
      null,
      'elevenlabs',
      'interrupted-conversation',
      context,
    );
    const turns = [{ role: 'agent' as const, text: 'Can you hear me?' }];
    await service.finishRehearsal(session.id, turns, false, true);
    await service.finishRehearsal(session.id, [], true);
    await service.finishRehearsal(session.id, [], false, true);
    const saved = (await service.read()).rehearsals.find((item) => item.id === session.id);
    expect(saved?.status).toBe('partial');
    expect(saved?.turns).toEqual(turns);
    expect(saved?.transcriptReceivedAt).not.toBeNull();
    expect(saved?.review).toBeNull();
  });
  it('rejects missing sessions and cross-origin commands', async () => {
    expect((await app.inject({ url: '/api/state' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/session',
          headers: { origin: 'https://attacker.example' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('rejects a previous API session before writes and accepts a renewed session', async () => {
    const restartedApi = await createApi(
      service,
      readEnvironment({ DATABASE_URL: databaseUrl.href, WEB_ORIGIN: 'http://127.0.0.1:4317' }),
    );
    try {
      const before = await service.read();
      const rejected = await restartedApi.inject({
        method: 'PUT',
        url: '/api/profile',
        headers: { cookie: sessionCookie },
        payload: before.profile,
      });
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json<unknown>()).toEqual({
        code: LocalSessionError.REQUIRED,
        error: 'Your local session ended. Please try again to reconnect.',
      });
      expect(await service.read()).toEqual(before);

      const login = await restartedApi.inject({ method: 'POST', url: '/api/session' });
      const renewedCookie = login.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
      const restored = await restartedApi.inject({
        url: '/api/state',
        headers: { cookie: renewedCookie },
      });
      expect(restored.statusCode).toBe(200);
      expect(stateResponseSchema.parse(restored.json()).workspace).toEqual(before);
    } finally {
      await restartedApi.close();
    }
  });
  it('persists one opportunity and notification across repeated radar executions', async () => {
    const key = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/api/radar',
      headers: { cookie: sessionCookie },
      payload: { key },
    });
    expect(first.statusCode).toBe(202);
    const one = jobSchema.parse(first.json());
    const two = jobSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/radar',
          headers: { cookie: sessionCookie },
          payload: { key },
        })
      ).json(),
    );
    expect(one.id).toBe(two.id);
    await runWorkerTick(service);
    await service.store.enqueue(randomUUID(), 'radar');
    await runWorkerTick(service);
    const response = await state();
    expect(response.workspace.evidence).toHaveLength(1);
    expect(response.workspace.notices).toHaveLength(1);
    expect(response.workspace.briefs.at(-1)?.finding.netIncome).toBe('122503');
  });
  it('completes research runs beyond the former daily limit', async () => {
    const jobIds = new Set<string>();
    for (let run = 0; run < 12; run += 1) {
      const job = await service.store.enqueue(randomUUID(), 'radar');
      jobIds.add(job.id);
      expect(await runWorkerTick(service)).toBe(true);
    }
    const jobs = (await service.store.listJobs()).filter((job) => jobIds.has(job.id));
    expect(jobs).toHaveLength(12);
    expect(jobs.every((job) => job.status === JobStatus.SUCCEEDED)).toBe(true);
  });
  it('saves a written rehearsal, creates a brief revision and tracks a source-backed follow-up', async () => {
    const initial = await state();
    const brief = initial.workspace.briefs.at(-1);
    if (!brief) {
      throw new Error('Missing brief');
    }
    const create = await app.inject({
      method: 'POST',
      url: '/api/rehearsals',
      headers: { cookie: sessionCookie },
      payload: { briefId: brief.id, mode: 'text' },
    });
    expect(create.statusCode).toBe(200);
    const session = voiceResponseSchema.parse(create.json()).session;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/rehearsals/${session.id}/answers`,
          headers: { cookie: sessionCookie },
          payload: {
            text: 'Operating performance still showed a loss, while the credit created net profit. We need cash flow for runway.',
          },
        })
      ).statusCode,
    ).toBe(200);
    await app.inject({
      method: 'POST',
      url: `/api/rehearsals/${session.id}/end`,
      headers: { cookie: sessionCookie },
      payload: { turns: [], completed: true },
    });
    const reviewed = await state();
    expect(reviewed.workspace.briefs).toHaveLength(initial.workspace.briefs.length + 1);
    const updated = reviewed.workspace.briefs.at(-1);
    expect(updated?.review?.missing).toEqual([]);
    if (!updated) {
      throw new Error('Missing reviewed brief');
    }
    await app.inject({
      method: 'POST',
      url: '/api/milestones',
      headers: { cookie: sessionCookie },
      payload: { briefId: updated.id },
    });
    const tracked = await state();
    const milestone = tracked.workspace.milestones.at(-1);
    if (!milestone) {
      throw new Error('Missing milestone');
    }
    await app.inject({
      method: 'POST',
      url: `/api/milestones/${milestone.id}/review`,
      headers: { cookie: sessionCookie },
    });
    expect((await state()).workspace.milestones.at(-1)?.observation).toContain(
      'existing months in the same snapshot',
    );
  });
  it('rejects a live session without credentials and a webhook without configuration', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/voice/sessions',
          headers: { cookie: sessionCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(503);
    const brief = (await state()).workspace.briefs.at(-1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/rehearsals',
      headers: { cookie: sessionCookie },
      payload: { briefId: brief?.id, mode: 'elevenlabs' },
    });
    expect(response.statusCode).toBe(503);
    expect(
      (await app.inject({ method: 'POST', url: '/api/webhooks/elevenlabs', payload: {} }))
        .statusCode,
    ).toBe(503);
  });
  it('persists state across a new store connection and recovers an expired job lease', async () => {
    const secondStore = new PrismaStore(databaseUrl.href);
    expect((await secondStore.load())?.evidence).toHaveLength(1);
    await secondStore.close();
    await store.enqueue(randomUUID(), 'radar');
    const claimed = await store.claimJob(new Date());
    expect(claimed).not.toBeNull();
    const recovered = await store.claimJob(new Date(Date.now() + 7 * 60000));
    expect(recovered?.id).toBe(claimed?.id);
    expect(recovered?.leaseToken).not.toBe(claimed?.leaseToken);
    if (claimed) {
      await store.finishJob(claimed, 'obsolete');
    }
    expect((await store.listJobs()).find((job) => job.id === claimed?.id)?.status).toBe('running');
    if (recovered) {
      await store.finishJob(recovered, 'recovered');
    }
  });
  it('only completes live rehearsals from signed known-conversation webhooks, once', async () => {
    const brief = (await state()).workspace.briefs.at(-1);
    if (!brief) {
      throw new Error('Missing brief');
    }
    const session = await service.createRehearsal(
      brief.id,
      'elevenlabs',
      'known-provider-conversation',
    );
    const webhookApi = await createApi(
      service,
      readEnvironment({
        DATABASE_URL: databaseUrl.href,
        ELEVENLABS_AGENT_ID: 'known-agent',
        ELEVENLABS_WEBHOOK_SECRET: 'test-webhook-secret',
      }),
    );
    try {
      const body = JSON.stringify({
        type: 'post_call_transcription',
        data: {
          conversation_id: 'known-provider-conversation',
          agent_id: 'known-agent',
          status: 'done',
          transcript: [
            { role: 'agent', message: 'What drove the profit?' },
            {
              role: 'user',
              message:
                'Operations still lost money. A credit improved net income; cash flow is needed for runway.',
            },
          ],
        },
      });
      expect(
        (
          await webhookApi.inject({
            method: 'POST',
            url: '/api/webhooks/elevenlabs',
            headers: { 'content-type': 'application/json', 'elevenlabs-signature': 't=0,v0=bad' },
            payload: body,
          })
        ).statusCode,
      ).toBe(401);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const hash = createHmac('sha256', 'test-webhook-secret')
        .update(timestamp + '.' + body)
        .digest('hex');
      const headers = {
        'content-type': 'application/json',
        'elevenlabs-signature': `t=${timestamp},v0=${hash}`,
      };
      const before = (await state()).workspace.briefs.length;
      expect(
        (
          await webhookApi.inject({
            method: 'POST',
            url: '/api/webhooks/elevenlabs',
            headers,
            payload: body,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await webhookApi.inject({
            method: 'POST',
            url: '/api/webhooks/elevenlabs',
            headers,
            payload: body,
          })
        ).statusCode,
      ).toBe(200);
      const final = await state();
      expect(final.workspace.briefs).toHaveLength(before + 1);
      expect(final.workspace.rehearsals.find((item) => item.id === session.id)?.status).toBe(
        'completed',
      );
    } finally {
      await webhookApi.close();
    }
  });
});

describe('durable investor research', () => {
  it('protects write routes and persists deduplicated profiles, checks and pauses', async () => {
    const payload = { name: 'Northline Ventures', url: 'https://x.com/northline_demo' };
    expect((await app.inject({ method: 'POST', url: '/api/investors', payload })).statusCode).toBe(
      401,
    );
    const headers = { cookie: sessionCookie };
    const response = await app.inject({ method: 'POST', url: '/api/investors', headers, payload });
    expect(response.statusCode).toBe(201);
    const investor = trackedInvestorSchema.parse(response.json());
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/investors',
      headers,
      payload: { ...payload, url: 'https://twitter.com/NORTHLINE_DEMO?ref=abc' },
    });
    expect(trackedInvestorSchema.parse(duplicate.json()).id).toBe(investor.id);
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/investors',
      headers,
      payload: { url: 'https://localhost' },
    });
    expect(invalid.statusCode).toBe(400);
    const first = await service.investors.enqueueCheck(investor.id, randomUUID());
    const second = await service.investors.enqueueCheck(investor.id, randomUUID());
    expect(second.id).toBe(first.id);
    await runWorkerTick(service);
    const saved = (await state()).workspace.investors.find((item) => item.id === investor.id);
    expect(saved?.checks).toHaveLength(1);
    expect(saved?.checks[0]?.evidenceIds).toContain('demo-northline');
    const freshStore = new PrismaStore(databaseUrl.href);
    try {
      expect(
        (await freshStore.load())?.investors.find((item) => item.id === investor.id)?.checks,
      ).toHaveLength(1);
    } finally {
      await freshStore.close();
    }
    const paused = await app.inject({
      method: 'PUT',
      url: `/api/investors/${investor.id}/schedule`,
      headers,
      payload: { frequency: 'paused' },
    });
    expect(paused.statusCode).toBe(200);
    expect(
      (await state()).workspace.investors.find((item) => item.id === investor.id)?.nextAt,
    ).toBeNull();
    const before = (await state()).workspace.notices.length;
    await service.investors.enqueueCheck(investor.id, randomUUID());
    await runWorkerTick(service);
    expect((await state()).workspace.notices).toHaveLength(before);
    expect(
      (await state()).workspace.investors.find((item) => item.id === investor.id)?.checks,
    ).toHaveLength(2);
  });

  it('deduplicates concurrent checks at the database boundary', async () => {
    const investor = await service.investors.add({
      name: 'Another investor',
      url: 'https://example.com',
      frequency: 'paused',
    });
    const jobs = await Promise.all(
      Array.from({ length: 4 }, () => service.investors.enqueueCheck(investor.id, randomUUID())),
    );
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
    await runWorkerTick(service);
    expect(
      (await service.read()).investors.find((item) => item.id === investor.id)?.checks[0]
        ?.evidenceIds,
    ).toEqual([]);
  });
});

describe('saved founder onboarding', () => {
  it('resumes setup, preserves history, and passes all links to investor research', async () => {
    const headers = { cookie: sessionCookie };
    const initial = (await state()).workspace;
    expect(initial.onboarding.completedAt).toBeNull();
    const rejected = await app.inject({
      method: 'PUT',
      url: '/api/onboarding/meeting',
      headers,
      payload: { meeting: null },
    });
    expect(rejected.statusCode).toBe(400);
    const sample = await app.inject({ method: 'POST', url: '/api/onboarding/sample', headers });
    expect(sample.statusCode).toBe(200);
    const selected = (await state()).workspace;
    expect(selected.onboarding.step).toBe(2);
    expect(selected.snapshots).toHaveLength(initial.snapshots.length);
    const profile = profileSchema.omit({ version: true }).parse({
      name: selected.profile.name,
      stage: selected.profile.stage,
      sector: selected.profile.sector,
      geography: selected.profile.geography,
      raiseTarget: selected.profile.raiseTarget,
      currency: selected.profile.currency,
      goal: selected.profile.goal,
      watchlist: selected.profile.watchlist,
    });
    const company = await app.inject({
      method: 'PUT',
      url: '/api/onboarding/company',
      headers,
      payload: { ...profile, stage: 'Not confirmed', sector: '', geography: '', raiseTarget: null },
    });
    expect(company.statusCode).toBe(200);
    const links = {
      linkedin: 'https://linkedin.com/in/catalyst-example',
      x: 'https://x.com/catalystdemo',
      website: 'https://example.com/investors',
    };
    const meeting = {
      name: 'Example investor',
      firm: 'Example firm',
      date: null,
      notes: 'PRIVATE meeting question',
      links,
    };
    const finish = await app.inject({
      method: 'PUT',
      url: '/api/onboarding/meeting',
      headers,
      payload: { meeting },
    });
    expect(finish.statusCode).toBe(200);
    const saved = (await state()).workspace;
    expect(saved.onboarding.completedAt).not.toBeNull();
    expect(saved.onboarding.meeting?.links).toEqual(links);
    expect(saved.snapshots).toEqual(selected.snapshots);
    const brief = saved.briefs.at(-1);
    expect(brief?.meeting?.notes).toBe(meeting.notes);
    expect(brief?.evidenceId).toBeNull();
    expect(saved.briefs.slice(0, initial.briefs.length)).toEqual(initial.briefs);
    const investor = saved.investors.find(
      (item) => item.id === saved.onboarding.meeting?.investorId,
    );
    expect(investor?.profileLinks).toEqual(Object.values(links));
    expect(investor?.frequency).toBe('paused');
    const calls: unknown[] = [];
    const researchService = new WorkspaceService(store, {
      discover: (_profile, target) => {
        calls.push(target);
        return Promise.resolve([]);
      },
    });
    if (!investor) {
      throw new Error('Missing onboarding investor');
    }
    await researchService.investors.check(investor.id, randomUUID());
    expect(calls).toEqual([
      {
        name: 'Example investor, Example firm',
        url: links.linkedin,
        profileLinks: Object.values(links),
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('PRIVATE');
    const reopened = new PrismaStore(databaseUrl.href);
    try {
      expect((await reopened.load())?.onboarding).toEqual(saved.onboarding);
    } finally {
      await reopened.close();
    }
    const edited = await app.inject({
      method: 'PUT',
      url: '/api/onboarding/meeting',
      headers,
      payload: { meeting: { ...meeting, notes: 'A new question' } },
    });
    expect(edited.statusCode).toBe(200);
    const current = (await state()).workspace;
    expect(current.investors).toHaveLength(saved.investors.length);
    expect(current.briefs.find((item) => item.id === brief?.id)?.meeting?.notes).toBe(
      'PRIVATE meeting question',
    );
    expect(current.briefs.at(-1)?.meeting?.notes).toBe('A new question');
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/onboarding/meeting',
      headers,
      payload: { meeting: { ...meeting, links: { ...links, linkedin: 'https://localhost' } } },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await state()).workspace.onboarding).toEqual(current.onboarding);
    const skipped = await app.inject({
      method: 'PUT',
      url: '/api/onboarding/meeting',
      headers,
      payload: { meeting: null },
    });
    expect(skipped.statusCode).toBe(200);
    expect((await state()).workspace.onboarding.meeting).toBeNull();
  });
});

describe('onboarding restart', () => {
  it('reopens step one persistently while retaining all saved context and history', async () => {
    const before = (await state()).workspace;
    const headers = { cookie: sessionCookie };
    expect(
      (await app.inject({ method: 'POST', url: '/api/onboarding/restart', payload: {} }))
        .statusCode,
    ).toBe(401);
    for (let count = 0; count < 2; count++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/onboarding/restart',
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(200);
    }
    const reopened = new PrismaStore(databaseUrl.href);
    try {
      const after = await reopened.load();
      expect(after).toEqual({
        ...before,
        revision: before.revision + 2,
        onboarding: { ...before.onboarding, step: 1, completedAt: null },
      });
    } finally {
      await reopened.close();
    }
  });
});
