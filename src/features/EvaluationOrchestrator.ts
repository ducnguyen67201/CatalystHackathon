import {
  evaluationProgressSchema,
  evaluationReportSchema,
  type EvaluationContext,
  type EvaluationProgress,
} from '../contracts/RehearsalEvaluation.js';
import type { EvaluationInput, EvaluationProvider } from './EvaluationProvider.js';
import { extractValidatedClaims } from './EvaluationChecks.js';
import { runAnswerEvaluation } from './AnswerEvaluationWorkflow.js';
import { runPeerEvaluation } from './PeerEvaluationWorkflow.js';
import { runInvestorEvaluation } from './InvestorEvaluationWorkflow.js';
import { synthesizeEvaluation } from './EvaluationSynthesis.js';
import { buildPeerInsights } from './PeerInsights.js';

export async function runEvaluationWorkflows(
  provider: EvaluationProvider,
  input: EvaluationInput,
  context: EvaluationContext,
  saved: EvaluationProgress | undefined,
  checkpoint: (progress: EvaluationProgress) => Promise<void>,
) {
  const progress = evaluationProgressSchema.parse(saved ?? { version: 1 });
  if (!progress.extraction) {
    progress.extraction = await extractValidatedClaims(provider, input);
    await checkpoint(progress);
  }
  const extraction = progress.extraction;
  // Local independent business assessments need no provider calls or mutable workspace reads.
  if (!progress.peer || !progress.investor) {
    const [peer, investor] = await Promise.all([
      Promise.resolve().then(() => progress.peer ?? runPeerEvaluation(context)),
      Promise.resolve().then(() => progress.investor ?? runInvestorEvaluation(context)),
    ]);
    progress.peer = peer;
    progress.investor = investor;
    await checkpoint(progress);
  }
  if (!progress.answer) {
    progress.answer = await runAnswerEvaluation(provider, input, extraction);
    await checkpoint(progress);
  }
  return evaluationReportSchema.parse({
    extraction,
    ...progress.answer,
    peerInsights: buildPeerInsights(context.peerComparison, extraction),
    workflows: {
      version: 1,
      peer: progress.peer,
      investor: progress.investor,
      synthesis: synthesizeEvaluation(
        progress.peer,
        progress.investor,
        extraction,
        progress.answer.coaching,
      ),
    },
  });
}
