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
      strengths: checks
        .filter((check) => check.support === 'supported')
        .slice(0, 3)
        .map((check) => {
          const claim = extraction.claims.find((item) => item.id === check.claimId);
          if (!claim) throw new Error('Missing strength fixture claim');
          return {
            statement: 'You accurately stated the saved operating result.',
            significance:
              'This anchors the discussion in the operating result rather than treating net income as evidence of operating profitability. It demonstrates factual accuracy; the answer alone does not explain the drivers of the loss.',
            claimIds: [claim.id],
            turnIds: [claim.turnId],
          };
        }),
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
            analysis: {
              financialInterpretation:
                'The cited figure does not match the operating income line in the saved statement. Operating income and net income answer different questions: a credit can affect the net result without establishing that core operations are profitable. The income statement alone does not establish cash burn.',
              investorImplication:
                'This distinction matters when assessing whether reported earnings reflect sustainable operating performance. A diligence discussion may ask for a reconciliation and evidence about the nature of any credit; its recurrence and cash timing remain unverified.',
              preparationSteps: [
                'Prepare a reconciliation from the saved operating result through other income to net income, with the original source rows.',
                'Obtain documentation for any credit, including recognition basis, recurrence and expected cash receipt; identify what remains unconfirmed.',
                'If cash runway is discussed, bring the cash balance, cash-flow statement and timing of obligations; the income statement does not establish runway.',
              ],
            },
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
