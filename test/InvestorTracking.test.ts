import { fixtureEvaluationProvider } from './EvaluationFixtures.js';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { investorInputSchema, CheckFrequency } from '../src/contracts/InvestorTracking.js';
import { workspaceSchema, jobSchema, type Workspace } from '../src/contracts/Workspace.js';
import { parseInvestorUrl, nextInvestorCheck } from '../src/features/InvestorTrackingService.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import type { WorkspaceStore } from '../src/features/WorkspaceStore.js';
import type { ResearchProvider } from '../src/features/ResearchProvider.js';
import { DemoResearch, LiveResearch } from '../src/infrastructure/Research.js';

function createFixture(research: ResearchProvider = new DemoResearch()) {
  let state: Workspace | null = null;
  const enqueue = vi.fn<WorkspaceStore['enqueue']>((key, kind) =>
    Promise.resolve(
      jobSchema.parse({
        id: key,
        kind,
        status: 'queued',
        attempts: 0,
        createdAt: new Date().toISOString(),
        result: null,
        error: null,
      }),
    ),
  );
  const store: WorkspaceStore = {
    load: () => Promise.resolve(state ? workspaceSchema.parse(structuredClone(state)) : null),
    initialize: (value) => {
      state = workspaceSchema.parse(structuredClone(value));
      return Promise.resolve();
    },
    save: (value) => {
      state = workspaceSchema.parse(structuredClone(value));
      return Promise.resolve();
    },
    enqueue,
    listJobs: () => Promise.resolve([]),
    claimJob: () => Promise.resolve(null),
    finishJob: () => Promise.resolve(),
    failJob: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const service = new WorkspaceService(store, research, fixtureEvaluationProvider);
  return { service, enqueue };
}

async function initialize(service: WorkspaceService): Promise<void> {
  await service.initialize(readFileSync('fixtures/Tidewell.csv', 'utf8'));
}

describe('investor identity seeds', () => {
  it('canonicalizes social aliases and tracking parameters', () => {
    expect(parseInvestorUrl('https://www.twitter.com/Alex_VC/?utm_source=x#about')).toBe(
      'https://x.com/alex_vc',
    );
    expect(parseInvestorUrl('https://ca.linkedin.com/in/Alex/?trk=feed')).toBe(
      'https://linkedin.com/in/alex',
    );
  });

  it.each([
    'http://example.com',
    'https://user:secret@example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://example.local',
    'https://example.com:8080',
    'https://x.com/alex/status/123',
    'https://x.com/search?q=investors',
    'https://linkedin.com/feed',
  ])('rejects inappropriate seed %s', (url) => {
    expect(() => parseInvestorUrl(url)).toThrow('Investor URL');
  });
});

describe('watchlist loop', () => {
  it('deduplicates pasted profiles and does not fabricate demo facts about real people', async () => {
    const { service } = createFixture();
    await initialize(service);
    const target = await service.investors.add(
      investorInputSchema.parse({ url: 'https://x.com/alex' }),
    );
    const duplicate = await service.investors.add(
      investorInputSchema.parse({ url: 'https://twitter.com/Alex?ref=test' }),
    );
    expect(duplicate.id).toBe(target.id);
    await service.investors.check(target.id, 'job-one');
    const check = (await service.read()).investors[0]?.checks[0];
    expect(check?.evidenceIds).toEqual([]);
    expect(check?.note).toContain('No supported public evidence');
  });

  it('discovers once, schedules each candidate, and pauses future scheduling', async () => {
    const { service, enqueue } = createFixture();
    await initialize(service);
    await service.investors.discover();
    await service.investors.discover();
    const target = (await service.read()).investors[0];
    if (!target) {
      throw new Error('Missing target');
    }
    expect((await service.read()).investors).toHaveLength(1);
    await service.investors.tick(new Date());
    await service.investors.tick(new Date());
    expect(enqueue).toHaveBeenCalledTimes(1);
    await service.investors.setFrequency(target.id, CheckFrequency.PAUSED);
    await service.investors.tick(new Date(Date.now() + 10 * 86400000));
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(nextInvestorCheck(CheckFrequency.WEEKLY, new Date('2026-10-16T00:00:00Z'))).toBe(
      '2026-10-23T00:00:00.000Z',
    );
  });

  it('preserves source history, records no-change checks, and makes job replay idempotent', async () => {
    const discover = vi.fn<ResearchProvider['discover']>();
    const { service } = createFixture({ discover });
    await initialize(service);
    const target = await service.investors.add(
      investorInputSchema.parse({ name: 'Northline Ventures', url: 'https://example.com' }),
    );
    const original = (await new DemoResearch().discover((await service.read()).profile))[0];
    if (!original) {
      throw new Error('Missing evidence');
    }
    const first = { ...original, id: 'v1', eventKey: 'v1', url: 'https://example.com/news' };
    discover.mockResolvedValue([first]);
    await service.investors.check(target.id, 'job-one');
    await service.investors.check(target.id, 'job-one');
    expect(discover).toHaveBeenCalledTimes(1);
    await service.investors.check(target.id, 'job-two');
    expect((await service.read()).notices).toHaveLength(1);
    discover.mockResolvedValue([
      { ...first, id: 'v2', eventKey: 'v2', excerpt: 'Updated source passage.' },
    ]);
    await service.investors.check(target.id, 'job-three');
    const state = await service.read();
    expect(state.evidence).toHaveLength(2);
    expect(state.investors[0]?.checks.at(-1)?.changedIds).toEqual(['v2']);
    expect(state.investors[0]?.checks[1]?.addedIds).toEqual([]);
    expect(state.investors[0]?.checks).toHaveLength(3);
  });

  it('does not save results after the tracked identity changes mid-check', async () => {
    const discover = vi.fn<ResearchProvider['discover']>();
    const { service } = createFixture({ discover });
    await initialize(service);
    const target = await service.investors.add(
      investorInputSchema.parse({ url: 'https://example.com' }),
    );
    discover.mockImplementation(async () => {
      await service.investors.rename(target.id, 'Different investor');
      return [];
    });
    await expect(service.investors.check(target.id, 'identity-changed')).rejects.toThrow(
      'Investor identity changed',
    );
    expect((await service.read()).investors[0]?.checks).toHaveLength(0);
  });

  it('rejects findings computed against an obsolete company profile', async () => {
    const discover = vi.fn<ResearchProvider['discover']>();
    const { service } = createFixture({ discover });
    await initialize(service);
    const target = await service.investors.add(
      investorInputSchema.parse({ url: 'https://example.com' }),
    );
    discover.mockImplementation(async () => {
      await service.change((state) => {
        state.profile.version++;
      });
      return [];
    });
    await expect(service.investors.check(target.id, 'stale-job')).rejects.toThrow(
      'Profile changed',
    );
    expect((await service.read()).investors[0]?.checks).toHaveLength(0);
  });
});

it('live research uses public identity hints, rejects unrelated claims, and versions changed source text', async () => {
  const { service } = createFixture();
  await initialize(service);
  const profile = (await service.read()).profile;
  const target = { name: 'Alex', url: 'https://x.com/alex' };
  const research = new LiveResearch('test-exa', 'test-model', 'gpt-6.1-sol');
  let sourceText = 'Alex invests in seed software. First version.';
  let matchesTarget = true;
  const requests: string[] = [];
  const fetchMock = vi.fn<typeof fetch>((_input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    requests.push(body);
    return Promise.resolve(
      body.includes('numResults')
        ? Response.json({
            results: [
              { title: 'Investor profile', url: 'https://example.com/profile', text: sourceText },
            ],
          })
        : Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    investor: 'Alex',
                    matchesTarget,
                    stage: 'Seed',
                    sector: null,
                    geography: null,
                    checkMin: null,
                    checkMax: null,
                    currency: 'unspecified',
                    quote: 'Alex invests in seed software.',
                    explanation: 'Public profile.',
                  }),
                },
              },
            ],
          }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const one = await research.discover(profile, target);
    const repeat = await research.discover(profile, target);
    expect(one[0]?.eventKey).toBe(repeat[0]?.eventKey);
    sourceText = 'Alex invests in seed software. Updated version.';
    const changed = await research.discover(profile, target);
    expect(one[0]?.eventKey).not.toBe(changed[0]?.eventKey);
    matchesTarget = false;
    expect(await research.discover(profile, target)).toEqual([]);
    expect(requests[1]).toContain('"model":"gpt-6.1-sol"');
    expect(requests[1]).not.toContain('temperature');
    expect(requests.join('\n')).toContain(target.url);
    expect(requests.join('\n')).not.toContain(profile.goal);
    expect(requests.join('\n')).not.toContain('operatingIncome');
  } finally {
    vi.unstubAllGlobals();
  }
});
