import { randomUUID } from 'node:crypto';
import {
  guidedAnswerRequestSchema,
  guidedStartSchema,
  guidedStateSchema,
  guidedTurnSchema,
  guidedViewSchema,
  type GuidedView,
} from '../contracts/GuidedPractice.js';
import { rehearsalSchema, type Rehearsal } from '../contracts/Workspace.js';
import type { WorkspaceService } from './WorkspaceService.js';
import type { PracticeTurnProvider } from './PracticeTurnProvider.js';
import { assembleEvaluationContext } from './EvaluationContextAssembler.js';
import { hashEvaluationInput, queueEvaluation } from './RehearsalEvaluationService.js';
import { validateExtraction, checkClaims } from './EvaluationChecks.js';
import {
  buildPracticeInput,
  practiceAnswerFits,
  PRACTICE_INPUT_LIMIT,
} from './PracticeInputBudget.js';
import { validatePracticeTurn } from './PreparationPolicy.js';
import { PRACTICE_TURN_VERSION } from '../prompts/PracticeTurnPrompt.js';
import { ConflictError, type ClaimedJob } from './WorkspaceStore.js';

export const guidedJobKind = (sessionId: string, answerId: string) =>
  `guided-turn:${sessionId}:${answerId}`;
function selectedSession(sessions: Rehearsal[], id: string) {
  const session = sessions.find((candidate) => candidate.id === id);
  if (!session?.guided || !session.evaluationContext)
    throw new Error('This practice session is unavailable.');
  return { session, guided: session.guided, context: session.evaluationContext };
}

/** Uses the existing small-workspace aggregate and its atomic receipt/job transactions. */
export class PracticeTurnService {
  constructor(
    private readonly service: WorkspaceService,
    private readonly provider?: PracticeTurnProvider,
  ) {}
  get ready() {
    return !!this.provider;
  }

  async start(raw: unknown): Promise<string> {
    const body = guidedStartSchema.parse(raw);
    const replay = (await this.service.read()).rehearsals.find(
      (session) => session.guided?.startKey === body.requestKey,
    );
    if (replay) {
      if (
        replay.context?.version !== 2 ||
        replay.context.selection.generationId !== body.generationId ||
        replay.context.selection.scenarioId !== body.scenarioId
      )
        throw new ConflictError('Start key reused with a different selection.');
      return replay.id;
    }
    if (!this.provider || !this.service.scenarios)
      throw new Error('This practice requires a configured model.');
    const practice = await this.service.scenarios.loadContext({
      generationId: body.generationId,
      scenarioId: body.scenarioId,
    });
    if (practice.version !== 2) throw new Error('Scenario unavailable.');
    const scenario = practice.scenario;
    const id = randomUUID();
    const questionId = randomUUID();
    const now = new Date().toISOString();
    return this.service.change((state) => {
      const existing = state.rehearsals.find(
        (session) => session.guided?.startKey === body.requestKey,
      );
      if (existing) {
        if (
          existing.context?.version !== 2 ||
          existing.context.selection.generationId !== body.generationId ||
          existing.context.selection.scenarioId !== body.scenarioId
        )
          throw new ConflictError('Start key reused with a different selection.');
        return existing.id;
      }
      if (state.rehearsals.filter((session) => session.status === 'active').length >= 3)
        throw new Error('End an active rehearsal before starting another.');
      const context = assembleEvaluationContext(state, practice);
      const why = scenario.openingWhy;
      const sourceIds = [
        ...new Set(
          (why?.sourceIds ?? scenario.rationale.flatMap((item) => item.sourceIds)).flatMap(
            (sourceId) => {
              const source = practice.input.sources.find((item) => item.id === sourceId);
              if (source?.kind === 'investor_research') return [`investor:${source.evidenceId}`];
              if (source?.kind === 'founder_initial') return ['company'];
              if (source?.kind === 'financials')
                return context.sources
                  .filter((item) => item.kind === 'financial')
                  .map((item) => item.id);
              return [];
            },
          ),
        ),
      ];
      const opening = guidedTurnSchema.parse({
        id: questionId,
        sequence: 0,
        answerId: null,
        createdAt: now,
        promptVersion: 'saved-scenario-opening',
        model: practice.generationMode === 'demo' ? 'saved-template' : 'saved-scenario',
        decision: 'keep',
        gap: '',
        reply: 'Let’s practise your selected scenario.',
        question: scenario.openingQuestion,
        why: why
          ? { ...why, sourceIds }
          : {
              brief:
                'This is the opening question saved with your scenario. Its preparation objective and source context are shown here.',
              explanation:
                'This older scenario has no question-level explanation. The saved scenario objective provides general preparation context, not a reconstruction of the model’s reasoning.',
              answerObjective: scenario.objective.slice(0, 1500),
              sourceIds,
              missingInputs: scenario.unknowns.map((item) => item.slice(0, 1500)),
            },
        factIds: [],
        claimIds: [],
        investorSourceIds: sourceIds.filter((sourceId) =>
          context.sources.some((item) => item.id === sourceId && item.kind === 'investor'),
        ),
        resolvedFindingIds: [],
        checks: [],
      });
      const openingTurns = [
        { role: 'agent' as const, text: `${opening.reply}\n\n${opening.question}` },
      ];
      if (!practiceAnswerFits(id, context, openingTurns, 'x'))
        throw new Error('This practice source context is too large. Choose a smaller scenario.');
      state.rehearsals.push(
        rehearsalSchema.parse({
          id,
          briefId: null,
          mode: 'text',
          status: 'active',
          createdAt: now,
          conversationId: null,
          turns: openingTurns,
          review: null,
          context: practice,
          evaluationContext: context,
          guided: guidedStateSchema.parse({
            version: 1,
            startKey: body.requestKey,
            revision: 0,
            contextHash: hashEvaluationInput(context),
            model: this.provider?.model,
            promptVersion: PRACTICE_TURN_VERSION,
            turns: [opening],
            answers: [],
            pending: null,
          }),
        }),
      );
      return id;
    });
  }

