import { randomUUID } from 'node:crypto';
import {
  investorProfileEstimateInputSchema,
  investorProfileEstimateViewSchema,
  savedInvestorProfileEstimateSchema,
  type InvestorProfileEstimateInput,
} from '../contracts/InvestorProfileEstimate.js';
import type { Workspace } from '../contracts/Workspace.js';
import { connectedHash, investorSources } from './ConnectedPreparation.js';
import type { InvestorProfileProvider } from './InvestorProfileProvider.js';
import type { WorkspaceService } from './WorkspaceService.js';
import { UnavailableError, type ClaimedJob } from './WorkspaceStore.js';

export const investorProfileJobPrefix = 'investor:profile:';
const versionLimit = 50;

export function investorProfileInput(
  state: Workspace,
  investorId: string,
): InvestorProfileEstimateInput {
  const investor = state.investors.find((item) => item.id === investorId);
  if (!investor) throw new UnavailableError('Investor unavailable.');
  return investorProfileEstimateInputSchema.parse({
    investor: {
      id: investor.id,
      name: investor.name,
      url: investor.url,
      profileLinks: investor.profileLinks,
    },
    contextSources: investorSources(state, investorId)
      .filter((source) => source.mode === 'live' && source.url?.startsWith('https://'))
      .slice(-5)
      .map((source) => ({
        id: source.id,
        title: source.title.slice(0, 500),
        url: source.url,
        excerpt: source.excerpt.slice(0, 1200),
      })),
  });
}

/** Estimates never enter evidence, assessments, preparation briefs or progress observations. */
export class InvestorProfileService {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly provider?: InvestorProfileProvider,
  ) {}

  async view(investorId: string) {
    const [state, jobs] = await Promise.all([
      this.workspace.read(),
      this.workspace.store.listJobs(),
    ]);
    const input = investorProfileInput(state, investorId);
    const estimate =
      state.investors.find((item) => item.id === investorId)?.profileEstimates?.at(-1) ?? null;
    const job = jobs.find((item) =>
      item.kind.startsWith(`${investorProfileJobPrefix}${investorId}:`),
    );
    return investorProfileEstimateViewSchema.parse({
      ready: !!this.provider,
      estimate,
      outdated: !!estimate && estimate.inputHash !== connectedHash(input),
      job: job
        ? {
            id: job.id,
            status: job.status,
            attempts: job.attempts,
            error: job.error,
            result: job.result,
          }
        : null,
    });
  }

  async enqueue(investorId: string, key: string) {
    if (!this.provider) throw new Error('Investor profile: AI generation is not configured.');
    const state = await this.workspace.read();
    const input = investorProfileInput(state, investorId);
    const versions = state.investors.find((item) => item.id === investorId)?.profileEstimates ?? [];
    if (versions.length >= versionLimit)
      throw new Error(
        'Investor profile: saved estimate history is full. Existing versions are retained.',
      );
    const hash = connectedHash(input);
    // The existing active-investor-job unique index coalesces concurrent clicks.
    return this.workspace.store.enqueue(
      `investor-profile:${investorId}:${hash}:${key}`,
      `${investorProfileJobPrefix}${investorId}:${hash}`,
    );
  }

  async run(investorId: string, inputHash: string, job: ClaimedJob) {
    if (!this.provider) throw new Error('Investor profile: AI generation is not configured.');
    const state = await this.workspace.read();
    const input = investorProfileInput(state, investorId);
    const prior = state.investors.find((item) => item.id === investorId)?.profileEstimates ?? [];
    if (prior.some((entry) => entry.jobId === job.id)) {
      await this.workspace.store.finishJob(job, 'AI profile estimates already saved.');
      return;
    }
    if (connectedHash(input) !== inputHash) {
      await this.workspace.store.finishJob(
        job,
        'Investor context changed. Generate a fresh AI profile.',
      );
      return;
    }
    const output = await this.provider.generate(input);
    const saved = savedInvestorProfileEstimateSchema.parse({
      id: randomUUID(),
      jobId: job.id,
      provenance: 'ai_estimate',
      generatedAt: new Date().toISOString(),
      model: this.provider.model,
      inputHash,
      input,
      output,
    });
    await this.workspace.change((current) => {
      if (connectedHash(investorProfileInput(current, investorId)) !== inputHash)
        throw new Error('Investor identity changed during profile generation.');
      const investor = current.investors.find((item) => item.id === investorId);
      if (!investor) throw new UnavailableError('Investor unavailable.');
      investor.profileEstimates ??= [];
      if (investor.profileEstimates.some((entry) => entry.jobId === job.id)) return;
      if (investor.profileEstimates.length >= versionLimit)
        throw new Error('Investor profile: saved estimate history is full.');
      investor.profileEstimates.push(saved);
    }, job);
  }
}
