import {
  scenarioOutputSchema,
  type ScenarioInput,
  type ScenarioOutput,
  type ScenarioSelection,
  type ScenarioGenerationView,
} from '../contracts/Scenario.js';
import {
  createEmptyPracticeContext,
  practiceContextSchema,
  type PracticeContext,
} from '../contracts/PracticeContext.js';
import type { Workspace } from '../contracts/Workspace.js';
import {
  assembleScenarioInput,
  hashValue,
  scenarioInputHash,
  scenarioReviewHash,
} from './ScenarioSources.js';
import {
  SCENARIO_PROMPT_VERSION,
  SCENARIO_VOICE_INSTRUCTION,
  scenarioDataPrompt,
} from '../prompts/ScenarioPrompt.js';
import type { ScenarioStore } from './ScenarioStore.js';
import { ConflictError, type ClaimedJob } from './WorkspaceStore.js';

export interface ScenarioGenerator {
  readonly mode: 'demo' | 'live';
  readonly model: string;
  generate(input: ScenarioInput): Promise<ScenarioOutput>;
}

export function validateScenarioOutput(raw: unknown, input: ScenarioInput): ScenarioOutput {
  const output = scenarioOutputSchema.parse(raw);
  const sourceIds = new Set(input.sources.map((source) => source.id));
  const researchIds = new Set(
    input.sources
      .filter((source) => source.kind === 'investor_research')
      .map((source) => source.id),
  );
  const insights = [
    ...output.investorProfile.themes,
    ...output.investorProfile.practiceApproach,
    ...output.scenarios.flatMap((scenario) => scenario.rationale),
  ];
  if (insights.some((insight) => insight.sourceIds.some((id) => !sourceIds.has(id))))
    throw new Error('Scenario contains unknown source references.');
  if (
    output.investorProfile.themes.some(
      (theme) => !theme.sourceIds.some((id) => researchIds.has(id)),
    )
  )
    throw new Error('Investor themes require investor research.');
  if (output.investorProfile.practiceApproach.some((item) => item.kind !== 'hypothesis'))
    throw new Error('Practice approaches must be labeled hypotheses.');
  if (new Set(output.scenarios.map((scenario) => scenario.id)).size !== output.scenarios.length)
    throw new Error('Scenario IDs must be unique.');
  for (const scenario of output.scenarios) {
    if (
      scenario.personalization === 'research_grounded' &&
      !scenario.rationale.some((item) => item.sourceIds.some((id) => researchIds.has(id)))
    )
      throw new Error('Personalized scenarios require investor research.');
  }
  return output;
}

export class ScenarioService {
  constructor(
    readonly store: ScenarioStore,
    private readonly readWorkspace: () => Promise<Workspace>,
    readonly generator: ScenarioGenerator,
  ) {}

  async preview(investorId: string, objective: string) {
    const input = assembleScenarioInput(await this.readWorkspace(), investorId, objective);
    const previous = await this.store.listGenerations(investorId);
    input.previousScenarios = previous
      .flatMap((item) => item.output?.scenarios ?? [])
      .slice(0, 12)
      .map((item) => ({ title: item.title, objective: item.objective.slice(0, 300) }));
    scenarioDataPrompt(input);
    return {
      input,
      inputHash: scenarioReviewHash(input),
      mode: this.generator.mode,
      model: this.generator.model,
    };
  }

  async create(investorId: string, objective: string, key: string, expectedInputHash?: string) {
    const requestHash = hashValue({
      investorId,
      objective,
      ...(expectedInputHash ? { expectedInputHash } : {}),
    });
    const existing = await this.store.getGenerationByRequestKey(key);
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ConflictError('Request key reused with different scenario inputs.');
      return existing;
    }
    const preview = await this.preview(investorId, objective);
    if (expectedInputHash && expectedInputHash !== preview.inputHash)
      throw new ConflictError(
        'Your data changed since review. Refresh the source preview before generating.',
      );
    return this.store.createGeneration(key, {
      input: preview.input,
      inputHash: scenarioInputHash(preview.input),
      requestHash,
      promptVersion: SCENARIO_PROMPT_VERSION,
      model: this.generator.model,
      mode: this.generator.mode,
    });
  }

  async get(id: string): Promise<ScenarioGenerationView> {
    const generation = await this.store.getGeneration(id);
    if (!generation) throw new Error('Scenario unavailable. Choose a saved generation.');
    const state = await this.readWorkspace();
    const investorExists = state.investors.some((item) => item.id === generation.input.investor.id);
    const outdated =
      !investorExists ||
      scenarioInputHash(
        assembleScenarioInput(state, generation.input.investor.id, generation.input.objective),
      ) !== generation.inputHash;
    return { ...generation, outdated };
  }

  async list(investorId: string): Promise<ScenarioGenerationView[]> {
    const generations = await this.store.listGenerations(investorId);
    const state = await this.readWorkspace();
    return generations.map((generation) => ({
      ...generation,
      outdated:
        scenarioInputHash(assembleScenarioInput(state, investorId, generation.input.objective)) !==
        generation.inputHash,
    }));
  }

  async run(job: ClaimedJob): Promise<void> {
    const generation = await this.store.getGenerationForJob(job.id);
    if (!generation) throw new Error('Scenario generation unavailable.');
    if (generation.output) return;
    if (
      generation.promptVersion !== SCENARIO_PROMPT_VERSION ||
      generation.mode !== this.generator.mode ||
      generation.model !== this.generator.model
    )
      throw new Error('Scenario runtime changed. Generate again with the current configuration.');
    const output = validateScenarioOutput(
      await this.generator.generate(generation.input),
      generation.input,
    );
    await this.store.completeGeneration(job, output);
  }

  async loadContext(selection?: ScenarioSelection): Promise<PracticeContext> {
    if (!selection) return createEmptyPracticeContext();
    const generation = await this.store.getGeneration(selection.generationId);
    const scenario = generation?.output?.scenarios.find((item) => item.id === selection.scenarioId);
    if (!generation || generation.status !== 'succeeded' || !scenario || !generation.output)
      throw new Error('Scenario unavailable. Choose a completed scenario.');
    const founder = generation.input.sources.find((source) => source.kind === 'founder_initial');
    return practiceContextSchema.parse({
      ...createEmptyPracticeContext(),
      version: 2,
      mode: 'provided',
      company: founder
        ? { name: founder.company.name, description: '', fundraisingGoal: founder.company.goal }
        : null,
      selection,
      scenario,
      investorProfile: generation.output.investorProfile,
      input: generation.input,
      generationMode: generation.mode,
      instruction: SCENARIO_VOICE_INSTRUCTION,
    });
  }
}