  async get(id: string): Promise<GuidedView> {
    const { session, guided, context } = selectedSession(
      (await this.service.read()).rehearsals,
      id,
    );
    const pending = guided.pending;
    const job = pending
      ? (await this.service.store.listJobs()).find(
          (item) => item.kind === guidedJobKind(id, pending.answerId),
        )
      : null;
    return guidedViewSchema.parse({
      id,
      status: session.status,
      createdAt: session.createdAt,
      transcriptReceivedAt: session.transcriptReceivedAt,
      guided,
      context,
      pendingStatus: pending
        ? job?.status === 'failed'
          ? 'failed'
          : job?.status === 'running'
            ? 'running'
            : 'queued'
        : null,
    });
  }

  async answer(id: string, raw: unknown): Promise<void> {
    const body = guidedAnswerRequestSchema.parse(raw);
    await this.service.change((state) => {
      const { session, guided, context } = selectedSession(state.rehearsals, id);
      const replay = guided.answers.find((answer) => answer.requestKey === body.requestKey);
      if (replay) {
        if (
          replay.text !== body.text ||
          replay.questionId !== body.questionId ||
          replay.expectedRevision !== body.expectedRevision
        )
          throw new ConflictError('Answer key reused with different inputs.');
        return;
      }
      if (
        !this.provider ||
        guided.model !== this.provider.model ||
        guided.promptVersion !== PRACTICE_TURN_VERSION
      )
        throw new Error('This practice model configuration changed. Start a new practice.');
      if (
        session.status !== 'active' ||
        guided.pending ||
        guided.revision !== body.expectedRevision ||
        guided.turns.at(-1)?.id !== body.questionId
      )
        throw new ConflictError('The question changed. Reload the current session.');
      if (guided.answers.length >= 24)
        throw new Error('Finish this practice before adding more answers.');
      if (!practiceAnswerFits(id, context, session.turns, body.text))
        throw new Error(
          'Finish this practice for review or shorten your answer. The session size limit would be exceeded.',
        );
      const answerId = randomUUID();
      guided.answers.push({ ...body, id: answerId, createdAt: new Date().toISOString() });
      guided.pending = { answerId, generation: 0 };
      guided.revision += 1;
      session.turns.push({ role: 'user', text: body.text });
    });
  }

  async retry(id: string, revision: number): Promise<void> {
    const view = await this.get(id);
    if (view.pendingStatus !== 'failed') return;
    await this.service.change((state) => {
      const { session, guided } = selectedSession(state.rehearsals, id);
      if (session.status !== 'active' || guided.revision !== revision || !guided.pending)
        throw new ConflictError('The practice changed.');
      guided.pending.generation += 1;
      guided.revision += 1;
    });
  }

  async finish(id: string, revision: number): Promise<void> {
    await this.service.change((state) => {
      const { session, guided } = selectedSession(state.rehearsals, id);
      if (session.status !== 'active') return;
      if (guided.revision !== revision) throw new ConflictError('The practice changed.');
      guided.pending = null;
      guided.revision += 1;
      session.status = 'completed';
      session.transcriptReceivedAt = new Date().toISOString();
      queueEvaluation(session, this.service.evaluations.provider);
    });
  }

  async run(id: string, answerId: string, job: ClaimedJob): Promise<void> {
    const { session, guided, context } = selectedSession(
      (await this.service.read()).rehearsals,
      id,
    );
    const pending = guided.pending;
    if (session.status !== 'active' || pending?.answerId !== answerId) {
      await this.service.change(() => undefined, job);
      return;
    }
    const provider = this.provider;
    if (
      !provider ||
      guided.model !== provider.model ||
      guided.promptVersion !== PRACTICE_TURN_VERSION ||
      hashEvaluationInput(context) !== guided.contextHash
    )
      throw new Error('Practice turn configuration or evidence changed.');
    const evaluation = buildPracticeInput(id, context, session.turns);
    if (JSON.stringify(evaluation).length > PRACTICE_INPUT_LIMIT)
      throw new Error('Practice input exceeds supported size.');
    const extraction = validateExtraction(
      await this.service.evaluations.provider.extract(evaluation),
      evaluation,
    );
    const checks = checkClaims(extraction, evaluation);
    const input = {
      evaluation,
      extraction,
      checks,
      resolvedFindingIds: [...new Set(guided.turns.flatMap((turn) => turn.resolvedFindingIds))],
    };
    const output = validatePracticeTurn(await provider.generate(input), input);
    const turn = guidedTurnSchema.parse({
      ...output,
      id: randomUUID(),
      sequence: guided.turns.length,
      answerId,
      createdAt: new Date().toISOString(),
      promptVersion: PRACTICE_TURN_VERSION,
      model: provider.model,
      checks,
    });
    await this.service.change((state) => {
      const current = selectedSession(state.rehearsals, id);
      if (
        current.session.status !== 'active' ||
        current.guided.pending?.answerId !== answerId ||
        current.guided.pending.generation !== pending.generation ||
        current.guided.revision !== guided.revision
      )
        throw new ConflictError('Practice turn no longer current.');
      current.guided.turns.push(turn);
      current.guided.pending = null;
      current.guided.revision += 1;
      current.session.turns.push({ role: 'agent', text: `${turn.reply}\n\n${turn.question}` });
    }, job);
  }
}
