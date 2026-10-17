import { describe, expect, it } from 'vitest';
import { evidenceFixture } from './EvidenceReviewFixtures.js';
import {
  buildPracticeInput,
  practiceAnswerFits,
  PRACTICE_INPUT_LIMIT,
} from '../src/features/PracticeInputBudget.js';
import type { TranscriptTurn } from '../src/contracts/Workspace.js';

describe('guided session input budget', () => {
  it('reserves a worst-case escaped next turn before an answer is accepted', () => {
    const { context } = evidenceFixture();
    const turns: TranscriptTurn[] = [{ role: 'agent', text: 'Explain the result.' }];
    while (
      practiceAnswerFits(
        'session',
        context,
        [...turns, { role: 'agent', text: 'x'.repeat(3000) }],
        'x',
      )
    )
      turns.push({ role: 'agent', text: 'x'.repeat(3000) });
    expect(practiceAnswerFits('session', context, turns, 'x')).toBe(true);
    expect(practiceAnswerFits('session', context, turns, '\u0000'.repeat(3000))).toBe(false);
    const finalTurns: TranscriptTurn[] = [
      ...turns,
      { role: 'user', text: 'x' },
      { role: 'agent', text: '\u0000'.repeat(4002) },
    ];
    expect(
      JSON.stringify(buildPracticeInput('session', context, finalTurns)).length,
    ).toBeLessThanOrEqual(PRACTICE_INPUT_LIMIT);
    expect(JSON.stringify({ context, turns: finalTurns }).length).toBeLessThanOrEqual(
      PRACTICE_INPUT_LIMIT,
    );
  });
  it('rejects a source context that cannot fit even a minimal answer and next turn', () => {
    const { context } = evidenceFixture();
    context.sources.push(
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `large-${index}`,
        kind: 'company' as const,
        title: 'Fictional context',
        text: 'x'.repeat(16000),
        url: null,
        recordedAt: null,
        origin: 'founder' as const,
      })),
    );
    expect(practiceAnswerFits('session', context, [], 'x')).toBe(false);
  });
});
