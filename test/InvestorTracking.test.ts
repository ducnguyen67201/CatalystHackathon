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
  const service = new WorkspaceService(store, research);
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

  it('suggests without monitoring, tracks only selected candidates, and remembers dismissals', async () => {
    const { service, enqueue } = createFixture();
    await initialize(service);
    await service.investors.discover();
    const first = await service.read();
    expect(first.investors).toHaveLength(0);
    expect(first.discovery.suggestions).toHaveLength(3);
    await service.investors.tick(new Date());
    expect(enqueue).not.toHaveBeenCalled();
    const [chosen, dismissed] = first.discovery.suggestions;
    if (!chosen || !dismissed) {
      throw new Error('Missing suggestions');
    }
    await service.investors.discovery.decide(chosen.id, 'tracked');
    await service.investors.discovery.decide(chosen.id, 'tracked');
    await service.investors.discovery.decide(dismissed.id, 'dismissed');
    await service.investors.discover();
    const state = await service.read();
    expect(state.investors).toHaveLength(1);
    expect(state.discovery.suggestions.filter((item) => item.name === dismissed.name)).toHaveLength(
      1,
    );
    expect(state.discovery.suggestions.find((item) => item.id === dismissed.id)?.status).toBe(
      'dismissed',
    );
    await service.investors.tick(new Date());
    expect(enqueue).toHaveBeenCalledTimes(1);
    const target = state.investors[0];
    if (!target) {
      throw new Error('Missing tracked investor');
    }
    await service.investors.setFrequency(target.id, CheckFrequency.PAUSED);
    await service.investors.tick(new Date(Date.now() + 10 * 86400000));
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(nextInvestorCheck(CheckFrequency.WEEKLY, new Date('2026-10-16T00:00:00Z'))).toBe(
      '2026-10-23T00:00:00.000Z',
    );
  });

  it('refreshes discovery weekly and on profile changes, without requeuing each worker tick', async () => {
    const { service, enqueue } = createFixture();
    await initialize(service);
    const now = new Date();
    await service.investors.discovery.tick(now);
    expect(enqueue).not.toHaveBeenCalled();
    await service.change((state) => {
      state.profile.version++;
    });
    await service.investors.discovery.tick(now);
    await service.investors.discovery.tick(now);
    expect(enqueue).toHaveBeenCalledTimes(1);
    await service.investors.discovery.tick(new Date(now.getTime() + 8 * 86400000));
    expect(enqueue).toHaveBeenCalledTimes(2);
    await service.investors.discovery.setFrequency('paused');
    await service.change((state) => {
      state.profile.version++;
    });
    await service.investors.discovery.tick(new Date(now.getTime() + 16 * 86400000));
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('does not spend another discovery call on a full tray or replayed job, and rejects stale decisions', async () => {
    const demo = new DemoResearch();
    const discover = vi.fn<ResearchProvider['discover']>((...args) => demo.discover(...args));
    const { service } = createFixture({ discover });
    await initialize(service);
    await service.investors.discover('discovery-one');
    await service.investors.discover('discovery-one');
    await service.investors.discover('discovery-two');
    expect(discover).toHaveBeenCalledTimes(1);
    const suggestion = (await service.read()).discovery.suggestions[0];
    if (!suggestion) {
      throw new Error('Missing suggestion');
    }
    await service.change((state) => {
      state.profile.version++;
    });
    await expect(service.investors.discovery.decide(suggestion.id, 'tracked')).rejects.toThrow(
      'company context changed',
    );
  });

  it('discards discovery results when company context changes during research', async () => {
    const demo = new DemoResearch();
    const discover = vi.fn<ResearchProvider['discover']>();
    const { service } = createFixture({ discover });
    await initialize(service);
    discover.mockImplementation(async (...args) => {
      await service.change((state) => {
        state.profile.version++;
      });
      return demo.discover(...args);
    });
    await expect(service.investors.discover()).rejects.toThrow('Profile changed');
    expect((await service.read()).discovery.suggestions).toEqual([]);
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
                    comparableDeal: null,
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

it('uses comparable-round and co-investor searches and rejects unsupported funding passages', async () => {
  const { service } = createFixture();
  await initialize(service);
  const profile = (await service.read()).profile;
  const research = new LiveResearch('test-exa', 'test-model', 'gpt-6.1-sol');
  let supported = true;
  const requests: string[] = [];
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    requests.push(body);
    if (
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes(
        'exa.ai',
      )
    ) {
      return Promise.resolve(
        Response.json({
          results: [
            {
              title: 'Funding announcement',
              url: 'https://example.com/round',
              text: 'Cedar participated in ExampleCo seed round. ExampleCo builds B2B software in Canada. The round total was CAD 2 million.',
            },
          ],
        }),
      );
    }
    return Promise.resolve(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                investor: 'Cedar',
                matchesTarget: true,
                stage: null,
                sector: null,
                geography: null,
                checkMin: null,
                checkMax: null,
                currency: 'unspecified',
                quote: 'Cedar participated in ExampleCo seed round.',
                explanation: 'Comparable company funding, not a confirmed investor mandate.',
                comparableDeal: {
                  company: 'ExampleCo',
                  stage: 'Seed',
                  sector: 'B2B software',
                  geography: 'Canada',
                  announcedAt: null,
                  roundTotal: 'CAD 2 million',
                  participationQuote: supported
                    ? 'Cedar participated in ExampleCo seed round.'
                    : 'Invented participation.',
                  comparisonQuote: 'ExampleCo builds B2B software in Canada.',
                },
              }),
            },
          },
        ],
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const context = { knownInvestors: ['Known Fund'], excludedInvestors: ['Dismissed Fund'] };
    const records = await research.discover(profile, undefined, context);
    expect(records).toHaveLength(1);
    expect(records[0]?.checkMin).toBeNull();
    expect(records[0]?.comparableDeal?.roundTotal).toBe('CAD 2 million');
    expect(requests.filter((body) => body.includes('numResults'))).toHaveLength(2);
    expect(requests[1]).toContain('Known Fund');
    expect(requests.join('\n')).not.toContain(profile.goal);
    expect(requests.join('\n')).toContain('Dismissed Fund');
    supported = false;
    expect(await research.discover(profile, undefined, context)).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
