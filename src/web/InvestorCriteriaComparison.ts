import { Decimal } from 'decimal.js';
import type {
  InvestorMatchAssessment,
  InvestorMatchInput,
  InvestorMatchCriterion,
} from '../contracts/InvestorMatch.js';
import type { InvestorProfileEstimateView } from '../contracts/InvestorProfileEstimate.js';

type Goal = InvestorMatchInput['goal'];
export interface InvestorCriteriaRow {
  criterion: InvestorMatchCriterion;
  label: string;
  goal: string;
  investor: string;
  result: string;
  basis:
    | 'AI estimate'
    | 'Sourced criteria'
    | 'Research needed'
    | 'Goal input'
    | 'Optional'
    | 'Saved assessment';
}
const labels: Record<InvestorMatchCriterion, string> = {
  stage: 'Stage',
  sector: 'Sector',
  geography: 'Geography',
  check_size: 'Check size',
  preferences: 'Preferences',
};
function rangeText(range: NonNullable<Goal['desiredCheck']>) {
  return `${range.currency} ${new Decimal(range.min).toFixed()}–${new Decimal(range.max).toFixed()}`;
}
function goalText(goal: Goal | null, criterion: InvestorMatchCriterion): string | null {
  if (!goal) return null;
  if (criterion === 'check_size') return goal.desiredCheck ? rangeText(goal.desiredCheck) : null;
  if (criterion === 'preferences')
    return goal.preferences.length
      ? goal.preferences.flatMap((item) => item.values).join(', ')
      : null;
  return criterion === 'stage' ? goal.round : goal[criterion];
}
const normalized = (value: string) =>
  value.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();

/** Conservative display comparison only. Never converts free text into sourced mandate facts. */
function estimatedCategoryResult(
  criterion: InvestorMatchCriterion,
  desired: string,
  value: string,
) {
  const text = normalized(value);
  const target = normalized(desired);
  // Negative or qualified prose cannot establish positive eligibility by keyword alone.
  if (/\b(no|not|except|excluding|excludes|without)\b/.test(text)) return 'Review estimate';
  if (text === target) return 'Potential match';
  if (criterion === 'stage') {
    const stageText = text.replace(/\bpre\s+seed\b/g, 'preseed');
    const stagePattern = /\b(preseed|seed|series [a-d])\b/g;
    const stages: string[] = stageText.match(stagePattern) ?? [];
    const remainder = stageText
      .replace(stagePattern, '')
      .replace(/\b(and|or)\b/g, '')
      .replace(/[\s,&/;]+/g, '');
    if (!remainder && stages.includes(target === 'pre seed' ? 'preseed' : target))
      return 'Potential match';
  }
  // A descriptive focus, a parent region, or a different label needs founder review.
  // Non-mention never implies exclusion; no fuzzy score or currency conversion is inferred.
  return 'Review estimate';
}

export function compareInvestorCriteria(
  assessment: InvestorMatchAssessment,
  goal: Goal | null,
  profile: InvestorProfileEstimateView | null,
  assessmentOutdated = false,
): InvestorCriteriaRow[] {
  const output = profile?.estimate?.output;
  return assessment.criteria.map((criterion): InvestorCriteriaRow => {
    const desired = goalText(goal, criterion.criterion);
    const value = !output
      ? null
      : criterion.criterion === 'check_size'
        ? output.checkSize.range
          ? rangeText(output.checkSize.range)
          : null
        : criterion.criterion === 'preferences'
          ? null
          : output[criterion.criterion].value;
    const row = {
      criterion: criterion.criterion,
      label: labels[criterion.criterion],
      goal: desired ?? 'Not set',
      investor: 'Not researched',
    };
    // Current source-backed outcomes and conflicts always take precedence over hypotheses.
    if (criterion.state !== 'unknown' && criterion.state !== 'not_applicable') {
      return {
        ...row,
        investor: 'See saved source criteria below',
        result: assessmentOutdated
          ? 'Reassess saved match'
          : criterion.state === 'outdated'
            ? 'Research outdated'
            : criterion.state === 'conflict'
              ? 'Sources conflict'
              : criterion.state === 'match'
                ? 'Match'
                : criterion.state === 'partial'
                  ? 'Partial match'
                  : 'Mismatch',
        basis:
          assessmentOutdated || criterion.state === 'outdated'
            ? 'Saved assessment'
            : 'Sourced criteria',
      };
    }
    if (criterion.criterion === 'preferences' && !desired)
      return {
        ...row,
        goal: 'None selected',
        investor: 'Optional',
        result: 'Not applicable',
        basis: 'Optional',
      };
    if (!desired)
      return {
        ...row,
        investor: value
          ? `${value} (${profile?.outdated ? 'earlier AI estimate' : 'AI estimate'})`
          : 'Not researched',
        result: 'Add goal details',
        basis: 'Goal input',
      };
    if (profile?.outdated && value)
      return {
        ...row,
        investor: `${value} (earlier AI estimate)`,
        result: 'Refresh AI profile',
        basis: 'Saved assessment',
      };
    if (value && output) {
      let result = estimatedCategoryResult(criterion.criterion, desired, value);
      if (criterion.criterion === 'check_size' && goal?.desiredCheck && output.checkSize.range) {
        const estimated = output.checkSize.range;
        result =
          goal.desiredCheck.currency !== estimated.currency
            ? 'Check currency'
            : new Decimal(goal.desiredCheck.min).lte(estimated.max) &&
                new Decimal(goal.desiredCheck.max).gte(estimated.min)
              ? 'Estimated overlap'
              : 'Estimated mismatch';
      }
      return { ...row, investor: value, result, basis: 'AI estimate' };
    }
    return {
      ...row,
      result: criterion.criterion === 'preferences' ? 'Review preferences' : 'Research needed',
      basis: 'Research needed',
    };
  });
}
