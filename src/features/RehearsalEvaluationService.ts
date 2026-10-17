import { createHash, randomUUID } from 'node:crypto';
import {
  evaluationRecordSchema,
  type EvaluationRecord,
  type EvaluationResponse,
} from '../contracts/RehearsalEvaluation.js';
import { rehearsalSchema, type Rehearsal } from '../contracts/Workspace.js';
import type { WorkspaceService } from './WorkspaceService.js';
import type { ClaimedJob } from './WorkspaceStore.js';
import {
  EVALUATOR_VERSION,
  type EvaluationInput,
  type EvaluationProvider,
} from './EvaluationProvider.js';
import { checkClaims, validateCoaching, validateExtraction } from './EvaluationChecks.js';
import { projectEvidenceReview } from './EvidenceReview.js';
import type { EvidenceReview } from '../contracts/EvidenceReview.js';

export const hashEvaluationInput = (input: unknown): string =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** Called inside the workspace write that accepts a transcript; persistence schedules its job. */
export function queueEvaluation(
  session: Rehearsal,
  provider: EvaluationProvider,
  parent: EvaluationRecord | null = null,
  itemId: string | null = null,
  clarification: string | null = null,
  requestKey: string | null = null,
): EvaluationRecord | null {
  if (!session.evaluationContext) return null;
  const transcriptHash = hashEvaluationInput(session.turns);
  if (!parent) {
    const existing = session.evaluations.find(
      (e) => e.transcriptHash === transcriptHash && e.parentEvaluationId === null,
    );
    if (existing) return existing;
  }
  const reason = !session.turns.some((t) => t.role === 'user' && t.text.trim())
    ? 'No substantive founder turns were received.'
    : JSON.stringify({ context: session.evaluationContext, turns: session.turns }).length > 100000
      ? 'This session exceeds the supported input size. No partial assessment was generated.'
      : null;
  const now = new Date().toISOString();
  const record = evaluationRecordSchema.parse({
    id: randomUUID(),
    version: 1,
    model: provider.model,
    evaluatorVersion: EVALUATOR_VERSION,
    contextHash: hashEvaluationInput(session.evaluationContext),
    transcriptHash,
    turns: session.turns.map((turn, index) => ({
      ...turn,
      id: `${session.id}:${transcriptHash.slice(0, 12)}:${index}`,
    })),
    scope:
      session.status === 'partial'
        ? 'partial'
        : !session.evaluationContext.facts.length
          ? 'transcript_only'
          : 'complete',
    status: reason ? 'skipped' : 'queued',
    reason,
    generation: 0,
    createdAt: now,
    completedAt: reason ? now : null,
    parentEvaluationId: parent?.id ?? null,
    parentItemId: itemId,
    clarification,
    requestKey,
    report: null,
  });
  session.evaluations.push(record);
  return record;
}

