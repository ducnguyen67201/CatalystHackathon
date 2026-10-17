import { describe, expect, it } from 'vitest';
import {
  followupObjective,
  preparationScenarioHref,
} from '../src/contracts/PreparationNavigation.js';

describe('feedback to scenario navigation', () => {
  it('carries the feedback, question and evidence needs into a safely encoded editable objective', () => {
    const objective = followupObjective({
      title: 'Explain operating income & credits.',
      practiceQuestion: 'What changed?',
      missingInputs: ['Cash balance', 'Credit documentation'],
    });
    const url = new URL(preparationScenarioHref(objective, 'investor-1'), 'http://127.0.0.1');
    expect(url.pathname).toBe('/scenarios');
    expect(url.searchParams.get('objective')).toBe(
      'Explain operating income & credits. What changed? Evidence to gather: Cash balance; Credit documentation',
    );
    expect(url.searchParams.get('investor')).toBe('investor-1');
    expect(url.searchParams.has('generationId')).toBe(false);
  });
  it('respects the editable objective limit and leaves investor selection open when absent', () => {
    const url = new URL(preparationScenarioHref('x'.repeat(1200)), 'http://127.0.0.1');
    expect(url.searchParams.get('objective')).toHaveLength(1000);
    expect(url.searchParams.has('investor')).toBe(false);
    expect(
      followupObjective({
        title: 'Explain your margin.',
        practiceQuestion: 'What is missing?',
        missingInputs: [],
      }),
    ).toBe('Explain your margin. What is missing?');
  });
});
