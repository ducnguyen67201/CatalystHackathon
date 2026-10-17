import {
  evaluationSynthesisSchema,
  type InvestorEvaluation,
  type PeerEvaluation,
} from '../contracts/CombinedEvaluation.js';
import type { Coaching, Extraction } from '../contracts/RehearsalEvaluation.js';
import { buildPeerInsights } from './PeerInsights.js';

/** Join validated references, without inventing a relationship between a metric and an investor. */
export function synthesizeEvaluation(
  peer: PeerEvaluation,
  investor: InvestorEvaluation,
  extraction: Extraction,
  coaching: Coaching,
) {
  const insights = buildPeerInsights(peer.comparison ?? undefined, extraction);
  const investorSources = new Set(
    investor.criteria.flatMap((criterion) =>
      criterion.observations.map((observation) => observation.sourceId),
    ),
  );
  return evaluationSynthesisSchema.parse({
    version: 1,
    actions: coaching.items.map((item) => ({
      coachingItemId: item.id,
      claimId: item.claimId,
      investorSourceIds: item.investorSourceIds.filter((id) => investorSources.has(id)),
      peerMetrics: insights
        .filter((insight) => insight.claimId === item.claimId)
        .map((insight) => insight.comparison.metric),
      instruction: item.suggestion,
    })),
  });
}
