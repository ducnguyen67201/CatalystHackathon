import { randomUUID } from 'node:crypto';
import { parseInvestorUrl } from '../contracts/ProfileLinks.js';
import {
  CheckFrequency,
  InvestorOrigin,
  type InvestorInput,
  type TrackedInvestor,
} from '../contracts/InvestorTracking.js';
import type { Evidence, Workspace } from '../contracts/Workspace.js';
import type { ResearchProvider } from './ResearchProvider.js';
import type { WorkspaceService } from './WorkspaceService.js';

export const InvestorJob = {
  DISCOVER: 'discover-investors',
  CHECK_PREFIX: 'investor:',
} as const;

export { parseInvestorUrl } from '../contracts/ProfileLinks.js';

export function nextInvestorCheck(
  frequency: TrackedInvestor['frequency'],
  now: Date,
): string | null {
  if (frequency === CheckFrequency.PAUSED) {
    return null;
  }
  return new Date(
    now.getTime() + (frequency === CheckFrequency.DAILY ? 1 : 7) * 86400000,
  ).toISOString();
}

function saveEvidence(state: Workspace, records: Evidence[]): void {
  for (const record of records) {
    if (!state.evidence.some((existing) => existing.eventKey === record.eventKey)) {
      state.evidence.push(record);
    }
  }
}

