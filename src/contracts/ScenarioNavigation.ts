import { scenarioSelectionSchema, type ScenarioSelection } from './Scenario.js';

export type ScenarioRoute =
  { kind: 'open' } | { kind: 'invalid' } | { kind: 'scenario'; selection: ScenarioSelection };

export function readScenarioRoute(search: string): ScenarioRoute {
  const params = new URLSearchParams(search);
  const generations = params.getAll('generationId');
  const scenarios = params.getAll('scenarioId');
  if (!generations.length && !scenarios.length) return { kind: 'open' };
  if (generations.length !== 1 || scenarios.length !== 1) return { kind: 'invalid' };
  const parsed = scenarioSelectionSchema.safeParse({
    generationId: generations[0],
    scenarioId: scenarios[0],
  });
  return parsed.success ? { kind: 'scenario', selection: parsed.data } : { kind: 'invalid' };
}

export function practiceHref(selection: ScenarioSelection): string {
  return '/practice?' + new URLSearchParams(scenarioSelectionSchema.parse(selection)).toString();
}
