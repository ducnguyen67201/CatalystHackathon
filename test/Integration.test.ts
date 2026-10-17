import { radarEvidence } from './fixtures/RadarFixture.js';
import type { EmailSender } from '../src/features/EmailSender.js';
import { fixtureEvaluationProvider } from './EvaluationFixtures.js';
import { fixtureTurnProvider } from './PracticeTurnFixtures.js';
import { guidedViewSchema } from '../src/contracts/GuidedPractice.js';
import { evidenceReviewSchema } from '../src/contracts/EvidenceReview.js';
import { followupsResponseSchema } from '../src/contracts/Followups.js';
import { trackedInvestorSchema } from '../src/contracts/InvestorTracking.js';
import { LocalSessionError } from '../src/contracts/LocalSession.js';
import { loadEnvironmentValues } from '../src/server/LoadEnvironment.js';
import { randomUUID, createHmac, createHash } from 'node:crypto';
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
import { ResearchFixture } from './fixtures/ResearchFixture.js';
import { LiveResearch } from '../src/infrastructure/Research.js';
import {
  importResearchRunSchema,
  researchRunSchema,
  researchRunListSchema,
} from '../src/contracts/ResearchRun.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import { readEnvironment } from '../src/server/Env.js';
import { createApi } from '../src/server/Api.js';
import { runWorkerTick } from '../src/server/Worker.js';
import { NoopPracticeContextProvider } from '../src/features/PracticeContextProvider.js';
import { voiceSessionResponseSchema } from '../src/contracts/VoicePractice.js';
import type { createVoiceToken } from '../src/infrastructure/Voice.js';
import type { AvatarProvider } from '../src/features/AvatarProvider.js';
import { avatarSessionResponseSchema } from '../src/contracts/AvatarPractice.js';
import { DemoScenarioGenerator } from '../src/infrastructure/ScenarioGeneration.js';
import {
  generationSchema,
  generationViewSchema,
  scenarioPreviewSchema,
} from '../src/contracts/Scenario.js';
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
  service = new WorkspaceService(
    store,
    new ResearchFixture(),
    fixtureEvaluationProvider,
    undefined,
    store,
    {
      store,
      generator: new DemoScenarioGenerator(),
    },
    fixtureTurnProvider,
  );
  await service.initialize(readFileSync('fixtures/Tidewell.csv', 'utf8'));
  await service.rebuild();
  await service.investors.discovery.setFrequency('paused');
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

