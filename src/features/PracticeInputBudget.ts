import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';
import type { TranscriptTurn } from '../contracts/Workspace.js';
import type { EvaluationInput } from './EvaluationProvider.js';

export const PRACTICE_INPUT_LIMIT = 100000;
// Reply and question each allow 2,000 characters, joined by two newlines.
// NUL reserves the worst JSON escaping cost of each possible output character.
const reservedNextTurn = '\u0000'.repeat(4002);

export function buildPracticeInput(
  sessionId: string,
  context: EvaluationContext,
  turns: TranscriptTurn[],
): EvaluationInput {
  return {
    context,
    scope: 'partial',
    clarification: null,
    previous: null,
    turns: turns.map((turn, index) => ({ ...turn, id: `${sessionId}:turn:${index}` })),
  };
}

/** Check before accepting an answer, including room for the largest validated reply. */
export function practiceAnswerFits(
  sessionId: string,
  context: EvaluationContext,
  turns: TranscriptTurn[],
  answer: string,
): boolean {
  return (
    JSON.stringify(
      buildPracticeInput(sessionId, context, [
        ...turns,
        { role: 'user', text: answer },
        { role: 'agent', text: reservedNextTurn },
      ]),
    ).length <= PRACTICE_INPUT_LIMIT
  );
}