export class RehearsalEvaluationService {
  constructor(
    private readonly service: WorkspaceService,
    readonly provider: EvaluationProvider,
  ) {}
  async getEvidence(sessionId: string, evaluationId: string): Promise<EvidenceReview | null> {
    const state = await this.service.read();
    const session = state.rehearsals.find((s) => s.id === sessionId);
    const evaluation = session?.evaluations.find((e) => e.id === evaluationId);
    if (!session || !evaluation) return null;
    const jobs = await this.service.store.listJobs();
    const failed =
      jobs.find((j) => j.kind === `evaluate:${sessionId}:${evaluationId}`)?.status === 'failed';
    return projectEvidenceReview(
      sessionId,
      evaluation,
      session.evaluationContext,
      failed,
      state.onboarding.snapshotId,
    );
  }
  async get(sessionId: string): Promise<EvaluationResponse> {
    const session = (await this.service.read()).rehearsals.find((s) => s.id === sessionId);
    if (!session) throw new Error('Session unavailable.');
    const jobs = await this.service.store.listJobs();
    return {
      context: session.evaluationContext,
      evaluations: session.evaluations,
      responses: session.evaluationResponses,
      jobs: jobs
        .filter((j) => j.kind.startsWith(`evaluate:${session.id}:`))
        .map(({ kind, status, error }) => ({ kind, status, error })),
    };
  }
  async run(sessionId: string, evaluationId: string, job: ClaimedJob): Promise<void> {
    const state = await this.service.read();
    const session = state.rehearsals.find((s) => s.id === sessionId);
    const evaluation = session?.evaluations.find((e) => e.id === evaluationId);
    const context = session?.evaluationContext;
    const provider = this.provider;
    if (!session || !evaluation || !context) throw new Error('Evaluation inputs unavailable.');
    if (
      evaluation.legacyDemo ||
      evaluation.model !== provider.model ||
      evaluation.evaluatorVersion !== EVALUATOR_VERSION
    )
      throw new Error(
        'Evaluation configuration changed. Restore the recorded configuration before retrying.',
      );
    if (
      hashEvaluationInput(context) !== evaluation.contextHash ||
      hashEvaluationInput(evaluation.turns.map(({ role, text }) => ({ role, text }))) !==
        evaluation.transcriptHash
    )
      throw new Error('Evaluation input integrity failure.');
    const parent = state.rehearsals
      .flatMap((s) => s.evaluations)
      .find((e) => e.id === evaluation.parentEvaluationId);
    const input: EvaluationInput = {
      context,
      turns: evaluation.turns,
      scope: evaluation.scope,
      clarification: evaluation.clarification,
      previous:
        parent?.report && evaluation.parentItemId
          ? { report: parent.report, itemId: evaluation.parentItemId }
          : null,
    };
    const extraction = validateExtraction(await provider.extract(input), input);
    const checks = checkClaims(extraction, input);
    const coaching = validateCoaching(
      await provider.coach(input, extraction, checks),
      extraction,
      input,
      checks,
    );
    await this.service.change((current) => {
      const target = current.rehearsals
        .find((s) => s.id === sessionId)
        ?.evaluations.find((e) => e.id === evaluationId);
      if (!target || target.generation !== evaluation.generation || target.status !== 'queued')
        throw new Error('Evaluation changed.');
      target.report = { extraction, checks, coaching };
      target.status = 'completed';
      target.completedAt = new Date().toISOString();
    }, job);
  }
  async retry(sessionId: string, evaluationId: string, generation: number): Promise<void> {
    const jobs = await this.service.store.listJobs();
    const latest = jobs.find((j) => j.kind === `evaluate:${sessionId}:${evaluationId}`);
    if (latest?.status !== 'failed') return;
    await this.service.change((state) => {
      const record = state.rehearsals
        .find((s) => s.id === sessionId)
        ?.evaluations.find((e) => e.id === evaluationId);
      if (!record || record.status !== 'queued') throw new Error('Evaluation is not retryable.');
      // Replayed/concurrent browser requests cannot create another retry generation.
      if (record.generation === generation) record.generation += 1;
    });
  }
  async respond(
    sessionId: string,
    evaluationId: string,
    itemId: string,
    kind: 'clarification' | 'dismissed' | 'practice',
    text: string,
    requestKey: string,
  ): Promise<string> {
    return this.service.change((state) => {
      const session = state.rehearsals.find((s) => s.id === sessionId);
      const evaluation = session?.evaluations.find((e) => e.id === evaluationId);
      const item = evaluation?.report?.coaching.items.find((i) => i.id === itemId);
      if (!session || !evaluation || !item || !session.evaluationContext)
        throw new Error('Review item unavailable.');
      const existing = session.evaluationResponses.find((r) => r.requestKey === requestKey);
      if (existing) return existing.id;
      const responseId = randomUUID();
      session.evaluationResponses.push({
        id: responseId,
        evaluationId,
        itemId,
        kind,
        text,
        createdAt: new Date().toISOString(),
        requestKey,
      });
      if (kind === 'clarification')
        queueEvaluation(session, this.provider, evaluation, itemId, text, requestKey);
      if (kind === 'practice') {
        const retry = rehearsalSchema.parse({
          id: responseId,
          briefId: null,
          mode: 'text',
          status: 'completed',
          createdAt: new Date().toISOString(),
          conversationId: null,
          turns: [
            { role: 'agent', text: item.practiceQuestion },
            { role: 'user', text },
          ],
          review: null,
          context: session.context,
          evaluationContext: { ...session.evaluationContext, scenario: item.practiceQuestion },
        });
        queueEvaluation(retry, this.provider, evaluation, itemId, null, requestKey);
        state.rehearsals.push(retry);
      }
      return responseId;
    });
  }
}
