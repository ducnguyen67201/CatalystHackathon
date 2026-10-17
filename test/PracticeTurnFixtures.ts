import type { PracticeTurnProvider } from '../src/features/PracticeTurnProvider.js';

/** Fictional provider double: never imported by runtime application code. */
export const fixtureTurnProvider: PracticeTurnProvider = {
  model: 'test-practice-model',
  generate: (input) => {
    const latest = input.evaluation.turns.findLast((turn) => turn.role === 'user');
    const claims = input.extraction.claims.filter(
      (claim) => claim.turnId === latest?.id && !claim.supersededByTurnId,
    );
    const checks = input.checks.filter((check) =>
      claims.some((claim) => claim.id === check.claimId),
    );
    const contradiction = checks.find((check) => check.support === 'contradicted');
    const factIds = contradiction?.factIds ?? [];
    const sourceIds = [
      ...new Set(
        input.evaluation.context.facts
          .filter((fact) => factIds.includes(fact.id))
          .flatMap((fact) => fact.sourceIds),
      ),
    ];
    return Promise.resolve({
      decision: contradiction ? 'correct' : 'keep',
      gap: contradiction ? 'The operating result differs from the claimed figure.' : '',
      reply: contradiction
        ? `The saved operating result is {{fact:${factIds[0] ?? ''}}}. Explain it separately from net income.`
        : 'That identifies what is known. Let’s stay with the evidence.',
      question: 'What evidence supports your explanation?',
      why: {
        brief: 'This question asks you to connect the explanation to supporting evidence.',
        explanation: 'Explain the sourced operating result without assuming its causes.',
        answerObjective: 'Separate saved facts from assumptions.',
        sourceIds,
        missingInputs: [],
      },
      claimIds: claims.map((claim) => claim.id),
      factIds,
      investorSourceIds: [],
      resolvedFindingIds: [],
    });
  },
};
