import { randomUUID } from 'node:crypto';
import { LogEvent, LogReason } from './WorkflowLog.js';
import {
  DiscoveryFrequency,
  SuggestionStatus,
  suggestionLimit,
  type DiscoveryState,
} from '../contracts/InvestorDiscovery.js';
import { CheckFrequency, InvestorOrigin } from '../contracts/InvestorTracking.js';
import {
  investorNameKey,
  hasDiscoveryProfile,
  listCurrentSuggestions,
  supportsComparableCompany,
} from './InvestorSuggestionRules.js';
import type { ResearchProvider } from './ResearchProvider.js';
import type { WorkspaceService } from './WorkspaceService.js';

const weekMs = 7 * 86400000;

/** Discovery offers choices; it never silently starts monitoring a suggested investor. */
export class InvestorDiscoveryService {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly research: ResearchProvider,
  ) {}

  async setFrequency(frequency: DiscoveryState['frequency']): Promise<void> {
    await this.workspace.change((state) => {
      state.discovery.frequency = frequency;
      state.discovery.nextAt =
        frequency === DiscoveryFrequency.PAUSED ? null : new Date().toISOString();
    });
  }

  async tick(now: Date): Promise<void> {
    const state = await this.workspace.read();
    const schedule = state.discovery;
    if (schedule.frequency === DiscoveryFrequency.PAUSED || !hasDiscoveryProfile(state.profile)) {
      return;
    }
    // Version 1 is the seeded demo assumption, not a founder-completed company profile.
    const profileChanged =
      state.profile.version > 1 && schedule.scheduledProfileVersion !== state.profile.version;
    const due = schedule.nextAt !== null && new Date(schedule.nextAt) <= now;
    if (!profileChanged && !due) {
      return;
    }
    await this.workspace.store.enqueue(
      `discovery-schedule:${state.profile.version}:${schedule.nextAt ?? 'initial'}`,
      'discover-investors',
    );
    await this.workspace.change((current) => {
      if (
        current.discovery.frequency !== DiscoveryFrequency.PAUSED &&
        current.profile.version === state.profile.version &&
        current.discovery.nextAt === schedule.nextAt
      ) {
        current.discovery.nextAt = new Date(now.getTime() + weekMs).toISOString();
        current.discovery.scheduledProfileVersion = state.profile.version;
      }
    });
  }

  async discover(jobId: string): Promise<string> {
    const initial = await this.workspace.read();
    if (initial.discovery.lastJobId === jobId) {
      return initial.discovery.note;
    }
    if (!hasDiscoveryProfile(initial.profile)) {
      throw new Error('Investor discovery: complete company stage, sector and geography first.');
    }
    if (listCurrentSuggestions(initial).length >= suggestionLimit) {
      this.workspace.logger.write(LogEvent.DISCOVERY_SKIPPED, {
        jobId,
        reason: LogReason.FULL_TRAY,
      });
      return 'Review your three suggestions: Track or Dismiss one before finding more.';
    }
    const records = await this.research.discover({ ...initial.profile, watchlist: [] }, undefined, {
      knownInvestors: initial.investors.map((investor) => investor.name).slice(0, 20),
      excludedInvestors: initial.discovery.suggestions
        .filter(
          (suggestion) =>
            suggestion.status !== SuggestionStatus.SUGGESTED ||
            suggestion.profileVersion === initial.profile.version,
        )
        .map((suggestion) => suggestion.name)
        .slice(-200),
    });
    let addedCount = 0;
    const result = await this.workspace.change((state) => {
      if (state.profile.version !== initial.profile.version) {
        throw new Error('Profile changed during discovery.');
      }
      if (state.discovery.lastJobId === jobId) {
        return state.discovery.note;
      }
      const excluded = new Set([
        ...state.investors.map((investor) => investorNameKey(investor.name)),
        ...state.discovery.suggestions
          .filter(
            (suggestion) =>
              suggestion.status !== SuggestionStatus.SUGGESTED ||
              suggestion.profileVersion === state.profile.version,
          )
          .map((suggestion) => investorNameKey(suggestion.name)),
      ]);
      let remaining = suggestionLimit - listCurrentSuggestions(state).length;
      let added = 0;
      for (const evidence of records) {
        const name = evidence.investor.trim();
        const key = investorNameKey(name);
        if (
          remaining <= 0 ||
          !key ||
          name.length > 100 ||
          excluded.has(key) ||
          !supportsComparableCompany(state.profile, evidence)
        ) {
          continue;
        }
        if (!state.evidence.some((existing) => existing.eventKey === evidence.eventKey)) {
          state.evidence.push(evidence);
        }
        state.discovery.suggestions.push({
          id: randomUUID(),
          name,
          evidenceId: evidence.id,
          profileVersion: state.profile.version,
          status: SuggestionStatus.SUGGESTED,
          createdAt: new Date().toISOString(),
        });
        excluded.add(key);
        remaining--;
        added++;
      }
      addedCount = added;
      const now = new Date();
      state.discovery.lastAt = now.toISOString();
      state.discovery.lastJobId = jobId;
      state.discovery.scheduledProfileVersion = state.profile.version;
      state.discovery.nextAt =
        state.discovery.frequency === DiscoveryFrequency.PAUSED
          ? null
          : new Date(now.getTime() + weekMs).toISOString();
      state.discovery.note = added
        ? `${added} new suggestions backed by comparable funding rounds. Choose who to track.`
        : 'No new supported suggestions found. Existing, dismissed and unsupported candidates were excluded.';
      if (added) {
        state.notices.push({
          id: randomUUID(),
          title: 'New investors to consider',
          message: state.discovery.note,
          createdAt: now.toISOString(),
          read: false,
        });
      }
      return state.discovery.note;
    });
    this.workspace.logger.write(LogEvent.DISCOVERY_SAVED, {
      jobId,
      count: records.length,
      addedCount,
    });
    return result;
  }

  async decide(id: string, decision: 'tracked' | 'dismissed'): Promise<void> {
    await this.workspace.change((state) => {
      const suggestion = state.discovery.suggestions.find((item) => item.id === id);
      if (!suggestion) {
        throw new Error('Investor discovery: suggestion unavailable.');
      }
      if (suggestion.status !== SuggestionStatus.SUGGESTED) {
        return;
      }
      if (
        decision === SuggestionStatus.TRACKED &&
        suggestion.profileVersion !== state.profile.version
      ) {
        throw new Error(
          'Investor discovery: company context changed. Find fresh suggestions first.',
        );
      }
      suggestion.status = decision;
      if (
        decision === SuggestionStatus.DISMISSED ||
        state.investors.some(
          (investor) => investorNameKey(investor.name) === investorNameKey(suggestion.name),
        )
      ) {
        return;
      }
      const now = new Date().toISOString();
      state.investors.push({
        id: randomUUID(),
        key: `name:${investorNameKey(suggestion.name)}`,
        name: suggestion.name,
        url: null,
        profileLinks: [],
        origin: InvestorOrigin.DISCOVERED,
        discoveryEvidenceId: suggestion.evidenceId,
        createdAt: now,
        frequency: CheckFrequency.DAILY,
        nextAt: now,
        checks: [],
      });
    });
  }
}
