import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LiveResearch } from '../src/infrastructure/Research.js';
import { investorPreferencesSchema } from '../src/contracts/InvestorDiscovery.js';
import { profileSchema } from '../src/contracts/Workspace.js';
import { researchRunSchema, type ResearchRun } from '../src/contracts/ResearchRun.js';
import type { ResearchRunStore } from '../src/features/ResearchRunStore.js';

const profile = profileSchema.parse({
  name: 'Example',
  stage: 'Seed',
  sector: 'B2B software',
  geography: 'Canada',
  raiseTarget: '9876543',
  currency: 'CAD',
  goal: 'PRIVATE GOAL',
  version: 2,
  watchlist: [],
});
const page = {
  title: 'Company funding',
  url: 'https://example.com/funding',
  text: 'Acme VC funded ExampleCo. ExampleCo builds B2B software in Canada.',
};
const claim = {
  investor: 'Acme VC',
  matchesTarget: true,
  stage: null,
  sector: null,
  geography: null,
  checkMin: null,
  checkMax: null,
  currency: 'unspecified',
  quote: 'Acme VC funded ExampleCo.',
  explanation: 'Participation is supported.',
  comparableDeal: {
    company: 'ExampleCo',
    stage: 'Seed',
    sector: 'B2B software',
    geography: 'Canada',
    announcedAt: null,
    roundTotal: null,
    participationQuote: 'Acme VC funded ExampleCo.',
    comparisonQuote: 'ExampleCo builds B2B software in Canada.',
  },
};
function completion() {
  return Response.json({ choices: [{ message: { content: JSON.stringify(claim) } }] });
}
function fixture() {
  const runs: ResearchRun[] = [];
  const save = vi.fn<ResearchRunStore['saveResearchRun']>((run) => {
    const parsed = researchRunSchema.parse(run);
    runs.push(parsed);
    return Promise.resolve(parsed);
  });
  const store: ResearchRunStore = {
    saveResearchRun: save,
    findResearchRun: (id) => Promise.resolve(runs.find((run) => run.id === id) ?? null),
    listResearchRuns: () => Promise.resolve({ items: [], nextOffset: null }),
  };
  return {
    runs,
    save,
    research: new LiveResearch('exa-test', 'openai-test', 'test-model', undefined, store),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('research output archives', () => {
  it('captures investor input, source text, accepted evidence, rejected sources and workflow lineage', async () => {
    const { research, runs } = fixture();
    const investorId = randomUUID();
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            results: [{ title: 'No content', url: 'https://example.com/empty' }, page],
          }),
        )
        .mockResolvedValueOnce(completion()),
    );
    const evidence = await research.discover(
      profile,
      { name: 'Acme VC', url: 'https://example.com/team' },
      undefined,
      { investorId, jobId: 'job-test', attempt: 2 },
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      kind: 'investor',
      origin: 'workflow',
      status: 'succeeded',
      investorId,
      jobId: 'job-test',
      attempt: 2,
      evidence,
    });
    expect(runs[0]?.searches[0]?.sources[1]?.text).toBe(page.text);
    expect(runs[0]?.decisions.map((item) => item.status)).toEqual(['rejected', 'accepted']);
    expect(runs[0]?.decisions[0]?.reason).toBe('no_text');
    expect(JSON.stringify(runs)).not.toMatch(/PRIVATE GOAL|9876543|exa-test|openai-test/);
  });

  it('archives segment and example-firm queries with frozen preferences for suggestions', async () => {
    const { research, runs } = fixture();
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ results: [] }))
        .mockResolvedValueOnce(Response.json({ results: [page] }))
        .mockResolvedValueOnce(completion()),
    );
    await research.discover(
      {
        ...profile,
        investorPreferences: investorPreferencesSchema.parse({
          types: ['Accelerator'],
          referenceFirms: ['YC'],
        }),
      },
      undefined,
      { knownInvestors: ['Known VC'], excludedInvestors: ['Dismissed VC'] },
      { jobId: 'discovery-job', attempt: 1 },
    );
    expect(runs[0]?.kind).toBe('discovery');
    expect(runs[0]?.searches).toHaveLength(2);
    expect(runs[0]?.input.investorPreferences?.referenceFirms).toEqual(['YC']);
    expect(runs[0]?.searches[1]?.query).toContain('firms like YC');
    expect(runs[0]?.searches.every((search) => !search.query.includes('Known VC'))).toBe(true);
    expect(runs[0]?.input.discovery?.knownInvestors).toEqual(['Known VC']);
    expect(runs[0]?.evidence[0]?.comparableDeal?.company).toBe('ExampleCo');
  });

  it('preserves fetched sources after extraction fails, with safe failure metadata', async () => {
    const { research, runs } = fixture();
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ results: [page] }))
        .mockResolvedValueOnce(Response.json({ error: 'PRIVATE PROVIDER BODY' }, { status: 401 })),
    );
    await expect(research.discover(profile)).rejects.toThrow('401');
    expect(runs[0]).toMatchObject({
      kind: 'radar',
      status: 'failed',
      failure: { provider: 'openai', statusCode: 401, reason: 'http_error' },
    });
    expect(runs[0]?.searches[0]?.sources).toEqual([page]);
    expect(JSON.stringify(runs)).not.toContain('PRIVATE PROVIDER BODY');
  });

  it('stores a successful zero-result search distinctly from failure', async () => {
    const { research, runs } = fixture();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [] })));
    await research.discover(profile);
    expect(runs[0]).toMatchObject({ status: 'succeeded', evidence: [], failure: null });
    expect(runs[0]?.searches).toHaveLength(1);
  });

  it('does not report research success if archive persistence fails', async () => {
    const { research, save } = fixture();
    save.mockRejectedValue(new Error('Storage unavailable'));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [] })));
    await expect(research.discover(profile)).rejects.toThrow('Storage unavailable');
    expect(save).toHaveBeenCalledTimes(1);
  });
});

it('keeps classification in the existing extraction call and requires its exact supporting quote', async () => {
  const { research } = fixture();
  const signal = {
    category: 'investment',
    headline: 'Fictional Acme backs ExampleCo',
    summary: 'Fictional example.',
    whyItMatters: 'Same sector.',
    supportingQuote: claim.quote,
    notificationEligible: true,
    needsReview: false,
    canonicalEventKey: null,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ results: [page] }))
    .mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: JSON.stringify({ ...claim, signal }) } }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  const records = await research.discover(
    profile,
    { name: 'Acme VC', url: 'https://example.com/team' },
    undefined,
    { jobId: 'classified' },
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(records[0]?.signal?.category).toBe('investment');
  expect(records[0]?.researchRunId).toBeDefined();
  fetcher.mockResolvedValueOnce(Response.json({ results: [page] })).mockResolvedValueOnce(
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...claim,
              signal: { ...signal, supportingQuote: 'INVENTED PASSAGE' },
            }),
          },
        },
      ],
    }),
  );
  const rejected = await research.discover(profile, {
    name: 'Acme VC',
    url: 'https://example.com/team',
  });
  expect(rejected[0]?.signal).toBeNull();
});
