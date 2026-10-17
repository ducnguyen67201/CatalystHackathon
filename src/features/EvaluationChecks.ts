import { Decimal } from 'decimal.js';
import {
  coachingGenerationSchema,
  extractionSchema,
  type Coaching,
  type EvidenceCheck,
  type Extraction,
} from '../contracts/RehearsalEvaluation.js';
import type { EvaluationInput } from './EvaluationProvider.js';

function numbers(text: string): string[] {
  return (text.replaceAll(',', '').match(/-?\d+(?:\.\d+)?/g) ?? []).map((n) =>
    new Decimal(n).toFixed(),
  );
}
export function validateExtraction(raw: unknown, input: EvaluationInput): Extraction {
  const result = extractionSchema.parse(raw);
  if (new Set(result.claims.map((c) => c.id)).size !== result.claims.length)
    throw new Error('Duplicate claim identifiers.');
  for (const claim of result.claims) {
    const index = input.turns.findIndex((t) => t.id === claim.turnId);
    const turn = input.turns[index];
    if (!turn || turn.role !== 'user' || !turn.text.includes(claim.quote))
      throw new Error('Invalid claim quotation.');
    if (claim.value !== null && !numbers(claim.quote).includes(new Decimal(claim.value).toFixed()))
      throw new Error('Unstated claim value.');
    if (
      claim.questionTurnId !== null &&
      !input.turns.slice(0, index).some((t) => t.id === claim.questionTurnId && t.role === 'agent')
    )
      throw new Error('Invalid question reference.');
    if (
      claim.supersededByTurnId !== null &&
      !input.turns
        .slice(index + 1)
        .some((t) => t.id === claim.supersededByTurnId && t.role === 'user')
    )
      throw new Error('Invalid correction reference.');
  }
  for (const focus of result.focusAreas)
    if (focus.turnIds.some((id) => !input.turns.some((t) => t.id === id && t.role === 'user')))
      throw new Error('Invalid focus reference.');
  return result;
}
export function checkClaims(extraction: Extraction, input: EvaluationInput): EvidenceCheck[] {
  return extraction.claims.map((claim): EvidenceCheck => {
    const base = { claimId: claim.id, factIds: [] };
    if (claim.supersededByTurnId || claim.kind !== 'actual')
      return {
        ...base,
        support: 'not_checked',
        explanation: 'Corrected or non-actual claim; not compared to historical actuals.',
      };
    if (claim.metric === null || claim.value === null)
      return {
        ...base,
        support: 'insufficient_evidence',
        explanation: 'No explicit comparable numerical claim. Interpret reasoning cautiously.',
      };
    if (claim.period === null || claim.unit === null)
      return {
        ...base,
        support: 'ambiguous',
        explanation: 'The reporting period or unit is unclear; clarify before comparing.',
      };
    const facts = input.context.facts.filter(
      (f) => f.metric === claim.metric && f.period === claim.period && f.unit === claim.unit,
    );
    const fact = facts.length === 1 ? facts[0] : undefined;
    if (!fact)
      return {
        ...base,
        support: 'insufficient_evidence',
        explanation: 'No unique matching metric, reporting period and unit in the frozen evidence.',
      };
    const equal = new Decimal(fact.value).eq(claim.value);
    return {
      ...base,
      factIds: [fact.id],
      support: equal ? 'supported' : 'contradicted',
      explanation: equal
        ? 'The stated value matches the selected source for this metric, period and unit.'
        : 'The stated value differs from the selected source for this metric, period and unit.',
    };
  });
}
export function validateCoaching(
  raw: unknown,
  extraction: Extraction,
  input: EvaluationInput,
  checks: EvidenceCheck[],
): Coaching {
  const result = coachingGenerationSchema.parse(raw);
  for (const strength of result.strengths) {
    const claims = strength.claimIds.map((id) => extraction.claims.find((c) => c.id === id));
    if (
      claims.some(
        (claim) =>
          !claim ||
          claim.supersededByTurnId ||
          !strength.turnIds.includes(claim.turnId) ||
          checks.find((check) => check.claimId === claim.id)?.support === 'contradicted',
      ) ||
      strength.turnIds.some(
        (id) =>
          !input.turns.some((turn) => turn.id === id && turn.role === 'user') ||
          !claims.some((claim) => claim?.turnId === id),
      )
    )
      throw new Error('Invalid strength evidence.');
    if (numbers(`${strength.statement} ${strength.significance}`).length)
      throw new Error('Uncited strength value.');
  }
  if (new Set(result.items.map((i) => i.id)).size !== result.items.length)
    throw new Error('Duplicate coaching identifiers.');
  for (const item of result.items) {
    const claim = extraction.claims.find((c) => c.id === item.claimId);
    if (!claim || claim.supersededByTurnId) throw new Error('Invalid coaching claim.');
    for (const id of item.sourceIds)
      if (!input.context.sources.some((s) => s.id === id))
        throw new Error('Unknown evidence source.');
    for (const id of item.investorSourceIds)
      if (
        !item.sourceIds.includes(id) ||
        !input.context.sources.some((s) => s.id === id && s.kind === 'investor')
      )
        throw new Error('Invalid investor attribution.');
    const facts = item.factIds.map((id) => {
      const fact = input.context.facts.find((f) => f.id === id);
      if (!fact || fact.sourceIds.some((source) => !item.sourceIds.includes(source)))
        throw new Error('Uncited financial fact.');
      return fact;
    });
    if (
      checks.find((c) => c.claimId === claim.id)?.support === 'contradicted' &&
      !checks.find((c) => c.claimId === claim.id)?.factIds.every((id) => item.factIds.includes(id))
    )
      throw new Error('Contradiction lacks source facts.');
    const allowed = new Set([
      ...numbers(claim.quote),
      ...facts.flatMap((f) => [...numbers(f.value), ...numbers(f.period)]),
    ]);
    const prose = [
      item.establishes,
      item.gap,
      item.suggestion,
      item.exampleAnswer,
      item.clarificationQuestion,
      item.practiceQuestion,
      ...item.successCriteria,
      ...item.missingInputs,
      item.analysis.financialInterpretation,
      item.analysis.investorImplication,
      ...item.analysis.preparationSteps,
    ].join(' ');
    if (numbers(prose).some((value) => !allowed.has(value)))
      throw new Error('Unsupported numerical coaching claim.');
  }
  // Summaries and comparisons intentionally contain no numeric assertions: values belong in cited cards.
  if (
    numbers(result.summary).length ||
    (result.comparison && numbers(result.comparison.explanation).length)
  )
    throw new Error('Uncited summary value.');
  if (
    result.comparison &&
    (!input.previous ||
      result.comparison.turnIds.some(
        (id) => !input.turns.some((t) => t.id === id && t.role === 'user'),
      ) ||
      (result.comparison.outcome === 'improved' && !result.comparison.turnIds.length))
  )
    throw new Error('Invalid comparison evidence.');
  return result;
}
