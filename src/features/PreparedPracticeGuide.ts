import { practiceAnswerGuideSchema } from '../contracts/PracticeAnswerGuide.js';
import type { GeneratedScenario, ScenarioInput } from '../contracts/Scenario.js';

/** Derives a read-only aid from the frozen generation input; creates no practice or progress. */
export function buildPracticeAnswerGuide(
  input: Pick<ScenarioInput, 'preparation'> & Partial<Pick<ScenarioInput, 'sources'>>,
  scenario: Pick<GeneratedScenario, 'successCriteria'>,
) {
  const prepared = input.preparation;
  if (!prepared) return null;
  return practiceAnswerGuideSchema.parse({
    text: prepared.pitch,
    basis: 'approved_story',
    pitchId: prepared.pitchId,
    sourceIds: prepared.sources.map((source) => source.id),
    fictional:
      prepared.fictional ||
      prepared.sources.some((source) => source.fictional) ||
      (input.sources?.some((source) => source.provenance === 'fictional_demo') ?? false),
    checkpoints: scenario.successCriteria,
  });
}
