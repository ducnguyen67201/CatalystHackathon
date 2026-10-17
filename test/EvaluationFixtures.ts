import type { EvaluationProvider } from '../src/features/EvaluationProvider.js';
import type { Extraction } from '../src/contracts/RehearsalEvaluation.js';

/** Canned fictional model responses for tests only; never imported by application code. */
const claims: Record<
  string,
  Pick<Extraction['claims'][number], 'metric' | 'value' | 'period' | 'unit' | 'kind'>
> = {
  'Our operating income is 122503 unspecified for 2026-07.': {
    metric: 'operating_income',
    value: '122503',
    period: '2026-07',
    unit: 'unspecified',
    kind: 'actual',
  },
  'Our operating income is -59797 unspecified for 2026-07.': {
    metric: 'operating_income',
    value: '-59797',
    period: '2026-07',
    unit: 'unspecified',
    kind: 'actual',
  },
  'Our ROAS is 4.2 unspecified for 2026-07.': {
    metric: 'roas',
    value: '4.2',
    period: '2026-07',
    unit: 'unspecified',
    kind: 'actual',
  },
  'Our operating income is 122503.': {
    metric: 'operating_income',
    value: '122503',
    period: null,
    unit: null,
    kind: 'actual',
  },
  'We forecast operating income of 122503 unspecified for 2026-07.': {
    metric: 'operating_income',
    value: '122503',
    period: '2026-07',
    unit: 'unspecified',
    kind: 'forecast',
  },
};
export const fixtureEvaluationProvider: EvaluationProvider = {
  model: 'test-fixture',
  extract: (input) =>
    Promise.resolve({
      claims: input.turns.flatMap((turn, index) => {
        const claim = claims[turn.text];
        return turn.role === 'user' && claim
          ? [
              {
                ...claim,
                id: `claim-${index}`,
                turnId: turn.id,
                questionTurnId:
                  input.turns.slice(0, index).findLast((t) => t.role === 'agent')?.id ?? null,
                quote: turn.text,
                supersededByTurnId: null,
                uncertainty: '',
              },
            ]
          : [];
      }),
      focusAreas: [],
    }),
  coach: (input, extraction, checks) =>
    Promise.resolve({
      summary: 'Fictional test response for the selected evidence.',
      items: checks
        .filter((c) => c.support === 'contradicted')
        .map((check) => {
          const fact = input.context.facts.find((f) => check.factIds.includes(f.id));
          if (!fact) throw new Error('Missing test fixture fact');
          return {
            id: 'item-operating',
            claimId: check.claimId,
            relevance: 'useful_but_incomplete' as const,
            establishes: 'You identified a financial metric.',
            gap: check.explanation,
            suggestion: 'Explain operations separately from net income.',
            sourceIds: fact.sourceIds,
            factIds: [fact.id],
            investorSourceIds: [],
            missingInputs: [],
            exampleAnswer: `The operating result was ${fact.value} for ${fact.period}.`,
            clarificationQuestion: 'What did you mean by profitability?',
            practiceQuestion: 'Explain operating income separately from net income.',
            successCriteria: ['Use the sourced operating result'],
          };
        }),
      comparison: input.previous
        ? {
            outcome: 'not_comparable' as const,
            explanation: 'Fixture response; reasoning quality is not assessed by the test stub.',
            turnIds: extraction.claims.map((c) => c.turnId),
          }
        : null,
    }),
};