describe('Hosted API access', () => {
  it('opens the public demo without credentials while retaining API origin and session checks', async () => {
    const hosted = await createApi(
      service,
      readEnvironment({
        DATABASE_URL: databaseUrl.href,
        HOSTING_MODE: 'hosted',
        HOSTED_ACCESS_MODE: 'public-demo',
        WEB_ORIGIN: 'https://june.example.com',
        ELEVENLABS_WEBHOOK_SECRET: 'public-demo-test-secret',
      }),
    );
    try {
      const page = await hosted.inject('/');
      expect(page.statusCode).toBe(200);
      expect(page.headers['www-authenticate']).toBeUndefined();
      expect(page.headers.location).toBeUndefined();
      expect(page.headers['cache-control']).toBe('private, no-store');
      expect((await hosted.inject('/api/state')).statusCode).toBe(401);
      const session = await hosted.inject({
        method: 'POST',
        url: '/api/session',
        headers: { origin: 'https://june.example.com' },
      });
      expect(session.statusCode).toBe(200);
      const cookie = session.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
      const state = await hosted.inject({ url: '/api/state', headers: { cookie } });
      expect(state.statusCode).toBe(200);
      expect(stateResponseSchema.parse(state.json()).workspace.id).toBe('tidewell');
      expect(
        (
          await hosted.inject({
            method: 'POST',
            url: '/api/session',
            headers: { origin: 'https://attacker.example.com' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await hosted.inject({ method: 'POST', url: '/api/webhooks/elevenlabs', payload: {} }))
          .statusCode,
      ).toBe(401);
    } finally {
      await hosted.close();
    }
  });

  it('requires invited membership in addition to a secure session and preserves shared state', async () => {
    const password = 'test-only-hosted-integration-password';
    const hosted = await createApi(
      service,
      readEnvironment({
        DATABASE_URL: databaseUrl.href,
        HOSTING_MODE: 'hosted',
        WEB_ORIGIN: 'https://june.example.com',
        HOSTED_ACCOUNTS: JSON.stringify([
          {
            username: 'guest',
            passwordSha256: createHash('sha256').update(password).digest('hex'),
            workspaceId: 'tidewell',
          },
        ]),
      }),
    );
    try {
      expect((await hosted.inject({ method: 'POST', url: '/api/session' })).statusCode).toBe(401);
      const login = await hosted.inject({
        method: 'POST',
        url: '/login',
        headers: { origin: 'https://june.example.com' },
        payload: { username: 'guest', password },
      });
      expect(login.statusCode).toBe(303);
      const accessCookie = login.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
      const session = await hosted.inject({
        method: 'POST',
        url: '/api/session',
        headers: { cookie: accessCookie, origin: 'https://june.example.com' },
      });
      expect(session.statusCode).toBe(200);
      expect(session.cookies[0]?.secure).toBe(true);
      const cookie = session.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
      expect((await hosted.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(
        401,
      );
      const state = await hosted.inject({
        url: '/api/state',
        headers: { cookie: `${accessCookie}; ${cookie}` },
      });
      expect(state.statusCode).toBe(200);
      const parsed = stateResponseSchema.parse(state.json());
      expect(parsed.workspace.id).toBe('tidewell');
      expect(parsed.capabilities.localOnly).toBe(false);
      expect(
        (
          await hosted.inject({
            method: 'POST',
            url: '/api/session',
            headers: { cookie: accessCookie, origin: 'https://attacker.example.com' },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await hosted.close();
    }
  });
});
async function drainWorker(target: WorkspaceService): Promise<boolean> {
  let ran = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await runWorkerTick(target))) return ran;
    ran = true;
  }
  throw new Error('Test queue did not drain');
}
async function state() {
  const response = await app.inject({ url: '/api/state', headers: { cookie: sessionCookie } });
  return stateResponseSchema.parse(response.json());
}
describe('PostgreSQL-backed application workflow', () => {
  it('runs built-in video without ElevenLabs and saves only provider-fetched transcripts', async () => {
    const avatarId = 'b672e83f-398a-4701-ac89-949fe3b680ea';
    const createToken = vi
      .fn<AvatarProvider['createToken']>()
      .mockResolvedValue({ token: 'video-token', avatarSessionId: avatarId });
    const stopSession = vi.fn<AvatarProvider['stopSession']>().mockResolvedValue(undefined);
    const fetchTranscript = vi.fn<AvatarProvider['fetchTranscript']>().mockResolvedValue(null);
    const videoApi = await createApi(
      service,
      readEnvironment({
        DATABASE_URL: databaseUrl.href,
        LIVEAVATAR_API_KEY: 'avatar-key',
        LIVEAVATAR_AVATAR_ID: avatarId,
        LIVEAVATAR_VOICE_ID: avatarId,
        LIVEAVATAR_CONTEXT_ID: avatarId,
      }),
      {
        contextProvider: new NoopPracticeContextProvider(),
        createToken: vi.fn<typeof createVoiceToken>(),
        avatarProvider: { createToken, stopSession, fetchTranscript },
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
      expect(started.session.mode).toBe('liveavatar');
      expect(started.session.conversationId).toBeNull();
      const before = (await service.read()).briefs.length;
      expect(
        (
          await videoApi.inject({
            method: 'POST',
            url: '/api/avatar/sessions',
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(400);
      expect(createToken).toHaveBeenCalledTimes(1);
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
      expect(
        (await service.read()).rehearsals.find((item) => item.id === started.session.id)?.status,
      ).toBe('awaiting_transcript');
      fetchTranscript.mockResolvedValue([
        { role: 'agent', text: 'Tell me about your business.' },
        { role: 'user', text: 'We help teams prepare.' },
      ]);
      const path = `/api/avatar/sessions/${started.session.id}/transcript`;
      expect(
        (await videoApi.inject({ method: 'POST', url: path, headers, payload: { turns: [] } }))
          .statusCode,
      ).toBe(400);
      expect(
        (await videoApi.inject({ method: 'POST', url: path, headers, payload: {} })).statusCode,
      ).toBe(200);
      expect(fetchTranscript).toHaveBeenLastCalledWith('avatar-key', avatarId);
      const calls = fetchTranscript.mock.calls.length;
      await videoApi.inject({ method: 'POST', url: path, headers, payload: {} });
      expect(fetchTranscript).toHaveBeenCalledTimes(calls);
      const saved = (await service.read()).rehearsals.find(
        (item) => item.id === started.session.id,
      );
      expect(saved?.turns).toHaveLength(2);
      expect(saved?.transcriptReceivedAt).not.toBeNull();
      expect(saved?.status).toBe('completed');
      expect((await service.read()).briefs).toHaveLength(before);
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
      expect(completed?.evaluationContext).not.toBeNull();
      expect(completed?.evaluations[0]?.status).toBe('queued');
      expect(completed?.evaluations[0]).not.toHaveProperty('mode');
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
      const publicBefore = (({ radar: _privateRadar, ...value }) => value)(before);
      expect(stateResponseSchema.parse(restored.json()).workspace).toEqual({
        ...publicBefore,
        rehearsals: before.rehearsals.map((s) => ({
          ...s,
          evaluationContext: null,
          evaluations: [],
          evaluationResponses: [],
        })),
      });
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
    await drainWorker(service);
    await service.store.enqueue(randomUUID(), 'radar');
    await drainWorker(service);
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
      expect(await drainWorker(service)).toBe(true);
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
    await drainWorker(service);
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
    await drainWorker(service);
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
    await drainWorker(service);
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
    const researchService = new WorkspaceService(
      store,
      {
        discover: (_profile, target) => {
          calls.push(target);
          return Promise.resolve([]);
        },
      },
      fixtureEvaluationProvider,
    );
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
    const before = await service.read();
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

describe('saved scenario workflow', () => {
  async function prepare() {
    const investor = await service.investors.add({
      name: 'Scenario test investor',
      url: 'https://example.com/scenario-investor',
      frequency: 'paused',
    });
    for (let index = 0; index < 30 && (await runWorkerTick(service)); index++) {
      /* Drain pre-existing jobs. */
    }
    return investor;
  }

  it('atomically deduplicates generation requests, saves output, and preserves snapshots across updates', async () => {
    const investor = await prepare();
    const headers = { cookie: sessionCookie };
    const payload = {
      investorId: investor.id,
      objective: 'Explain the company clearly',
      key: randomUUID(),
    };
    expect(
      (await app.inject({ method: 'POST', url: '/api/scenario-generations', payload })).statusCode,
    ).toBe(401);
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.inject({ method: 'POST', url: '/api/scenario-generations', headers, payload }),
      ),
    );
    const first = generationSchema.parse(responses[0]?.json());
    const second = generationSchema.parse(responses[1]?.json());
    expect(first.id).toBe(second.id);
    expect(first.jobId).toBe(second.jobId);
    expect(first.output).toBeNull();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scenario-generations',
          headers,
          payload: { ...payload, objective: 'Different request' },
        })
      ).statusCode,
    ).toBe(409);
    await runWorkerTick(service);
    const finished = generationViewSchema.parse(
      (await app.inject({ url: '/api/scenario-generations/' + first.id, headers })).json(),
    );
    expect(finished.status).toBe('succeeded');
    expect(finished.output?.scenarios.length).toBeGreaterThan(0);
    expect(finished.outdated).toBe(false);
    const reopened = new PrismaStore(databaseUrl.href);
    try {
      expect((await reopened.getGeneration(first.id))?.output).toEqual(finished.output);
    } finally {
      await reopened.close();
    }
    await service.change((workspace) => {
      workspace.profile.goal = 'A new preparation goal';
      workspace.profile.version++;
    });
    const stale = generationViewSchema.parse(
      (await app.inject({ url: '/api/scenario-generations/' + first.id, headers })).json(),
    );
    expect(stale.outdated).toBe(true);
    expect(stale.input).toEqual(first.input);
    expect(stale.output).toEqual(finished.output);
  });

  it('reviews server-selected input, rejects changed data and replays a confirmed request safely', async () => {
    const investor = await prepare();
    const headers = { cookie: sessionCookie };
    const payload = {
      investorId: investor.id,
      objective: 'Practise using the current financial evidence',
    };
    const beforeJobs = await store.listJobs();
    expect(
      (await app.inject({ method: 'POST', url: '/api/scenario-generations/preview', payload }))
        .statusCode,
    ).toBe(401);
    const preview = scenarioPreviewSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scenario-generations/preview',
          headers,
          payload,
        })
      ).json(),
    );
    expect(preview.input.sources.some((source) => source.kind === 'financials')).toBe(true);
    expect(await store.listJobs()).toEqual(beforeJobs);
    await service.change((workspace) => {
      workspace.profile.goal = 'Updated after review';
      workspace.profile.version++;
    });
    const stale = await app.inject({
      method: 'POST',
      url: '/api/scenario-generations',
      headers,
      payload: { ...payload, key: randomUUID(), expectedInputHash: preview.inputHash },
    });
    expect(stale.statusCode).toBe(409);
    const fresh = scenarioPreviewSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scenario-generations/preview',
          headers,
          payload,
        })
      ).json(),
    );
    const confirmed = { ...payload, key: randomUUID(), expectedInputHash: fresh.inputHash };
    const created = generationSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scenario-generations',
          headers,
          payload: confirmed,
        })
      ).json(),
    );
    expect(created.input.sources.map(({ capturedAt: _capturedAt, ...source }) => source)).toEqual(
      fresh.input.sources.map(({ capturedAt: _capturedAt, ...source }) => source),
    );
    await runWorkerTick(service);
    await service.change((workspace) => {
      workspace.profile.goal = 'Changed again';
      workspace.profile.version++;
    });
    const replay = generationSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scenario-generations',
          headers,
          payload: confirmed,
        })
      ).json(),
    );
    expect(replay.id).toBe(created.id);
    const next = scenarioPreviewSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scenario-generations/preview',
          headers,
          payload,
        })
      ).json(),
    );
    expect(next.input.previousScenarios.length).toBeGreaterThan(0);
  });

  it('rejects stale worker completion and recovers a leased job without overwriting the saved result', async () => {
    const investor = await prepare();
    if (!service.scenarios) throw new Error('Scenario runtime missing.');
    const generation = await service.scenarios.create(investor.id, '', randomUUID());
    const firstClaim = await store.claimJob(new Date());
    if (!firstClaim || firstClaim.id !== generation.jobId)
      throw new Error('Expected scenario job.');
    const connection = new Client({ connectionString: databaseUrl.href });
    await connection.connect();
    try {
      await connection.query('UPDATE "WorkflowJob" SET "leaseUntil" = $1 WHERE id = $2', [
        new Date(0),
        firstClaim.id,
      ]);
    } finally {
      await connection.end();
    }
    const nextClaim = await store.claimJob(new Date());
    if (!nextClaim) throw new Error('Expected recovered scenario job.');
    const output = await new DemoScenarioGenerator().generate(generation.input);
    await expect(store.completeGeneration(firstClaim, output)).rejects.toThrow('lease');
    expect((await store.getGeneration(generation.id))?.output).toBeNull();
    await service.scenarios.run(nextClaim);
    expect((await store.getGeneration(generation.id))?.status).toBe('succeeded');
    await expect(store.completeGeneration(nextClaim, output)).rejects.toThrow('lease');
    expect((await store.getGeneration(generation.id))?.output).toEqual(output);
  });

  it('passes the selected full scenario to voice and avatar and preserves empty-context practice', async () => {
    const investor = await prepare();
    if (!service.scenarios) throw new Error('Scenario runtime missing.');
    const generation = await service.scenarios.create(investor.id, '', randomUUID());
    await runWorkerTick(service);
    const ready = await service.scenarios.get(generation.id);
    const scenario = ready.output?.scenarios[0];
    if (!scenario) throw new Error('Expected scenario output.');
    const selection = { generationId: ready.id, scenarioId: scenario.id };
    const createToken = vi
      .fn<typeof createVoiceToken>()
      .mockResolvedValue({ token: 'scenario-test-token', conversationId: randomUUID() });
    const avatarToken = vi
      .fn<AvatarProvider['createToken']>()
      .mockResolvedValue({ token: 'scenario-avatar-token', avatarSessionId: randomUUID() });
    const localApi = await createApi(
      service,
      readEnvironment({
        DATABASE_URL: databaseUrl.href,
        ELEVENLABS_API_KEY: 'test-key',
        ELEVENLABS_AGENT_ID: 'test-agent',
        ELEVENLABS_WEBHOOK_SECRET: 'test-secret',
        LIVEAVATAR_API_KEY: 'test-avatar-key',
        LIVEAVATAR_AVATAR_ID: randomUUID(),
        LIVEAVATAR_VOICE_ID: randomUUID(),
        LIVEAVATAR_CONTEXT_ID: randomUUID(),
      }),
      {
        contextProvider: new NoopPracticeContextProvider(),
        createToken,
        avatarProvider: {
          createToken: avatarToken,
          fetchTranscript: vi.fn<AvatarProvider['fetchTranscript']>().mockResolvedValue(null),
          stopSession: vi.fn<AvatarProvider['stopSession']>().mockResolvedValue(undefined),
        },
      },
    );
    try {
      const login = await localApi.inject({ method: 'POST', url: '/api/session' });
      const headers = {
        cookie: login.cookies.map((item) => item.name + '=' + item.value).join('; '),
      };
      expect(
        (
          await localApi.inject({
            method: 'POST',
            url: '/api/voice/sessions',
            headers,
            payload: { selection: { ...selection, prompt: 'override' } },
          })
        ).statusCode,
      ).toBe(400);
      const response = await localApi.inject({
        method: 'POST',
        url: '/api/voice/sessions',
        headers,
        payload: { selection },
      });
      expect(response.statusCode).toBe(200);
      const voice = voiceSessionResponseSchema.parse(response.json());
      expect(voice.session.context?.version).toBe(2);
      expect(voice.session.context?.scenario).toEqual(scenario);
      expect(voice.session.evaluationContext?.investorId).toBe(investor.id);
      expect(voice.session.evaluationContext?.scenario).toBe(scenario.objective);
      expect(voice.dynamicVariables.brief_context).toContain(scenario.openingQuestion);
      const frozen = voice.session.context;
      await service.change((workspace) => {
        workspace.profile.goal = 'Changed after voice start';
        workspace.profile.version++;
      });
      expect(
        (await service.read()).rehearsals.find((item) => item.id === voice.session.id)?.context,
      ).toEqual(frozen);
      await service.finishRehearsal(voice.session.id, [], true);
      expect((await service.evaluations.get(voice.session.id)).evaluations).toHaveLength(0);
      await service.finishRehearsal(
        voice.session.id,
        [
          { role: 'agent', text: scenario.openingQuestion },
          { role: 'user', text: 'Our operating income is -59797 unspecified for 2026-07.' },
        ],
        true,
        true,
      );
      expect((await service.evaluations.get(voice.session.id)).evaluations[0]?.status).toBe(
        'queued',
      );
      await drainWorker(service);
      expect((await service.evaluations.get(voice.session.id)).evaluations[0]?.status).toBe(
        'completed',
      );
      const videoResponse = await localApi.inject({
        method: 'POST',
        url: '/api/avatar/sessions',
        headers,
        payload: { selection },
      });
      expect(videoResponse.statusCode).toBe(200);
      const video = avatarSessionResponseSchema.parse(videoResponse.json());
      expect(video.session.context?.scenario).toEqual(scenario);
      expect(avatarToken.mock.calls[0]?.[1]).toEqual(video.session.context);
      await service.finishRehearsal(video.session.id, [], false);
      createToken.mockResolvedValue({ token: 'empty-test-token', conversationId: randomUUID() });
      const empty = voiceSessionResponseSchema.parse(
        (
          await localApi.inject({
            method: 'POST',
            url: '/api/voice/sessions',
            headers,
            payload: {},
          })
        ).json(),
      );
      expect(empty.session.context?.mode).toBe('empty');
      await service.finishRehearsal(empty.session.id, [], false);
    } finally {
      await localApi.close();
    }
  });
});

