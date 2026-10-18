import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { fictionalInvestorProfile } from './InvestorProfileFixtures.js';
import { fixtureEvaluationProvider } from './EvaluationFixtures.js';
import { ResearchFixture } from './fixtures/ResearchFixture.js';
import { investorInputSchema } from '../src/contracts/InvestorTracking.js';
import { workspaceSchema, type Job } from '../src/contracts/Workspace.js';
import type { InvestorProfileProvider } from '../src/features/InvestorProfileProvider.js';
import {
  investorProfileInput,
  investorProfileJobPrefix,
} from '../src/features/InvestorProfileService.js';
import { WorkspaceService } from '../src/features/WorkspaceService.js';
import type { ClaimedJob, WorkspaceStore } from '../src/features/WorkspaceStore.js';
import { buildInvestorMatchInput } from '../src/features/InvestorMatchInputs.js';
import { connectedHash } from '../src/features/ConnectedPreparation.js';
import { LiveInvestorProfileGeneration } from '../src/infrastructure/InvestorProfileGeneration.js';
import { InvestorProfileEstimateCard } from '../src/web/InvestorProfileEstimate.js';

function fixture(configured = true) {
  let state = preparationFixture().state;
  state.profile.goal = 'PRIVATE COMPANY GOAL';
  const jobs: Job[] = [];
  const generate = vi.fn<InvestorProfileProvider['generate']>(() =>
    Promise.resolve(fictionalInvestorProfile()),
  );
  const save = vi.fn<WorkspaceStore['save']>((next, expected, completed) => {
    state = workspaceSchema.parse({ ...structuredClone(next), revision: expected + 1 });
    const job = jobs.find((entry) => entry.id === completed?.id);
    if (job) job.status = 'succeeded';
    return Promise.resolve();
  });
  const enqueue = vi.fn<WorkspaceStore['enqueue']>((key, kind) => {
    const job: Job = {
      id: key,
      kind,
      status: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString(),
      result: null,
      error: null,
    };
    jobs.unshift(job);
    return Promise.resolve(job);
  });
  const finishJob = vi.fn<WorkspaceStore['finishJob']>(() => Promise.resolve());
  const store: WorkspaceStore = {
    load: () => Promise.resolve(structuredClone(state)),
    initialize: () => Promise.resolve(),
    save,
    enqueue,
    listJobs: () => Promise.resolve(jobs),
    claimJob: () => Promise.resolve(null),
    finishJob,
    failJob: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const service = new WorkspaceService(
    store,
    new ResearchFixture(),
    fixtureEvaluationProvider,
    undefined,
    undefined,
    undefined,
    undefined,
    configured ? { model: 'fictional-test-model', generate } : undefined,
  );
  async function setup() {
    const investor = await service.investors.add(
      investorInputSchema.parse({
        name: 'Fictional Ventures',
        url: 'https://fictional.example/',
        frequency: 'paused',
      }),
    );
    const input = investorProfileInput(await service.read(), investor.id);
    const hash = connectedHash(input);
    const job: ClaimedJob = {
      id: randomUUID(),
      kind: `${investorProfileJobPrefix}${investor.id}:${hash}`,
      attempts: 1,
      leaseToken: 'test-lease',
    };
    return { investor, input, hash, job };
  }
  return { service, generate, enqueue, save, finishJob, setup };
}

afterEach(() => vi.unstubAllGlobals());

describe('AI investor profile estimates', () => {
  it('keeps reads free of generation and excludes financials, private goals and fictional source excerpts from input', async () => {
    const f = fixture();
    const { investor } = await f.setup();
    const view = await f.service.investorProfiles.view(investor.id);
    expect(view).toMatchObject({ ready: true, estimate: null, job: null });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
    await f.service.change((state) => {
      const target = state.investors.find((item) => item.id === investor.id);
      if (!target) throw new Error('Missing test investor.');
      const source = {
        id: 'public-excerpt',
        eventKey: 'public-excerpt',
        mode: 'live',
        investor: investor.name,
        title: 'Public funding article',
        url: 'https://fictional.example/article',
        excerpt: 'A public participation observation.',
        publishedAt: null,
        discoveredAt: new Date().toISOString(),
        stage: null,
        sector: null,
        geography: null,
        checkMin: null,
        checkMax: null,
        currency: 'unspecified',
        explanation: 'Test context.',
        verified: false,
      };
      state.evidence.push(
        { ...source, mode: 'live', currency: 'unspecified' },
        {
          ...source,
          id: 'fictional-excerpt',
          eventKey: 'fictional-excerpt',
          mode: 'demo',
          currency: 'unspecified',
          excerpt: 'FICTIONAL PRIVATE FIXTURE',
        },
      );
      target.discoveryEvidenceId = 'public-excerpt';
      target.checks.push({
        jobId: 'fixture-check',
        checkedAt: source.discoveredAt,
        profileVersion: state.profile.version,
        evidenceIds: ['fictional-excerpt'],
        addedIds: [],
        changedIds: [],
        note: 'Fictional fixture',
      });
    });
    const input = investorProfileInput(await f.service.read(), investor.id);
    expect(input.contextSources).toHaveLength(1);
    expect(input.contextSources[0]?.excerpt).toBe('A public participation observation.');
    expect(JSON.stringify(input)).not.toContain('FICTIONAL PRIVATE FIXTURE');
    expect(JSON.stringify(input)).not.toContain('PRIVATE COMPANY GOAL');
    expect(JSON.stringify(input)).not.toContain('snapshots');
    await f.service.investorProfiles.enqueue(investor.id, randomUUID());
    expect(f.enqueue).toHaveBeenCalledWith(
      expect.stringContaining('investor-profile:'),
      expect.stringContaining(investorProfileJobPrefix),
    );
  });

  it('saves hypotheses with exact decimal strings and provenance without changing evidence, match inputs or goal history', async () => {
    const f = fixture();
    const { investor, hash, job } = await f.setup();
    const before = await f.service.read();
    const match = buildInvestorMatchInput(before, investor, '2026-10-17T12:00:00.000Z');
    expect((await f.service.journey.view()).matchGoal).toEqual(match.goal);
    await f.service.investorProfiles.run(investor.id, hash, job);
    const after = await f.service.read();
    const view = await f.service.investorProfiles.view(investor.id);
    expect(view.estimate).toMatchObject({
      provenance: 'ai_estimate',
      model: 'fictional-test-model',
      output: { checkSize: { range: { min: '100000.25', max: '500000.75', currency: 'CAD' } } },
    });
    expect(after.evidence).toEqual(before.evidence);
    expect(after.preparation).toEqual(before.preparation);
    const updatedInvestor = after.investors.find((item) => item.id === investor.id);
    if (!updatedInvestor) throw new Error('Missing test investor.');
    expect(buildInvestorMatchInput(after, updatedInvestor, '2026-10-17T12:00:00.000Z')).toEqual(
      match,
    );
    expect(f.save).toHaveBeenLastCalledWith(expect.anything(), expect.any(Number), job, undefined);
    if (!view.estimate) throw new Error('Expected a saved test estimate.');
    const html = renderToStaticMarkup(
      <InvestorProfileEstimateCard estimate={view.estimate} outdated={false} />,
    );
    expect(html).toContain('AI estimates · unverified · excluded from your match score');
    expect(html).toContain('CAD 100000.25–500000.75');
    expect(html).toContain('Assumptions &amp; context');
  });

  it('rejects changed investor identity before and during generation and marks older estimates outdated', async () => {
    const f = fixture();
    const { investor, hash, job } = await f.setup();
    await f.service.investorProfiles.run(investor.id, hash, job);
    await f.service.investors.rename(investor.id, 'Renamed fictional investor');
    expect((await f.service.investorProfiles.view(investor.id)).outdated).toBe(true);
    f.generate.mockClear();
    await f.service.investorProfiles.run(investor.id, hash, { ...job, id: randomUUID() });
    expect(f.generate).not.toHaveBeenCalled();
    const nextHash = connectedHash(investorProfileInput(await f.service.read(), investor.id));
    f.generate.mockImplementationOnce(async () => {
      await f.service.investors.rename(investor.id, 'Another fictional identity');
      return fictionalInvestorProfile();
    });
    await expect(
      f.service.investorProfiles.run(investor.id, nextHash, { ...job, id: randomUUID() }),
    ).rejects.toThrow('Investor identity changed');
    expect(
      (await f.service.read()).investors.find((item) => item.id === investor.id)?.profileEstimates,
    ).toHaveLength(1);
  });

  it('preserves prior versions on refresh and avoids regenerating an already saved job', async () => {
    const f = fixture();
    const { investor, hash, job } = await f.setup();
    await f.service.investorProfiles.run(investor.id, hash, job);
    const first = (await f.service.investorProfiles.view(investor.id)).estimate;
    await f.service.investorProfiles.run(investor.id, hash, job);
    expect(f.generate).toHaveBeenCalledTimes(1);
    await f.service.investorProfiles.run(investor.id, hash, { ...job, id: randomUUID() });
    const versions = (await f.service.read()).investors.find(
      (item) => item.id === investor.id,
    )?.profileEstimates;
    expect(versions).toHaveLength(2);
    expect(versions?.[0]).toEqual(first);
  });

  it('saves no output for provider failure, invalid ranges or absent configuration', async () => {
    const f = fixture();
    const { investor, hash, job } = await f.setup();
    f.generate.mockRejectedValueOnce(new Error('Provider failure'));
    await expect(f.service.investorProfiles.run(investor.id, hash, job)).rejects.toThrow(
      'Provider failure',
    );
    f.generate.mockResolvedValueOnce({
      ...fictionalInvestorProfile(),
      checkSize: { range: { min: '500', max: '100', currency: 'USD' }, basis: 'Invalid range' },
    });
    await expect(f.service.investorProfiles.run(investor.id, hash, job)).rejects.toThrow();
    expect((await f.service.investorProfiles.view(investor.id)).estimate).toBeNull();
    const unconfigured = fixture(false);
    const other = await unconfigured.setup();
    expect((await unconfigured.service.investorProfiles.view(other.investor.id)).ready).toBe(false);
    await expect(
      unconfigured.service.investorProfiles.enqueue(other.investor.id, randomUUID()),
    ).rejects.toThrow('not configured');
    expect(unconfigured.enqueue).not.toHaveBeenCalled();
  });
});

describe('live investor profile model adapter', () => {
  it('requests structured estimates with an explicit hypothesis prompt and bounded public context', async () => {
    const f = fixture();
    const { input } = await f.setup();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(fictionalInvestorProfile()) },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const provider = new LiveInvestorProfileGeneration('test-key', 'test-model');
    expect(await provider.generate(input)).toEqual(fictionalInvestorProfile());
    const payload = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof payload !== 'string') throw new Error('Expected a JSON request body.');
    expect(payload).toContain('All output is an AI estimate');
    expect(payload).toContain('untrusted data');
    expect(payload).toContain('"store":false');
    expect(payload).not.toContain('PRIVATE COMPANY GOAL');
  });

  it('rejects truncated or malformed output instead of presenting it as a saved profile', async () => {
    const f = fixture();
    const { input } = await f.setup();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ finish_reason: 'stop', message: { content: '{"stage":"Seed"}' } }],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const provider = new LiveInvestorProfileGeneration('test-key', 'test-model');
    await expect(provider.generate(input)).rejects.toThrow('incomplete');
    await expect(provider.generate(input)).rejects.toThrow();
  });
});
