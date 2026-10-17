import { peerEvaluationSchema, type PeerEvaluation } from '../contracts/CombinedEvaluation.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';

/** Business context is assessed even if the transcript never mentions a metric. */
export function runPeerEvaluation(context: EvaluationContext): PeerEvaluation {
  const comparison = context.peerComparison ?? null;
  const comparable =
    comparison?.metrics.filter((metric) => metric.position !== 'unavailable') ?? [];
  return peerEvaluationSchema.parse({
    version: 1,
    status: !comparable.length ? 'unavailable' : comparable.length === 3 ? 'available' : 'limited',
    comparison,
    limitations: [
      'The founder selects the peer group. Segment similarity and entered sources are not independently verified.',
      'Selected peer ranges are not industry averages, valuations or evidence of why a difference exists.',
      ...(comparison?.fictional ? ['Fictional demo evidence.'] : []),
      ...(!comparable.length
        ? ['No comparable peer metrics are available in this frozen snapshot.']
        : []),
      ...(comparison?.metrics.some((metric) => metric.peers.length < 3)
        ? ['Some metrics have fewer than three selected peers.']
        : []),
    ],
  });
}
