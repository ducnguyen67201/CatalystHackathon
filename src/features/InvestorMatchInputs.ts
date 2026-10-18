import type { Workspace } from '../contracts/Workspace.js';
import type { TrackedInvestor } from '../contracts/InvestorTracking.js';
import type { InvestorMatchInput } from '../contracts/InvestorMatch.js';
import type { SavedInvestorMatch } from '../contracts/GoalJourney.js';
import { investorMatchInputHash, matchFactsFromEvidence } from './InvestorMatch.js';
import { investorSources } from './ConnectedPreparation.js';

export function buildInvestorMatchInput(
  state: Workspace,
  investor: TrackedInvestor,
  now = new Date().toISOString(),
): InvestorMatchInput {
  const identity: InvestorMatchInput['identity'] = {
    investorId: investor.id,
    subjectKey: investor.key,
    status: 'needs_review',
  };
  const facts = matchFactsFromEvidence(investorSources(state, investor.id), identity);
  if (facts.length) identity.status = 'confirmed';
  return { goal: buildInvestorMatchGoal(state), identity, facts, now };
}

export function buildInvestorMatchGoal(state: Workspace): InvestorMatchInput['goal'] {
  const goal = state.preparation?.goals.at(-1);
  const preferences = state.profile.investorPreferences ?? {
    types: [],
    firmSize: 'Any size',
    referenceFirms: [],
    priorities: '',
  };
  const selected: InvestorMatchInput['goal']['preferences'] = [];
  if (preferences.types.length)
    selected.push({ key: 'type', values: preferences.types, required: false });
  if (preferences.firmSize !== 'Any size')
    selected.push({ key: 'firm_size', values: [preferences.firmSize], required: false });
  const known = (value: string | undefined) =>
    value && value !== 'Not confirmed' && value !== 'Next round' ? value : null;
  return {
    round: known(goal?.round) ?? known(state.profile.stage),
    sector: known(state.profile.sector),
    geography: known(state.profile.geography),
    desiredCheck: goal?.desiredCheck ?? null,
    preferences: selected,
  };
}

export function savedMatchOutdated(
  state: Workspace,
  saved: SavedInvestorMatch,
  now = new Date().toISOString(),
) {
  const investor = state.investors.find((i) => i.id === saved.investorId);
  if (!investor) return true;
  return (
    investorMatchInputHash(buildInvestorMatchInput(state, investor, now)) !==
      saved.assessment.inputHash ||
    (!!saved.assessment.nextReviewAt &&
      Date.parse(saved.assessment.nextReviewAt) <= Date.parse(now))
  );
}
