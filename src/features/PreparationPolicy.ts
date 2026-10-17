import { practiceTurnOutputSchema, type PracticeTurnOutput } from '../contracts/GuidedPractice.js';
import type { PracticeTurnInput } from './PracticeTurnProvider.js';

/** Resolve references and render only saved numbers; semantic relevance remains model-proposed. */
export function validatePracticeTurn(raw: unknown, input: PracticeTurnInput): PracticeTurnOutput {
  const output = practiceTurnOutputSchema.parse(raw);
  const { context, turns } = input.evaluation;
  const latest = turns.findLast((turn) => turn.role === 'user');
  const claims = output.claimIds.map((id) => {
    const claim = input.extraction.claims.find((candidate) => candidate.id === id);
    if (!claim || claim.turnId !== latest?.id || claim.supersededByTurnId)
      throw new Error('Invalid current-answer claim reference.');
    return claim;
  });
  for (const id of output.why.sourceIds)
    if (!context.sources.some((source) => source.id === id))
      throw new Error('Unknown practice source.');
  for (const id of output.investorSourceIds)
    if (
      !output.why.sourceIds.includes(id) ||
      !context.sources.some((source) => source.id === id && source.kind === 'investor')
    )
      throw new Error('Invalid investor attribution.');
  const facts = output.factIds.map((id) => {
    const fact = context.facts.find((candidate) => candidate.id === id);
    if (!fact || fact.sourceIds.some((sourceId) => !output.why.sourceIds.includes(sourceId)))
      throw new Error('Uncited practice fact.');
    return fact;
  });
  if (
    output.resolvedFindingIds.some(
      (id) => !input.extraction.claims.some((claim) => claim.id === id),
    )
  )
    throw new Error('Unknown resolved finding.');
  const latestClaims = input.extraction.claims.filter(
    (claim) => claim.turnId === latest?.id && !claim.supersededByTurnId,
  );
  const contradictions = input.checks.filter(
    (check) =>
      latestClaims.some((claim) => claim.id === check.claimId) && check.support === 'contradicted',
  );
  if (
    contradictions.length &&
    (output.decision !== 'correct' ||
      contradictions.some(
        (check) =>
          !output.claimIds.includes(check.claimId) ||
          check.factIds.some((id) => !output.factIds.includes(id)),
      ))
  )
    throw new Error('Contradiction requires a cited correction.');
  if (
    output.decision === 'pivot' &&
    (!output.gap.trim() || !claims.length || (!facts.length && !output.why.missingInputs.length))
  )
    throw new Error('A pivot requires a specific evidenced gap.');
  if (output.decision === 'request_evidence' && !output.why.missingInputs.length)
    throw new Error('Missing evidence requires an input checklist.');
  if (output.decision === 'correct' && !facts.length)
    throw new Error('A correction needs saved facts.');
  if (output.decision === 'keep' && output.gap.trim())
    throw new Error('Keep cannot introduce an unsupported gap.');
  const render = (value: string): string => {
    const placeholders = /\{\{fact:([^{}]+)\}\}/g;
    if (/\d/.test(value.replace(placeholders, '')))
      throw new Error('Use cited fact placeholders for numerical assertions.');
    const rendered = value.replace(placeholders, (_match: string, id: string) => {
      const fact = facts.find((candidate) => candidate.id === id);
      if (!fact) throw new Error('Unknown practice fact placeholder.');
      return `${fact.value} (${fact.unit === 'unspecified' ? 'currency unconfirmed' : fact.unit}, ${fact.period})`;
    });
    if (/[{}]/.test(rendered)) throw new Error('Unresolved practice placeholder.');
    return rendered;
  };
  return practiceTurnOutputSchema.parse({
    ...output,
    gap: render(output.gap),
    reply: render(output.reply),
    question: render(output.question),
    why: {
      ...output.why,
      brief: render(output.why.brief),
      explanation: render(output.why.explanation),
      answerObjective: render(output.why.answerObjective),
      missingInputs: output.why.missingInputs.map(render),
    },
  });
}
