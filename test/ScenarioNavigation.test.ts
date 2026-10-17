import { describe, expect, it } from 'vitest';
import { practiceHref, readScenarioRoute } from '../src/contracts/ScenarioNavigation.js';

describe('saved scenario navigation', () => {
  const selection = {
    generationId: 'af3d5c70-f34b-4a51-8796-76fae5e7a222',
    scenarioId: 'explain-your-company',
  };
  it('preserves the exact saved selection across navigation and reload', () => {
    const url = new URL(practiceHref(selection), 'http://127.0.0.1');
    expect(url.pathname).toBe('/practice');
    expect(readScenarioRoute(url.search)).toEqual({ kind: 'scenario', selection });
  });
  it('allows an explicit open conversation with no scenario parameters', () => {
    expect(readScenarioRoute('')).toEqual({ kind: 'open' });
  });
  it.each([
    '?scenarioId=example',
    '?generationId=' + selection.generationId,
    '?generationId=bad&scenarioId=example',
    '?generationId=' + selection.generationId + '&scenarioId=../../bad',
    '?generationId=' + selection.generationId + '&scenarioId=one&scenarioId=two',
  ])(
    'rejects invalid or ambiguous links instead of falling back to open practice: %s',
    (search) => {
      expect(readScenarioRoute(search)).toEqual({ kind: 'invalid' });
    },
  );
});
