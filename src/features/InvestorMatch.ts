import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import {
  investorMatchAssessmentSchema,
  investorMatchInputSchema,
  investorMandateFactSchema,
  type InvestorMandateFact,
  type InvestorMatchAssessment,
  type InvestorMatchCriterion,
  type InvestorMatchCriterionResult,
  type InvestorMatchInput,
} from '../contracts/InvestorMatch.js';
import type { Evidence } from '../contracts/Workspace.js';

export const investorMatchRubricVersion = 'investor-match-v1';
export const investorMatchTaxonomyVersion = 'investor-taxonomy-v1';
const reviewAgeMs = 180 * 24 * 60 * 60 * 1000;
const weights = {
  stage: '25',
  sector: '25',
  geography: '20',
  check_size: '20',
  preferences: '10',
} as const;
const criteria = Object.keys(weights) as InvestorMatchCriterion[];
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const uniqueSorted = (values: string[]) => [...new Set(values)].sort();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Only these documented aliases/ancestor rules permit broader-to-narrower matches. */
const aliases: Record<string, string> = {
  'pre-seed': 'pre_seed',
  'pre seed': 'pre_seed',
  pre_seed: 'pre_seed',
  seed: 'seed',
  'series a': 'series_a',
  'series b': 'series_b',
  'series c': 'series_c',
  'series d': 'series_d',
  canada: 'canada',
  canadian: 'canada',
  'united states': 'united_states',
  usa: 'united_states',
  us: 'united_states',
  'u.s.': 'united_states',
  'united kingdom': 'united_kingdom',
  uk: 'united_kingdom',
  europe: 'europe',
  'north america': 'north_america',
  worldwide: 'worldwide',
  global: 'worldwide',
  'all countries': 'worldwide',
  software: 'software',
  'enterprise software': 'enterprise_software',
  'b2b software': 'enterprise_software',
  'b2b saas': 'b2b_saas',
  'software as a service': 'saas',
  saas: 'saas',
  fintech: 'fintech',
  healthcare: 'healthcare',
  'climate tech': 'climate_tech',
  'climate technology': 'climate_tech',
  'ai hardware': 'ai_hardware',
  'artificial intelligence': 'ai',
  ai: 'ai',
  angel: 'angel',
  accelerator: 'accelerator',
  'venture capital': 'venture_capital',
  'venture capital firm': 'venture_capital',
  small: 'small',
  medium: 'medium',
  large: 'large',
};
const parents: Record<string, string[]> = {
  canada: ['north_america', 'worldwide'],
  united_states: ['north_america', 'worldwide'],
  united_kingdom: ['europe', 'worldwide'],
  north_america: ['worldwide'],
  europe: ['worldwide'],
  b2b_saas: ['saas', 'enterprise_software', 'software'],
  enterprise_software: ['software'],
  saas: ['software'],
};
function canonical(value: string) {
  return aliases[normalized(value)] ?? normalized(value);
}
function contains(values: string[], desired: string) {
  const value = canonical(desired);
  return values.some((item) => {
    const candidate = canonical(item);
    return candidate === value || (parents[value]?.includes(candidate) ?? false);
  });
}
function semanticGoal(goal: InvestorMatchInput['goal']) {
  return {
    round: goal.round ? canonical(goal.round) : null,
    sector: goal.sector ? canonical(goal.sector) : null,
    geography: goal.geography ? canonical(goal.geography) : null,
    desiredCheck: goal.desiredCheck
      ? {
          min: new Decimal(goal.desiredCheck.min).toString(),
          max: new Decimal(goal.desiredCheck.max).toString(),
          currency: goal.desiredCheck.currency,
        }
      : null,
    preferences: goal.preferences
      .map((preference) => ({
        key: preference.key,
        values: uniqueSorted(preference.values.map(canonical)),
        required: preference.required,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}
function semanticFacts(facts: InvestorMandateFact[]) {
  return facts
    .map((fact) => ({
      ...fact,
      values: uniqueSorted(fact.values.map(canonical)),
      checkRange: fact.checkRange
        ? {
            min: new Decimal(fact.checkRange.min).toString(),
            max: new Decimal(fact.checkRange.max).toString(),
            currency: fact.checkRange.currency,
          }
        : null,
      supersedesFactIds: uniqueSorted(fact.supersedesFactIds),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Matching hashes exclude evaluation time, unrelated profile bumps, and UI state. */
export function investorMatchInputHash(value: InvestorMatchInput) {
  const input = investorMatchInputSchema.parse(value);
  return hash({
    goal: semanticGoal(input.goal),
    identity: input.identity,
    facts: semanticFacts(input.facts),
    rubricVersion: investorMatchRubricVersion,
    taxonomyVersion: investorMatchTaxonomyVersion,
  });
}

function deadline(fact: InvestorMandateFact) {
  return (
    fact.validUntil ?? new Date(Date.parse(fact.source.retrievedAt) + reviewAgeMs).toISOString()
  );
}
function eligibleScope(fact: InvestorMandateFact) {
  return (
    fact.scope === 'stated_mandate' ||
    (['sector', 'preferences'].includes(fact.criterion) && fact.scope === 'qualitative_thesis')
  );
}
type Outcome = { result: '0' | '1' | null; exclusion: boolean };
function categoricalOutcome(fact: InvestorMandateFact, desired: string): Outcome {
  const canonicalDesired = canonical(desired);
  const stageValues = new Set(['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d']);
  const geographyValues = new Set([
    'canada',
    'united_states',
    'united_kingdom',
    'europe',
    'north_america',
    'worldwide',
  ]);
  // Broad/unknown labels cannot establish a negative eligibility decision.
  if (
    fact.criterion === 'stage' &&
    (!stageValues.has(canonicalDesired) ||
      fact.values.some((value) => !stageValues.has(canonical(value))))
  )
    return { result: null, exclusion: false };
  if (
    fact.criterion === 'geography' &&
    !fact.values.some((value) => canonical(value) === canonicalDesired) &&
    (!geographyValues.has(canonicalDesired) ||
      fact.values.some(
        (value) =>
          !geographyValues.has(canonical(value)) ||
          (parents[canonical(value)]?.includes(canonicalDesired) ?? false),
      ))
  )
    return { result: null, exclusion: false };
  const included = contains(fact.values, desired);
  if (fact.stance === 'excludes') return { result: included ? '0' : null, exclusion: included };
  return { result: included ? '1' : fact.exhaustive ? '0' : null, exclusion: false };
}
function factOutcome(fact: InvestorMandateFact, input: InvestorMatchInput): Outcome {
  const criterion = fact.criterion;
  if (criterion === 'stage' || criterion === 'sector' || criterion === 'geography') {
    const desired = criterion === 'stage' ? input.goal.round : input.goal[criterion];
    if (!desired || normalized(desired) === 'not confirmed')
      return { result: null, exclusion: false };
    return categoricalOutcome(fact, desired);
  }
  if (criterion === 'check_size') {
    const desired = input.goal.desiredCheck;
    const range = fact.checkRange;
    if (!desired || !range || desired.currency !== range.currency)
      return { result: null, exclusion: false };
    const overlap =
      new Decimal(desired.min).lte(range.max) && new Decimal(desired.max).gte(range.min);
    if (fact.stance === 'excludes') return { result: overlap ? '0' : null, exclusion: overlap };
    return { result: overlap ? '1' : '0', exclusion: false };
  }
  const preference = input.goal.preferences.find((value) => value.key === fact.preferenceKey);
  if (!preference) return { result: null, exclusion: false };
  const outcomes = preference.values.map((value) => categoricalOutcome(fact, value));
  const supported = outcomes.filter((value) => value.result !== null);
  return {
    result: supported.some((value) => value.result === '1')
      ? '1'
      : supported.length === outcomes.length
        ? '0'
        : null,
    exclusion: supported.some((value) => value.exclusion),
  };
}
function incompatibleRanges(facts: InvestorMandateFact[]) {
  return facts.some((fact, index) =>
    facts.slice(index + 1).some((other) => {
      if (
        !fact.checkRange ||
        !other.checkRange ||
        fact.stance !== 'includes' ||
        other.stance !== 'includes'
      )
        return false;
      return (
        fact.checkRange.currency !== other.checkRange.currency ||
        new Decimal(fact.checkRange.max).lt(other.checkRange.min) ||
        new Decimal(other.checkRange.max).lt(fact.checkRange.min)
      );
    }),
  );
}
function incompatibleCategories(facts: InvestorMandateFact[]) {
  return facts.some((fact, index) =>
    facts.slice(index + 1).some((other) => {
      if (
        fact.stance !== 'includes' ||
        other.stance !== 'includes' ||
        !fact.exhaustive ||
        !other.exhaustive
      )
        return false;
      return (
        JSON.stringify(uniqueSorted(fact.values.map(canonical))) !==
        JSON.stringify(uniqueSorted(other.values.map(canonical)))
      );
    }),
  );
}
function describeCriterion(
  criterion: InvestorMatchCriterion,
  input: InvestorMatchInput,
  facts: InvestorMandateFact[],
) {
  const range = input.goal.desiredCheck;
  const desired =
    criterion === 'check_size'
      ? range
        ? `${range.currency} ${range.min}–${range.max} per investor`
        : 'Unknown individual check range'
      : criterion === 'stage'
        ? input.goal.round
        : criterion === 'sector'
          ? input.goal.sector
          : input.goal.geography;
  const observations = facts
    .slice(0, 3)
    .map((fact) => {
      const values = fact.checkRange
        ? `${fact.checkRange.currency} ${fact.checkRange.min}–${fact.checkRange.max}`
        : fact.values.join(', ');
      return `${fact.stance === 'excludes' ? 'excludes' : 'includes'} ${values}`;
    })
    .join('; ');
  return `Goal: ${desired ?? 'Unknown'}. Sourced criteria: ${observations}${facts.length > 3 ? '; additional sources remain in the source manifest' : ''}.`.slice(
    0,
    2200,
  );
}
function resultFor(
  criterion: InvestorMatchCriterion,
  input: InvestorMatchInput,
): InvestorMatchCriterionResult {
  const facts = input.facts.filter((fact) => fact.criterion === criterion);
  const result = (
    state: InvestorMatchCriterionResult['state'],
    reason: string,
    value: InvestorMatchCriterionResult['result'] = null,
    exclusion = false,
  ): InvestorMatchCriterionResult => ({
    criterion,
    weight: weights[criterion],
    state,
    result: value,
    reason,
    factIds: facts.map((fact) => fact.id),
    explicitExclusion: exclusion,
  });
  if (criterion === 'preferences' && !input.goal.preferences.length)
    return result(
      'not_applicable',
      'No structured optional investor preferences selected. Free-text priorities remain qualitative.',
    );
  const desired =
    criterion === 'stage'
      ? input.goal.round
      : criterion === 'check_size'
        ? input.goal.desiredCheck
        : criterion === 'preferences'
          ? input.goal.preferences
          : input.goal[criterion];
  if (!desired || desired === '' || desired === 'Not confirmed')
    return result('unknown', 'The relevant goal input has not been confirmed.');
  const attributed = facts.filter(
    (fact) =>
      fact.subjectKey === input.identity.subjectKey &&
      fact.attribution === 'explicit' &&
      eligibleScope(fact),
  );
  // Supersession must be explicit, same subject/criterion, and effective now. Recency alone is insufficient.
  const effective = attributed.filter(
    (fact) => !fact.validFrom || Date.parse(fact.validFrom) <= Date.parse(input.now),
  );
  const superseded = new Set(
    effective.flatMap((fact) => fact.supersedesFactIds.filter((id) => id !== fact.id)),
  );
  const retained = effective.filter((fact) => !superseded.has(fact.id));
  const current = retained.filter((fact) => Date.parse(deadline(fact)) > Date.parse(input.now));
  if (!current.length)
    return retained.length
      ? result(
          'outdated',
          'Supported mandate facts require review because their validity or 180-day review deadline has passed.',
        )
      : result(
          'unknown',
          'No current, explicitly attributed mandate supports this criterion. Historical investments and unreviewed identities do not establish eligibility.',
        );
  const outcomes = current.map((fact) => ({ fact, ...factOutcome(fact, input) }));
  const supported = outcomes.filter((outcome) => outcome.result !== null);
  const exclusion =
    (criterion === 'stage' || criterion === 'geography') &&
    supported.some((outcome) => outcome.exclusion);
  if (criterion === 'preferences') {
    const groups = input.goal.preferences.map((preference) => {
      const group = supported.filter((value) => value.fact.preferenceKey === preference.key);
      return { preference, values: new Set(group.map((value) => value.result)) };
    });
    if (groups.some((group) => group.values.size > 1))
      return result(
        'conflict',
        'Current sources disagree about a structured investor preference. Resolve the sourced conflict before scoring.',
      );
    if (groups.some((group) => !group.values.size))
      return result(
        'unknown',
        'At least one selected structured preference has no supported corresponding fact.',
      );
    const matched = groups.filter((group) => group.values.has('1'));
    if (matched.length === groups.length)
      return result(
        'match',
        'All selected structured preferences have corresponding sourced support.',
        '1',
      );
    if (groups.some((group) => group.preference.required && group.values.has('0')))
      return result(
        'mismatch',
        'A required structured preference differs from the stated investor facts.',
        '0',
      );
    return matched.length
      ? result(
          'partial',
          'Some non-required preferences match and others differ; partial credit follows the versioned rubric.',
          '0.5',
        )
      : result(
          'mismatch',
          'The supported structured preferences differ from the selected choices.',
          '0',
        );
  }
  if (
    new Set(supported.map((outcome) => outcome.result)).size > 1 ||
    (criterion === 'check_size' ? incompatibleRanges(current) : incompatibleCategories(current))
  )
    return result(
      'conflict',
      `Current attributed sources conflict. A newer source does not automatically supersede the earlier fact. ${describeCriterion(criterion, input, current)}`,
      null,
      exclusion,
    );
  const outcome = supported[0];
  if (!outcome)
    return result(
      'unknown',
      criterion === 'check_size'
        ? 'No comparable individual check range in the same known currency. Round totals are not individual checks.'
        : 'The source does not explicitly establish eligibility for this goal value.',
    );
  return result(
    outcome.result === '1' ? 'match' : 'mismatch',
    outcome.result === '1'
      ? `Current attributed facts support this goal criterion under the documented taxonomy. ${describeCriterion(
          criterion,
          input,
          supported.map((value) => value.fact),
        )}`
      : exclusion
        ? `The stated mandate explicitly excludes this goal criterion. ${describeCriterion(
            criterion,
            input,
            supported.map((value) => value.fact),
          )}`
        : `The stated criteria differ from the confirmed goal input. ${describeCriterion(
            criterion,
            input,
            supported.map((value) => value.fact),
          )}`,
    outcome.result,
    exclusion,
  );
}

/** Pure assessment of saved source facts; this function performs no I/O or provider work. */
export function assessInvestorMatch(value: InvestorMatchInput): InvestorMatchAssessment {
  const input = investorMatchInputSchema.parse(value);
  const results = criteria.map((criterion) => resultFor(criterion, input));
  const applicableWeight = results
    .filter((result) => result.state !== 'not_applicable')
    .reduce((sum, result) => sum.plus(result.weight), new Decimal(0));
  const supported = results.filter((result) => result.result !== null);
  const supportedWeight = supported.reduce(
    (sum, result) => sum.plus(result.weight),
    new Decimal(0),
  );
  const weightedResult = supported.reduce(
    (sum, result) => sum.plus(new Decimal(result.weight).times(result.result ?? '0')),
    new Decimal(0),
  );
  const coverage = supportedWeight.div(applicableWeight);
  const hasExclusion = results.some((result) => result.explicitExclusion);
  const hasConflict = results.some((result) => result.state === 'conflict');
  const eligibilitySupported = results
    .filter((result) => result.criterion === 'stage' || result.criterion === 'geography')
    .every((result) => result.result !== null);
  const attributed = input.facts.filter(
    (fact) => fact.subjectKey === input.identity.subjectKey && fact.attribution === 'explicit',
  );
  const identityConfirmed = input.identity.status === 'confirmed' && attributed.some(eligibleScope);
  const status = hasExclusion
    ? 'outside_mandate'
    : identityConfirmed && eligibilitySupported && coverage.gte('0.7') && !hasConflict
      ? 'scored'
      : 'needs_verification';
  const unknowns = results
    .filter((result) => ['unknown', 'conflict', 'outdated'].includes(result.state))
    .map((result) => `${result.criterion}: ${result.reason}`);
  if (!identityConfirmed)
    unknowns.unshift(
      'Investor identity needs explicit source attribution and review. Similar names are insufficient.',
    );
  const superseded = new Set(
    attributed
      .filter(
        (fact) =>
          eligibleScope(fact) &&
          (!fact.validFrom || Date.parse(fact.validFrom) <= Date.parse(input.now)),
      )
      .flatMap((fact) => fact.supersedesFactIds),
  );
  const deadlines = attributed
    .filter(eligibleScope)
    .filter(
      (fact) => !superseded.has(fact.id) && Date.parse(deadline(fact)) > Date.parse(input.now),
    )
    .map(deadline)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return investorMatchAssessmentSchema.parse({
    rubricVersion: investorMatchRubricVersion,
    taxonomyVersion: investorMatchTaxonomyVersion,
    assessedAt: input.now,
    inputHash: investorMatchInputHash(input),
    goalHash: hash(semanticGoal(input.goal)),
    factsHash: hash(semanticFacts(input.facts)),
    identityHash: hash(input.identity),
    status,
    score:
      status === 'scored'
        ? weightedResult.div(supportedWeight).times(10).toFixed(1, Decimal.ROUND_HALF_UP)
        : null,
    coverage: coverage.toString(),
    applicableWeight: applicableWeight.toString(),
    supportedWeight: supportedWeight.toString(),
    weightedResult: weightedResult.toString(),
    criteria: results,
    sources: attributed.map((fact) => fact.source),
    nextReviewAt: deadlines[0] ?? null,
    unknowns,
  });
}

/** Legacy observations are intentionally never promoted to mandate facts. */
export function matchFactsFromEvidence(
  evidence: Evidence[],
  identity: InvestorMatchInput['identity'],
): InvestorMandateFact[] {
  return evidence.flatMap((record) =>
    (record.mandateFacts ?? [])
      .filter((fact) => fact.subjectKey === identity.subjectKey && fact.attribution === 'explicit')
      .map((fact) =>
        investorMandateFactSchema.parse({
          ...fact,
          source: {
            ...fact.source,
            evidenceId: record.id,
            researchRunId: record.researchRunId ?? null,
            url: record.url,
            publishedAt: record.publishedAt,
            retrievedAt: record.discoveredAt,
            fictional: record.mode === 'demo',
          },
        }),
      ),
  );
}
