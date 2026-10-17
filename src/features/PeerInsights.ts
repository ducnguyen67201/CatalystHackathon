import { peerInsightSchema, type PeerComparison } from '../contracts/PeerComparison.js';
import type { Extraction } from '../contracts/RehearsalEvaluation.js';

/** Topic links use validated actual claims; this does not certify the founder's answer. */
export function buildPeerInsights(comparison: PeerComparison | undefined, extraction: Extraction) {
  return (comparison?.metrics ?? []).flatMap((metric) => {
    if (metric.value === null || !metric.peers.length) return [];
    const topics =
      metric.metric === 'revenue_growth'
        ? ['revenue', 'revenue_growth']
        : metric.metric === 'gross_margin'
          ? ['gross_margin', 'gross_profit', 'cogs']
          : ['operating_margin', 'operating_income', 'operating_expenses'];
    const claim = extraction.claims.find(
      (item) =>
        item.kind === 'actual' &&
        !item.supersededByTurnId &&
        item.metric !== null &&
        topics.includes(item.metric) &&
        item.period === metric.endMonth,
    );
    if (!claim) return [];
    return [
      peerInsightSchema.parse({
        capturedAt: comparison?.capturedAt,
        claimId: claim.id,
        turnId: claim.turnId,
        comparison: metric,
        preparation:
          metric.metric === 'revenue_growth'
            ? 'Prepare a source-backed explanation of the revenue change and its drivers. This small peer sample does not establish market-wide performance.'
            : 'Prepare a source-backed explanation of your cost structure and differences from the selected peers. The comparison alone does not establish the cause or a defensible advantage.',
      }),
    ];
  });
}