/** Owns watchlists and research history; voice and brief construction remain separate consumers. */
export class InvestorTrackingService {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly research: ResearchProvider,
  ) {}

  async add(input: InvestorInput): Promise<TrackedInvestor> {
    const url = parseInvestorUrl(input.url);
    return this.workspace.change((state) => {
      const existing = state.investors.find(
        (item) => item.key === url || item.url === url || item.profileLinks.includes(url),
      );
      if (existing) {
        return existing;
      }
      const now = new Date().toISOString();
      const investor: TrackedInvestor = {
        id: randomUUID(),
        key: url,
        name:
          input.name ||
          new URL(url).pathname.split('/').filter(Boolean).at(-1)?.slice(0, 100) ||
          new URL(url).hostname,
        url,
        profileLinks: [url],
        origin: InvestorOrigin.ADDED,
        discoveryEvidenceId: null,
        createdAt: now,
        frequency: input.frequency,
        nextAt: input.frequency === CheckFrequency.PAUSED ? null : now,
        checks: [],
      };
      state.investors.push(investor);
      return investor;
    });
  }

  async rename(id: string, name: string): Promise<void> {
    await this.workspace.change((state) => {
      const investor = state.investors.find((item) => item.id === id);
      if (!investor) {
        throw new Error('Investor unavailable.');
      }
      investor.name = name;
    });
  }

  async setFrequency(id: string, frequency: TrackedInvestor['frequency']): Promise<void> {
    await this.workspace.change((state) => {
      const investor = state.investors.find((item) => item.id === id);
      if (!investor) {
        throw new Error('Investor unavailable.');
      }
      investor.frequency = frequency;
      investor.nextAt = frequency === CheckFrequency.PAUSED ? null : new Date().toISOString();
    });
  }

  async enqueueCheck(id: string, key: string) {
    const state = await this.workspace.read();
    if (!state.investors.some((item) => item.id === id)) {
      throw new Error('Investor unavailable.');
    }
    return this.workspace.store.enqueue(
      `investor-manual:${id}:${key}`,
      `${InvestorJob.CHECK_PREFIX}${id}`,
    );
  }

  async tick(now: Date): Promise<void> {
    const state = await this.workspace.read();
    const due = state.investors
      .filter((item) => item.nextAt && new Date(item.nextAt) <= now)
      .sort(
        (a, b) =>
          Number(a.origin === InvestorOrigin.DISCOVERED) -
          Number(b.origin === InvestorOrigin.DISCOVERED),
      );
    for (const investor of due) {
      await this.workspace.store.enqueue(
        `investor-schedule:${investor.id}:${investor.nextAt ?? ''}`,
        `${InvestorJob.CHECK_PREFIX}${investor.id}`,
      );
      await this.workspace.change((current) => {
        const target = current.investors.find((item) => item.id === investor.id);
        if (target && target.nextAt === investor.nextAt) {
          target.nextAt = nextInvestorCheck(target.frequency, now);
        }
      });
    }
  }

  async discover(): Promise<string> {
    const initial = await this.workspace.read();
    const records = await this.research.discover({ ...initial.profile, watchlist: [] });
    const count = await this.workspace.change((state) => {
      if (state.profile.version !== initial.profile.version) {
        throw new Error('Profile changed during discovery.');
      }
      saveEvidence(state, records);
      let added = 0;
      for (const evidence of records) {
        const name = evidence.investor.trim();
        if (!name || name.length > 100) {
          continue;
        }
        const key = `name:${name.toLowerCase()}`;
        if (
          state.investors.some(
            (item) => item.key === key || item.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          continue;
        }
        const now = new Date().toISOString();
        state.investors.push({
          id: randomUUID(),
          key,
          name,
          url: null,
          profileLinks: [],
          origin: InvestorOrigin.DISCOVERED,
          discoveryEvidenceId: evidence.id,
          createdAt: now,
          frequency: CheckFrequency.DAILY,
          nextAt: now,
          checks: [],
        });
        added++;
      }
      return added;
    });
    return `${count} sourced candidates added for individual research. Suitability and identity need review.`;
  }

  async check(id: string, jobId: string): Promise<string> {
    const initial = await this.workspace.read();
    const target = initial.investors.find((item) => item.id === id);
    if (!target) {
      throw new Error('Investor unavailable.');
    }
    if (target.checks.some((check) => check.jobId === jobId)) {
      return 'This check is already saved.';
    }
    const records = await this.research.discover(initial.profile, {
      name: target.name,
      url: target.url,
      profileLinks: target.profileLinks,
    });
    return this.workspace.change((state) => {
      if (state.profile.version !== initial.profile.version) {
        throw new Error('Profile changed during investor research.');
      }
      const investor = state.investors.find((item) => item.id === id);
      if (!investor) {
        throw new Error('Investor unavailable.');
      }
      if (
        JSON.stringify([investor.name, investor.url, investor.profileLinks]) !==
        JSON.stringify([target.name, target.url, target.profileLinks])
      ) {
        throw new Error('Investor identity changed during research.');
      }
      if (investor.checks.some((check) => check.jobId === jobId)) {
        return 'This check is already saved.';
      }
      const knownIds = new Set(investor.checks.flatMap((check) => check.evidenceIds));
      const knownUrls = new Set(
        state.evidence
          .filter((item) => knownIds.has(item.id))
          .map((item) => item.url)
          .filter(Boolean),
      );
      const unique = [...new Map(records.map((item) => [item.id, item])).values()];
      const fresh = unique.filter((item) => !knownIds.has(item.id));
      const changed = fresh.filter((item) => item.url && knownUrls.has(item.url));
      const changedIds = new Set(changed.map((item) => item.id));
      const added = fresh.filter((item) => !changedIds.has(item.id));
      saveEvidence(state, unique);
      const note =
        unique.length === 0
          ? 'No supported public evidence found for this identity. Try a full name and firm; login-only profiles may not be searchable. Demo mode researches only fictional Northline Ventures.'
          : fresh.length === 0
            ? 'No new source versions found in this check. This is not proof that nothing changed elsewhere.'
            : `${added.length} new sources; ${changed.length} updated source versions. Review identity and the cited passages before acting.`;
      investor.checks.push({
        jobId,
        checkedAt: new Date().toISOString(),
        profileVersion: state.profile.version,
        evidenceIds: unique.map((item) => item.id),
        addedIds: added.map((item) => item.id),
        changedIds: [...changedIds],
        note,
      });
      if (fresh.length) {
        state.notices.push({
          id: randomUUID(),
          title: `Research updated: ${investor.name}`,
          message: note,
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
      return note;
    });
  }
}
