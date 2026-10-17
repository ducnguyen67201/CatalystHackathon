import { vi } from 'vitest';
import { LiveResearch } from '../src/infrastructure/Research.js';
import {
  importResearchRunSchema,
  researchRunSchema,
  researchRunListSchema,
} from '../src/contracts/ResearchRun.js';
import { trackedInvestorSchema } from '../src/contracts/InvestorTracking.js';
import { loadEnvironmentValues } from '../src/server/LoadEnvironment.js';
import { randomUUID, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  stateResponseSchema,
  voiceResponseSchema,
  jobSchema,
  JobStatus,
} from '../src/contracts/Workspace.js';
import { PrismaStore } from '../src/infrastructure/PrismaStore.js';
import { ResearchFixture } from './fixtures/ResearchFixture.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import { readEnvironment } from '../src/server/Env.js';
import { createApi } from '../src/server/Api.js';
import { runWorkerTick } from '../src/server/Worker.js';
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
  service = new WorkspaceService(store, new ResearchFixture(), undefined, store);
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
async function state() {
  const response = await app.inject({ url: '/api/state', headers: { cookie: sessionCookie } });
  return stateResponseSchema.parse(response.json());
}
describe('PostgreSQL-backed application workflow', () => {
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
    const recording = new WorkspaceService(store, research, undefined, store);
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
      expect((await store.findResearchRun(id))?.searches).toHaveLength(2);
      await recording.investors.check(target.id, 'archive-check', 2);
      expect(
        (await store.listResearchRuns({ jobId: 'archive-check', limit: 20, offset: 0 })).items,
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