it('keeps state polling separate from interview control requests', async () => {
  const limitedApi = await createApi(service, readEnvironment({ DATABASE_URL: databaseUrl.href }));
  try {
    const login = await limitedApi.inject({ method: 'POST', url: '/api/session' });
    const headers = {
      cookie: login.cookies.map((item) => `${item.name}=${item.value}`).join('; '),
    };
    for (let index = 0; index < 120; index += 1) {
      expect((await limitedApi.inject({ url: '/api/state', headers })).statusCode).toBe(200);
    }
    expect((await limitedApi.inject({ url: '/api/state', headers })).statusCode).toBe(429);
    expect(
      (
        await limitedApi.inject({
          method: 'POST',
          url: '/api/avatar/sessions',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(503);
  } finally {
    await limitedApi.close();
  }
});

it('atomically evaluates a saved transcript, fences stale workers, and preserves a written retry', async () => {
  const { createEmptyPracticeContext } = await import('../src/contracts/PracticeContext.js');
  const { evaluationResponseSchema } = await import('../src/contracts/RehearsalEvaluation.js');
  const evaluator = fixtureEvaluationProvider;
  const coached = new WorkspaceService(store, new ResearchFixture(), evaluator);
  const initial = await coached.read();
  const snapshot = initial.snapshots.find((s) => s.fileName === 'Tidewell.csv');
  if (!snapshot) throw new Error('Missing fictional fixture');
  await coached.selectOnboardingFinancials(snapshot.id);
  const brief = initial.briefs.at(-1);
  if (!brief) throw new Error('Missing fixture brief');
  const session = await coached.createRehearsal(
    brief.id,
    'text',
    null,
    createEmptyPracticeContext(),
  );
  await coached.answer(session.id, 'Our operating income is 122503 unspecified for 2026-07.');
  await Promise.all([
    coached.finishRehearsal(session.id, [], true),
    coached.finishRehearsal(session.id, [], true),
  ]);
  const pending = (await coached.read()).rehearsals.find((s) => s.id === session.id);
  const evaluation = pending?.evaluations[0];
  if (!evaluation) throw new Error('Evaluation was not scheduled');
  expect(pending.evaluations).toHaveLength(1);
  const persisted = new PrismaStore(databaseUrl.href);
  try {
    expect(
      (await persisted.load())?.rehearsals.find((s) => s.id === session.id)?.evaluations[0]?.id,
    ).toBe(evaluation.id);
    expect(
      (await persisted.listJobs()).some(
        (j) => j.kind === `evaluate:${session.id}:${evaluation.id}`,
      ),
    ).toBe(true);
  } finally {
    await persisted.close();
  }
  // Editing company context after the call must not change the frozen review inputs.
  await coached.change((state) => {
    state.profile.goal = 'Changed after practice';
  });
  expect(
    (await coached.read()).rehearsals.find((s) => s.id === session.id)?.evaluationContext,
  ).toEqual(session.evaluationContext);
  let claimed = await store.claimJob(new Date());
  for (
    let attempt = 0;
    claimed && claimed.kind !== `evaluate:${session.id}:${evaluation.id}` && attempt < 100;
    attempt++
  ) {
    await store.finishJob(claimed, 'Unrelated test job drained.');
    claimed = await store.claimJob(new Date());
  }
  if (!claimed || claimed.kind !== `evaluate:${session.id}:${evaluation.id}`)
    throw new Error('Expected evaluation job');
  await expect(
    coached.evaluations.run(session.id, evaluation.id, { ...claimed, leaseToken: 'expired-token' }),
  ).rejects.toThrow('lease expired');
  expect(
    (await coached.read()).rehearsals.find((s) => s.id === session.id)?.evaluations[0]?.report,
  ).toBeNull();
  await coached.evaluations.run(session.id, evaluation.id, claimed);
  const completed = (await coached.read()).rehearsals.find((s) => s.id === session.id)
    ?.evaluations[0];
  expect(completed?.status).toBe('completed');
  expect(completed?.report?.checks[0]?.support).toBe('contradicted');
  expect((await store.listJobs()).find((j) => j.id === claimed.id)?.status).toBe('succeeded');
  const item = completed?.report?.coaching.items[0];
  if (!item) throw new Error('Missing coaching item');
  const reviewApi = await createApi(coached, readEnvironment({ DATABASE_URL: databaseUrl.href }));
  try {
    expect((await reviewApi.inject({ url: '/api/followups' })).statusCode).toBe(401);
    const evidencePath = `/api/rehearsals/${session.id}/evaluations/${evaluation.id}/evidence`;
    expect((await reviewApi.inject({ url: evidencePath })).statusCode).toBe(401);
    expect(
      (await reviewApi.inject({ url: `/api/rehearsals/${session.id}/evaluations` })).statusCode,
    ).toBe(401);
    const login = await reviewApi.inject({ method: 'POST', url: '/api/session' });
    const headers = { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
    const followups = await reviewApi.inject({ url: '/api/followups?limit=20', headers });
    expect(followups.statusCode).toBe(200);
    expect(followups.headers['cache-control']).toBe('private, no-store');
    expect(
      followupsResponseSchema.parse(followups.json()).sessions.find((s) => s.id === session.id)
        ?.tasks[0],
    ).toMatchObject({
      id: item.id,
      status: 'open',
      title: item.suggestion,
      steps: item.analysis?.preparationSteps,
    });
    expect((await reviewApi.inject({ url: '/api/followups?limit=21', headers })).statusCode).toBe(
      400,
    );
    expect(
      (
        await reviewApi.inject({
          url: '/api/followups',
          headers: { ...headers, origin: 'https://other.example' },
        })
      ).statusCode,
    ).toBe(403);
    const evidenceResponse = await reviewApi.inject({ url: evidencePath, headers });
    expect(evidenceResponse.statusCode).toBe(200);
    expect(evidenceResponse.headers['cache-control']).toBe('private, no-store');
    const evidenceView = evidenceReviewSchema.parse(evidenceResponse.json());
    expect(evidenceView.state).toBe('completed');
    expect(evidenceView.evaluationId).toBe(evaluation.id);
    expect(evidenceView.claimLinks[0]?.support).toBe('contradicted');
    expect(
      evidenceView.grids[0]?.cells.some(
        (cell) => cell.sourceLocator.columnKey === 'operating_income',
      ),
    ).toBe(true);
    expect(
      (
        await reviewApi.inject({
          url: `/api/rehearsals/${randomUUID()}/evaluations/${evaluation.id}/evidence`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await reviewApi.inject({
          url: `/api/rehearsals/${session.id}/evaluations/${randomUUID()}/evidence`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const reviewed = await reviewApi.inject({
      url: `/api/rehearsals/${session.id}/evaluations`,
      headers,
    });
    expect(evaluationResponseSchema.parse(reviewed.json()).evaluations[0]?.status).toBe(
      'completed',
    );
    const body = {
      itemId: item.id,
      kind: 'practice',
      text: 'Our operating income is -59797 unspecified for 2026-07.',
      requestKey: randomUUID(),
    };
    const path = `/api/rehearsals/${session.id}/evaluations/${evaluation.id}/responses`;
    const [first, duplicate] = await Promise.all([
      reviewApi.inject({ method: 'POST', url: path, headers, payload: body }),
      reviewApi.inject({ method: 'POST', url: path, headers, payload: body }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(first.json());
    const after = await coached.read();
    expect(after.rehearsals.find((s) => s.id === session.id)?.evaluationResponses).toHaveLength(1);
    const retry = after.rehearsals.find((s) =>
      s.evaluations.some((e) => e.parentEvaluationId === evaluation.id),
    );
    expect(retry?.mode).toBe('text');
    const childEvaluation = retry?.evaluations[0];
    if (!retry || !childEvaluation) throw new Error('Missing written retry');
    const childJob = await store.claimJob(new Date());
    if (!childJob) throw new Error('Missing retry job');
    await coached.evaluations.run(retry.id, childEvaluation.id, childJob);
    const result = (await coached.read()).rehearsals.find((s) => s.id === retry.id)?.evaluations[0];
    expect(result?.report?.checks[0]?.support).toBe('supported');
    expect(result?.report?.coaching.items).toHaveLength(0);
    expect(completed.report?.coaching.items[0]?.analysis?.preparationSteps).toHaveLength(3);
    expect(result?.report?.coaching.strengths?.[0]?.significance).toContain('factual accuracy');
    expect(result?.report?.coaching.strengths?.[0]?.statement).toBe(
      'You accurately stated the saved operating result.',
    );
    expect(result?.report?.coaching.strengths?.[0]?.turnIds).toEqual([
      result?.turns.find((turn) => turn.role === 'user')?.id,
    ]);
    expect(result?.report?.coaching.comparison?.outcome).toBe('not_comparable');
    const updatedFollowups = followupsResponseSchema.parse(
      (await reviewApi.inject({ url: '/api/followups?limit=20', headers })).json(),
    );
    expect(updatedFollowups.sessions.find((s) => s.id === session.id)?.tasks[0]).toMatchObject({
      status: 'not_comparable',
      retrySessionId: retry.id,
    });
    expect(updatedFollowups.sessions.some((s) => s.id === retry.id)).toBe(false);
    expect(
      (await coached.read()).rehearsals.find((s) => s.id === session.id)?.evaluations[0],
    ).toEqual(completed);
  } finally {
    await reviewApi.close();
  }
});

describe('durable investor suggestions', () => {
  it('deduplicates discovery jobs and persists explicit Track and Dismiss decisions', async () => {
    await service.change((workspace) => {
      workspace.profile.stage = 'Seed';
      workspace.profile.sector = 'B2B software';
      workspace.profile.geography = 'Canada';
      workspace.profile.version++;
    });
    const headers = { cookie: sessionCookie, origin: 'http://127.0.0.1:4317' };
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/investors/discover',
          headers,
          payload: { key: randomUUID() },
        }),
      ),
    );
    expect(responses.every((response) => response.statusCode === 202)).toBe(true);
    expect(new Set(responses.map((response) => jobSchema.parse(response.json()).id)).size).toBe(1);
    const before = (await service.read()).investors.length;
    await runWorkerTick(service);
    const suggestions = (await service.read()).discovery.suggestions;
    expect(suggestions).toHaveLength(3);
    expect((await service.read()).investors).toHaveLength(before);
    const [track, dismiss] = suggestions;
    if (!track || !dismiss) {
      throw new Error('Missing suggestions');
    }
    for (const [suggestion, decision] of [
      [track, 'tracked'],
      [dismiss, 'dismissed'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/investors/suggestions/${suggestion.id}/decision`,
        headers,
        payload: { decision },
      });
      expect(response.statusCode).toBe(200);
    }
    const fresh = new PrismaStore(databaseUrl.href);
    try {
      const saved = await fresh.load();
      expect(saved?.investors).toHaveLength(before + 1);
      expect(saved?.discovery.suggestions.find((item) => item.id === dismiss.id)?.status).toBe(
        'dismissed',
      );
      expect(saved?.investors.find((item) => item.name === track.name)?.frequency).toBe('daily');
    } finally {
      await fresh.close();
    }
  });
});

describe('research archive API', () => {
  it('persists raw imports, enforces sessions, and exposes immutable paged records', async () => {
    const snapshot = await service.read();
    const body = importResearchRunSchema.parse({
      id: randomUUID(),
      kind: 'investor',
      investorId: null,
      input: {
        profileVersion: snapshot.profile.version,
        segment: {
          stage: snapshot.profile.stage,
          sector: snapshot.profile.sector,
          geography: snapshot.profile.geography,
        },
        target: { name: 'Example investor', url: 'https://example.com/person', profileLinks: [] },
        discovery: null,
      },
      searches: [
        {
          query: 'Example investor',
          retrievedAt: '2026-10-17T00:00:00Z',
          sources: [
            {
              title: 'Public profile',
              url: 'https://example.com/person',
              text: 'Unverified public source text.',
            },
          ],
        },
      ],
      startedAt: '2026-10-17T00:00:00Z',
      finishedAt: '2026-10-17T00:00:01Z',
    });
    const headers = { cookie: sessionCookie };
    expect(
      (await app.inject({ method: 'POST', url: '/api/research-runs', payload: body })).statusCode,
    ).toBe(401);
    const created = await app.inject({
      method: 'POST',
      url: '/api/research-runs',
      headers,
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(researchRunSchema.parse(created.json())).toMatchObject({
      origin: 'import',
      status: 'source_only',
      evidence: [],
      jobId: null,
    });
    expect(
      (await app.inject({ method: 'POST', url: '/api/research-runs', headers, payload: body }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/research-runs',
          headers,
          payload: { ...body, kind: 'discovery' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/research-runs',
          headers,
          payload: { ...body, evidence: [] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/research-runs',
          headers,
          payload: { ...body, id: randomUUID(), investorId: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    const secondId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/research-runs',
      headers,
      payload: { ...body, id: secondId },
    });
    const listed = await app.inject({ url: '/api/research-runs?kind=investor&limit=1', headers });
    expect(listed.statusCode).toBe(200);
    const first = researchRunListSchema.parse(listed.json());
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.sourceCount).toBe(1);
    expect(first.nextOffset).toBe(1);
    expect(listed.body).not.toContain('Unverified public source text.');
    const second = researchRunListSchema.parse(
      (
        await app.inject({ url: '/api/research-runs?kind=investor&limit=1&offset=1', headers })
      ).json(),
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect((await app.inject({ url: '/api/research-runs?limit=1000', headers })).statusCode).toBe(
      400,
    );
    const detail = await app.inject({ url: `/api/research-runs/${body.id}`, headers });
    expect(researchRunSchema.parse(detail.json()).searches).toEqual(body.searches);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect(
      (await app.inject({ url: `/api/research-runs/${randomUUID()}`, headers })).statusCode,
    ).toBe(404);
    const reopened = new PrismaStore(databaseUrl.href);
    try {
      expect((await reopened.findResearchRun(body.id))?.searches).toEqual(body.searches);
    } finally {
      await reopened.close();
    }
  });
});

describe('automatic research archiving', () => {
  it('saves investor and discovery workflow outputs in PostgreSQL with job correlation', async () => {
    const research = new LiveResearch('test-exa', 'test-model', 'test-model', undefined, store);
    const recording = new WorkspaceService(
      store,
      research,
      fixtureEvaluationProvider,
      undefined,
      store,
    );
    const current = await recording.read();
    await recording.updateProfile({
      ...current.profile,
      stage: 'Seed',
      sector: 'B2B software',
      geography: 'Canada',
    });
    const target = await recording.investors.add({
      name: 'Archive Test',
      url: 'https://example.com/archive-test',
      frequency: 'paused',
    });
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ results: [] })));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await recording.investors.check(target.id, 'archive-check', 2);
      await recording.investors.discover('archive-discovery', 1);
      const checked = await store.listResearchRuns({
        investorId: target.id,
        jobId: 'archive-check',
        limit: 20,
        offset: 0,
      });
      expect(checked.items).toHaveLength(1);
      expect(checked.items[0]).toMatchObject({ kind: 'investor', status: 'succeeded', attempt: 2 });
      const discovered = await store.listResearchRuns({
        kind: 'discovery',
        jobId: 'archive-discovery',
        limit: 20,
        offset: 0,
      });
      expect(discovered.items).toHaveLength(1);
      const id = discovered.items[0]?.id;
      if (!id) {
        throw new Error('Archive missing');
      }
      const archive = await store.findResearchRun(id);
      expect(archive?.searches).toHaveLength(1);
      expect(archive?.searches[0]?.query).not.toContain('Archive Test');
      await recording.investors.check(target.id, 'archive-check', 2);
      expect(
        (await store.listResearchRuns({ jobId: 'archive-check', limit: 20, offset: 0 })).items,
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('radar and email persistence', () => {
  it('commits events and outbox atomically, protects confirmation secrets, and survives service restarts', async () => {
    const evidence = radarEvidence();
    const producer = new WorkspaceService(
      store,
      { discover: () => Promise.resolve([evidence]) },
      fixtureEvaluationProvider,
      undefined,
      store,
    );
    const send = vi.fn<EmailSender['send']>().mockResolvedValue('fake-resend-receipt');
    producer.radar.configure({ send }, 'alerts@example.com', 'http://127.0.0.1:4317');
    const radarApi = await createApi(producer, readEnvironment({ DATABASE_URL: databaseUrl.href }));
    try {
      const login = await radarApi.inject({ method: 'POST', url: '/api/session' });
      const headers = {
        cookie: login.cookies.map((item) => `${item.name}=${item.value}`).join('; '),
      };
      expect((await radarApi.inject({ url: '/api/radar/events' })).statusCode).toBe(401);
      expect(
        (
          await radarApi.inject({
            method: 'PUT',
            url: '/api/notification-preferences',
            headers: { ...headers, origin: 'https://example.com' },
            payload: { enabled: true, categories: [] },
          })
        ).statusCode,
      ).toBe(403);
      const confirmation = await radarApi.inject({
        method: 'POST',
        url: '/api/notification-preferences/confirmations',
        headers,
        payload: { recipient: 'founder@example.com' },
      });
      expect(confirmation.statusCode).toBe(200);
      await producer.radar.deliverOne();
      const code = send.mock.calls[0]?.[0].text.match(/\b\d{6}\b/)?.[0];
      expect(code).toBeDefined();
      const publicState = await radarApi.inject({ url: '/api/state', headers });
      expect(publicState.body).not.toContain(code ?? 'MISSING_CODE');
      expect(publicState.body).not.toContain('founder@example.com');
      const confirmed = await radarApi.inject({
        method: 'POST',
        url: '/api/notification-preferences/confirm',
        headers,
        payload: { code },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(
        (
          await radarApi.inject({
            method: 'PUT',
            url: '/api/notification-preferences',
            headers,
            payload: { enabled: true, categories: ['investment'] },
          })
        ).statusCode,
      ).toBe(200);
      const investor = await producer.investors.add({
        name: 'Fictional Northline',
        url: 'https://example.com/radar-integration',
        frequency: 'paused',
      });
      const before = await producer.read();
      const failedSave = vi
        .spyOn(store, 'save')
        .mockRejectedValueOnce(new Error('simulated transaction failure'));
      await expect(producer.investors.check(investor.id, 'radar-rollback')).rejects.toThrow();
      failedSave.mockRestore();
      expect((await producer.read()).radar.events).toEqual(before.radar.events);
      await producer.investors.check(investor.id, 'radar-commit');
      await producer.investors.check(investor.id, 'radar-commit');
      const freshStore = new PrismaStore(databaseUrl.href);
      try {
        const restored = await freshStore.load();
        const event = restored?.radar.events.find((item) => item.jobId === 'radar-commit');
        expect(event).toBeDefined();
        expect(
          restored?.radar.deliveries.filter((item) => item.eventId === event?.id),
        ).toHaveLength(1);
        const resumed = new WorkspaceService(
          freshStore,
          new ResearchFixture(),
          fixtureEvaluationProvider,
        );
        resumed.radar.configure({ send }, 'alerts@example.com', 'http://127.0.0.1:4317');
        send.mockClear();
        await Promise.all([producer.radar.deliverOne(), resumed.radar.deliverOne()]);
        expect(send).toHaveBeenCalledTimes(1);
        expect(
          (await freshStore.load())?.radar.deliveries.find((item) => item.eventId === event?.id)
            ?.status,
        ).toBe('sent');
        const feed = await radarApi.inject({
          url: `/api/radar/events?investorId=${investor.id}`,
          headers,
        });
        expect(feed.statusCode).toBe(200);
        expect(feed.body).toContain('Fictional Northline');
        expect(feed.body).not.toContain('founder@example.com');
        expect(
          (
            await radarApi.inject({
              method: 'PATCH',
              url: `/api/radar/events/${event?.id ?? ''}/read`,
              headers,
              payload: { read: true },
            })
          ).statusCode,
        ).toBe(200);
        expect((await resumed.radar.event(event?.id ?? ''))?.readAt).not.toBeNull();
        await producer.radar.heartbeat('checking', 'radar-job');
        expect((await resumed.radar.status()).state).toBe('checking');
      } finally {
        await freshStore.close();
      }
    } finally {
      await radarApi.close();
    }
  });
});

describe('guided question and Why workflow', () => {
  async function prepareGuided() {
    await drainWorker(service);
    const snapshotId = await service.upload(
      readFileSync('fixtures/Tidewell.csv', 'utf8'),
      'GuidedDemo.csv',
      'unspecified',
    );
    await service.selectOnboardingFinancials(snapshotId);
    const investor = await service.investors.add({
      name: 'Fictional guided investor',
      url: 'https://example.com/guided',
      frequency: 'paused',
    });
    await drainWorker(service);
    if (!service.scenarios) throw new Error('Scenario runtime missing.');
    const generation = await service.scenarios.create(
      investor.id,
      'Explain operating performance',
      randomUUID(),
    );
    await drainWorker(service);
    const ready = await service.scenarios.get(generation.id);
    const scenario = ready.output?.scenarios.find(
      (item) => item.id === 'explain-financial-evidence',
    );
    if (!scenario) throw new Error('Expected financial scenario');
    return { generationId: ready.id, scenarioId: scenario.id, requestKey: randomUUID() };
  }
  it('persists question/Why together, safely replays answers, preserves sources, and evaluates the finished text transcript', async () => {
    const payload = await prepareGuided();
    const headers = { cookie: sessionCookie };
    expect(
      (await app.inject({ method: 'POST', url: '/api/guided-practice/sessions', payload }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/guided-practice/sessions',
          headers: { ...headers, origin: 'https://foreign.example' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const starts = await Promise.all(
      [1, 2].map(() =>
        app.inject({ method: 'POST', url: '/api/guided-practice/sessions', headers, payload }),
      ),
    );
    const view = guidedViewSchema.parse(starts[0]?.json());
    expect(guidedViewSchema.parse(starts[1]?.json()).id).toBe(view.id);
    expect(view.guided.turns[0]?.why.sourceIds.length).toBeGreaterThan(0);
    const base = `/api/guided-practice/sessions/${view.id}`;
    const answer = {
      questionId: view.guided.turns[0]?.id,
      text: 'Our operating income is 122503 unspecified for 2026-07.',
      expectedRevision: view.guided.revision,
      requestKey: randomUUID(),
    };
    const response = await app.inject({
      method: 'POST',
      url: base + '/answers',
      headers,
      payload: answer,
    });
    expect(response.statusCode).toBe(202);
    const pending = guidedViewSchema.parse(response.json());
    expect(pending.guided.turns).toHaveLength(1);
    expect(pending.guided.answers).toHaveLength(1);
    const queued = (await store.listJobs()).filter((job) =>
      job.kind.startsWith(`guided-turn:${view.id}:`),
    );
    expect(queued).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: base + '/answers',
          headers,
          payload: { ...answer, text: 'changed' },
        })
      ).statusCode,
    ).toBe(409);
    await drainWorker(service);
    const next = guidedViewSchema.parse((await app.inject({ url: base, headers })).json());
    expect(next.guided.turns).toHaveLength(2);
    expect(next.guided.turns[1]?.decision).toBe('correct');
    expect(next.guided.turns[1]?.reply).toContain('-59797');
    expect(next.guided.turns[1]?.why.brief).toBeTruthy();
    expect(next.guided.pending).toBeNull();
    expect(
      (await app.inject({ method: 'POST', url: base + '/answers', headers, payload: answer }))
        .statusCode,
    ).toBe(202);
    expect((await service.guided.get(view.id)).guided.answers).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: base + '/answers',
          headers,
          payload: { ...answer, requestKey: randomUUID() },
        })
      ).statusCode,
    ).toBe(409);
    await expect(service.finishRehearsal(view.id, [], true)).rejects.toThrow('guided');
    const reopened = new PrismaStore(databaseUrl.href);
    try {
      expect(
        (await reopened.load())?.rehearsals.find((session) => session.id === view.id)?.guided
          ?.turns,
      ).toEqual(next.guided.turns);
    } finally {
      await reopened.close();
    }
    const snapshot = JSON.stringify(next.context);
    await service.change((workspace) => {
      workspace.profile.goal = 'New unrelated goal';
      workspace.profile.version += 1;
    });
    expect(JSON.stringify((await service.guided.get(view.id)).context)).toBe(snapshot);
    const finished = await app.inject({
      method: 'POST',
      url: base + '/finish',
      headers,
      payload: { expectedRevision: next.guided.revision },
    });
    expect(finished.statusCode).toBe(200);
    await drainWorker(service);
    const session = (await service.read()).rehearsals.find((item) => item.id === view.id);
    expect(session?.status).toBe('completed');
    expect(session?.evaluations[0]?.status).toBe('completed');
    expect(session?.turns.map((turn) => turn.role)).toEqual(['agent', 'user', 'agent']);
    expect(session?.guided?.turns).toEqual(next.guided.turns);
  });
  it('rejects an expired worker and does not publish a pending question after finishing', async () => {
    const payload = await prepareGuided();
    const id = await service.guided.start(payload);
    const first = await service.guided.get(id);
    const questionId = first.guided.turns[0]?.id;
    if (!questionId) throw new Error('Missing question');
    await service.guided.answer(id, {
      questionId,
      text: 'Our operating income is -59797 unspecified for 2026-07.',
      expectedRevision: 0,
      requestKey: randomUUID(),
    });
    const job = await store.claimJob(new Date());
    if (!job) throw new Error('Missing guided job');
    const answerId = (await service.guided.get(id)).guided.pending?.answerId;
    if (!answerId) throw new Error('Missing answer');
    const connection = new Client({ connectionString: databaseUrl.href });
    await connection.connect();
    try {
      await connection.query('UPDATE "WorkflowJob" SET "leaseUntil" = $1 WHERE id = $2', [
        new Date(0),
        job.id,
      ]);
    } finally {
      await connection.end();
    }
    const recovered = await store.claimJob(new Date());
    if (!recovered) throw new Error('Missing recovered job');
    await expect(service.guided.run(id, answerId, job)).rejects.toThrow('lease');
    expect((await service.guided.get(id)).guided.turns).toHaveLength(1);
    const pending = await service.guided.get(id);
    await service.guided.finish(id, pending.guided.revision);
    await service.guided.run(id, answerId, recovered);
    const ended = await service.guided.get(id);
    expect(ended.guided.turns).toHaveLength(1);
    expect(ended.guided.pending).toBeNull();
    const session = (await service.read()).rehearsals.find((item) => item.id === id);
    expect(session?.turns.map((turn) => turn.role)).toEqual(['agent', 'user']);
    await drainWorker(service);
  });
  it('rejects oversized answers before persistence and still evaluates the accepted transcript', async () => {
    const payload = await prepareGuided();
    const id = await service.guided.start(payload);
    let rejected = false;
    for (let index = 0; index < 24; index++) {
      const before = await service.guided.get(id);
      const questionId = before.guided.turns.at(-1)?.id;
      if (!questionId) throw new Error('Missing question');
      const input = {
        questionId,
        text: 'A'.repeat(3000),
        expectedRevision: before.guided.revision,
        requestKey: randomUUID(),
      };
      try {
        await service.guided.answer(id, input);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('size limit')) throw error;
        const after = await service.guided.get(id);
        expect(after.guided).toEqual(before.guided);
        expect(after.guided.pending).toBeNull();
        rejected = true;
        break;
      }
      await drainWorker(service);
    }
    expect(rejected).toBe(true);
    const beforeFinish = await service.guided.get(id);
    await service.guided.finish(id, beforeFinish.guided.revision);
    await drainWorker(service);
    const session = (await service.read()).rehearsals.find((item) => item.id === id);
    expect(session?.evaluations[0]?.status).toBe('completed');
    expect(session?.evaluations[0]?.reason).toBeNull();
  });
});

it('persists validated discovery preferences without modifying meeting context or starting research', async () => {
  const before = await service.read();
  const jobsBefore = await store.listJobs();
  const preferences = {
    types: ['Angel', 'Accelerator'],
    firmSize: 'Medium',
    referenceFirms: ['YC', 'a16z'],
    priorities: 'Hands-on B2B experience',
  };
  const response = await app.inject({
    method: 'PUT',
    url: '/api/investors/discovery/preferences',
    headers: { cookie: sessionCookie },
    payload: preferences,
  });
  expect(response.statusCode).toBe(200);
  const current = (await state()).workspace;
  expect(current.profile.investorPreferences).toEqual(preferences);
  expect(current.profile.version).toBe(before.profile.version + 1);
  expect(current.onboarding.meeting).toEqual(before.onboarding.meeting);
  expect(current.investors).toEqual(before.investors);
  expect(await store.listJobs()).toEqual(jobsBefore);
  const invalid = await app.inject({
    method: 'PUT',
    url: '/api/investors/discovery/preferences',
    headers: { cookie: sessionCookie },
    payload: { types: ['unknown'] },
  });
  expect(invalid.statusCode).toBe(400);
  expect((await service.read()).profile.investorPreferences).toEqual(preferences);
});

describe('live guidance access boundary', () => {
  it('requires the local session and allowed origin before attempting guidance', async () => {
    const url = `/api/rehearsals/${randomUUID()}/live-guidance`;
    const payload = { turns: [{ role: 'agent', text: 'Explain your business.' }] };
    const unauthenticated = await app.inject({ method: 'POST', url, payload });
    expect(unauthenticated.statusCode).toBe(401);
    const crossOrigin = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { cookie: sessionCookie, origin: 'https://untrusted.example' },
    });
    expect(crossOrigin.statusCode).toBe(403);
    const unavailable = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { cookie: sessionCookie },
    });
    expect(unavailable.statusCode).toBe(503);
  });
});

describe('peer comparison evidence lifecycle', () => {
  it('enforces access, persists revisions, and freezes relevant peer insights with the call', async () => {
    const { peerDashboardSchema } = await import('../src/contracts/PeerComparison.js');
    const { createEmptyPracticeContext } = await import('../src/contracts/PracticeContext.js');
    const { importFinancials } = await import('../src/features/Financials.js');
    const original = await service.read();
    const snapshot = importFinancials(
      readFileSync('fixtures/Tidewell.csv', 'utf8'),
      'FictionalPeerTest.csv',
      'CAD',
    );
    await service.change((state) => {
      if (!state.snapshots.some((item) => item.id === snapshot.id)) state.snapshots.push(snapshot);
      // Content deduplication might already have saved a snapshot with this hash.
      state.onboarding.snapshotId =
        state.snapshots.find((item) => item.hash === snapshot.hash)?.id ?? snapshot.id;
    });
    const payload = {
      peerId: randomUUID(),
      expectedVersion: 0,
      name: 'Fictional peer',
      stage: 'Seed',
      customer: 'Software teams',
      businessModel: 'Subscription',
      rationale: 'Similar customer and business model; founder-selected.',
      currency: 'CAD',
      sourceUrl: 'https://example.com/fictional-disclosure',
      excerpt: 'Fictional monthly statement evidence.',
      publishedAt: '2026-10-01',
      fictional: true,
      periods: [
        { month: '2026-08', revenue: '100000', grossProfit: '60000', operatingIncome: '-30000' },
        { month: '2026-09', revenue: '110000', grossProfit: '66000', operatingIncome: '-22000' },
      ],
    };
    try {
      expect((await app.inject({ method: 'GET', url: '/api/peers' })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/peers',
            payload,
            headers: { cookie: sessionCookie, origin: 'https://untrusted.example' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/peers',
            payload: { ...payload, sourceUrl: 'javascript:alert(1)' },
            headers: { cookie: sessionCookie },
          })
        ).statusCode,
      ).toBe(400);
      const added = await app.inject({
        method: 'POST',
        url: '/api/peers',
        payload,
        headers: { cookie: sessionCookie },
      });
      expect(added.statusCode).toBe(200);
      const read = await app.inject({
        method: 'GET',
        url: '/api/peers',
        headers: { cookie: sessionCookie },
      });
      expect(read.headers['cache-control']).toBe('private, no-store');
      const dashboard = peerDashboardSchema.parse(read.json());
      expect(
        dashboard.comparison.metrics[2]?.peers.some((item) => item.peer.peerId === payload.peerId),
      ).toBe(true);
      const call = await service.createRehearsal(
        null,
        'elevenlabs',
        randomUUID(),
        createEmptyPracticeContext(),
      );
      const captured = (await service.read()).rehearsals.find((item) => item.id === call.id)
        ?.evaluationContext?.peerComparison;
      expect(captured?.metrics[2]?.peers.some((item) => item.peer.peerId === payload.peerId)).toBe(
        true,
      );
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/peers',
            payload: { ...payload, expectedVersion: 1, name: 'Fictional peer revised' },
            headers: { cookie: sessionCookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/peers',
            payload,
            headers: { cookie: sessionCookie },
          })
        ).statusCode,
      ).toBe(409);
      const archive = await app.inject({
        method: 'POST',
        url: `/api/peers/${payload.peerId}/archive`,
        payload: { expectedVersion: 2 },
        headers: { cookie: sessionCookie },
      });
      expect(archive.statusCode).toBe(200);
      const after = await service.read();
      expect(after.peers?.filter((item) => item.peerId === payload.peerId)).toHaveLength(3);
      expect(
        after.rehearsals.find((item) => item.id === call.id)?.evaluationContext?.peerComparison,
      ).toEqual(captured);
      await service.finishRehearsal(
        call.id,
        [
          { role: 'agent', text: 'Explain the operating result.' },
          { role: 'user', text: 'Our operating income is -48531 CAD for 2026-09.' },
        ],
        true,
        true,
      );
      const evaluation = (await service.read()).rehearsals.find((item) => item.id === call.id)
        ?.evaluations[0];
      if (!evaluation) throw new Error('Missing peer evaluation');
      let job = await store.claimJob(new Date());
      for (
        let index = 0;
        job && index < 100 && job.kind !== `evaluate:${call.id}:${evaluation.id}`;
        index++
      ) {
        await store.finishJob(job, 'Unrelated test job drained.');
        job = await store.claimJob(new Date());
      }
      if (!job || job.kind !== `evaluate:${call.id}:${evaluation.id}`)
        throw new Error('Missing evaluation job');
      await service.evaluations.run(call.id, evaluation.id, job);
      const review = await service.evaluations.get(call.id);
      expect(review.evaluations[0]?.report?.peerInsights?.[0]?.comparison.metric).toBe(
        'operating_margin',
      );
      expect(
        review.evaluations[0]?.report?.peerInsights?.[0]?.comparison.peers.some(
          (item) => item.peer.name === 'Fictional peer',
        ),
      ).toBe(true);
    } finally {
      await service.change((state) => {
        state.onboarding.snapshotId = original.onboarding.snapshotId;
      });
    }
  });
});
