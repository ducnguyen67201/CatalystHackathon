import { randomUUID } from 'node:crypto';
import { CheckFrequency, InvestorOrigin } from '../contracts/InvestorTracking.js';
import type { MeetingInput } from '../contracts/Onboarding.js';
import { listProfileLinks } from '../contracts/ProfileLinks.js';
import type { Workspace } from '../contracts/Workspace.js';

/** Adds public identity hints only; saving onboarding never starts paid research. */
export function saveMeetingContext(state: Workspace, input: MeetingInput | null): void {
  if (input === null) {
    state.onboarding.meeting = null;
    return;
  }
  const links = listProfileLinks(input.links);
  if (!input.name && !input.firm) {
    throw new Error('Onboarding: add an investor name or firm, or skip this step.');
  }
  const previous = state.onboarding.meeting;
  const sameIdentity = previous?.name === input.name && previous.firm === input.firm;
  let investor = state.investors.find(
    (item) =>
      (sameIdentity && item.id === previous.investorId) ||
      links.some((url) => item.url === url || item.profileLinks.includes(url)),
  );
  const name = [input.name, input.firm].filter(Boolean).join(', ').slice(0, 100);
  if (!investor) {
    const id = randomUUID();
    investor = {
      id,
      key: links[0] ?? `meeting:${id}`,
      name,
      url: links[0] ?? null,
      profileLinks: links,
      origin: InvestorOrigin.ADDED,
      discoveryEvidenceId: null,
      createdAt: new Date().toISOString(),
      frequency: CheckFrequency.PAUSED,
      nextAt: null,
      checks: [],
    };
    state.investors.push(investor);
  } else {
    investor.name = name;
    investor.url = links[0] ?? null;
    investor.profileLinks = links;
  }
  state.onboarding.meeting = {
    ...input,
    investorId: investor.id,
    revision: (previous?.revision ?? 0) + 1,
  };
}
