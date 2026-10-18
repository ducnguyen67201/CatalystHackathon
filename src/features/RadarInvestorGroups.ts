import type { Workspace } from '../contracts/Workspace.js';
import { radarInvestorGroupsSchema, type RadarInvestorGroup } from '../contracts/RadarDelivery.js';

/** Saved IDs define identity. Names and related firms never silently merge. */
export function radarInvestorGroups(state: Workspace) {
  const groups = new Map<string, RadarInvestorGroup>();
  for (const investor of state.investors) {
    const key = `investor:${investor.id}`;
    groups.set(key, {
      key,
      investorId: investor.id,
      suggestionIds: [],
      name: investor.name,
      updateCount: 0,
      unreadCount: 0,
      sourceCount: 0,
      latestEventId: null,
      latestHeadline: null,
      latestAt: null,
    });
  }
  const sourceIds = new Map<string, Set<string>>();
  for (const event of state.radar.events) {
    const key = event.investorId
      ? `investor:${event.investorId}`
      : event.suggestionId
        ? `candidate:${event.suggestionId}`
        : `event:${event.id}`;
    const group = groups.get(key) ?? {
      key,
      investorId: event.investorId,
      suggestionIds: [],
      name: event.investorName,
      updateCount: 0,
      unreadCount: 0,
      sourceCount: 0,
      latestEventId: null,
      latestHeadline: null,
      latestAt: null,
    };
    if (event.suggestionId && !group.suggestionIds.includes(event.suggestionId))
      group.suggestionIds.push(event.suggestionId);
    group.updateCount++;
    if (!event.readAt && !event.dismissedAt) group.unreadCount++;
    const sources = sourceIds.get(key) ?? new Set<string>();
    sources.add(event.evidenceId);
    sourceIds.set(key, sources);
    group.sourceCount = sources.size;
    if (!group.latestAt || event.committedAt >= group.latestAt) {
      group.latestEventId = event.id;
      group.latestHeadline = event.signal.headline;
      group.latestAt = event.committedAt;
    }
    groups.set(key, group);
  }
  return radarInvestorGroupsSchema.parse({
    items: [...groups.values()].sort(
      (a, b) => (b.latestAt ?? '').localeCompare(a.latestAt ?? '') || a.name.localeCompare(b.name),
    ),
  });
}
