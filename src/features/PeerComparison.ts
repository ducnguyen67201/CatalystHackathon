import { Decimal as DecimalBase } from 'decimal.js';
import { fictionalFinancialHashes } from '../contracts/FinancialProvenance.js';
import {
  peerComparisonSchema,
  type PeerComparison,
  type PeerRecord,
  type PeerMetric,
} from '../contracts/PeerComparison.js';
import type { FinancialSnapshot } from '../contracts/Workspace.js';

const Decimal = DecimalBase.clone({ precision: 80 });

type Period = { month: string; revenue: string; grossProfit: string; operatingIncome: string };
export function currentPeers(history: PeerRecord[]): PeerRecord[] {
  const latest = new Map<string, PeerRecord>();
  for (const peer of history) {
    if ((latest.get(peer.peerId)?.version ?? 0) < peer.version) latest.set(peer.peerId, peer);
  }
  return [...latest.values()].filter((peer) => !peer.archived);
}
function previousMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}
function calculate(metric: PeerMetric, rows: Period[], start: string, end: string): string | null {
  const last = rows.find((row) => row.month === end);
  if (!last || new Decimal(last.revenue).lte(0)) return null;
  if (metric === 'revenue_growth') {
    const first = rows.find((row) => row.month === start);
    if (!first || new Decimal(first.revenue).lte(0)) return null;
    return new Decimal(last.revenue).minus(first.revenue).div(first.revenue).times(100).toFixed(8);
  }
  return new Decimal(metric === 'gross_margin' ? last.grossProfit : last.operatingIncome)
    .div(last.revenue)
    .times(100)
    .toFixed(8);
}
/** No model arithmetic. Percentages compare total-revenue definitions and matching periods. */
export function buildPeerComparison(
  snapshot: FinancialSnapshot | undefined,
  history: PeerRecord[],
  profileVersion: number,
  capturedAt = new Date().toISOString(),
): PeerComparison {
  const rows = [...(snapshot?.rows ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  const endMonth = rows.at(-1)?.month;
  const fictional = snapshot ? fictionalFinancialHashes.has(snapshot.hash) : false;
  const peers = currentPeers(history);
  return peerComparisonSchema.parse({
    version: 1,
    capturedAt,
    profileVersion,
    snapshotId: snapshot?.id ?? null,
    fileName: snapshot?.fileName ?? null,
    currency: snapshot?.currency ?? 'unspecified',
    fictional,
    trend: rows.slice(-12).map(({ month, revenue, sourceRow }) => ({ month, revenue, sourceRow })),
    metrics: endMonth
      ? (['revenue_growth', 'gross_margin', 'operating_margin'] as const).map((metric) => {
          const startMonth = metric === 'revenue_growth' ? previousMonth(endMonth) : endMonth;
          const value = calculate(metric, rows, startMonth, endMonth);
          const eligible = peers.map((peer) => ({
            peer,
            value: calculate(metric, peer.periods, startMonth, endMonth),
          }));
          const matches = eligible.filter(
            (item) =>
              item.value !== null &&
              item.peer.currency === snapshot?.currency &&
              item.peer.fictional === fictional,
          );
          const observations = matches.flatMap((item) =>
            item.value === null
              ? []
              : [
                  {
                    peer: {
                      ...item.peer,
                      periods: item.peer.periods.filter(
                        (row) => row.month === startMonth || row.month === endMonth,
                      ),
                    },
                    value: item.value,
                  },
                ],
          );
          const values = observations.map((item) => new Decimal(item.value));
          const low = values.length ? Decimal.min(...values) : null;
          const high = values.length ? Decimal.max(...values) : null;
          return {
            metric,
            startMonth,
            endMonth,
            value,
            companySource: {
              snapshotId: snapshot?.id ?? '',
              fileName: snapshot?.fileName ?? '',
              currency: snapshot?.currency ?? 'unspecified',
              fictional,
              rows: rows
                .filter((row) => row.month === startMonth || row.month === endMonth)
                .map(({ month, revenue, grossProfit, operatingIncome, sourceRow }) => ({
                  month,
                  revenue,
                  grossProfit,
                  operatingIncome,
                  sourceRow,
                })),
            },
            reason:
              value === null ? 'Matching monthly rows with positive revenue are required.' : null,
            peers: observations,
            excluded: eligible
              .filter((item) => !matches.includes(item))
              .map((item) => ({
                name: item.peer.name,
                reason:
                  item.peer.fictional !== fictional
                    ? 'Fictional and real evidence are kept separate.'
                    : item.peer.currency !== snapshot?.currency
                      ? 'Statement currencies do not match.'
                      : 'Matching monthly rows with positive revenue are missing.',
              })),
            low: low?.toFixed(8) ?? null,
            high: high?.toFixed(8) ?? null,
            position:
              value === null || !low || !high
                ? 'unavailable'
                : new Decimal(value).lt(low)
                  ? 'below'
                  : new Decimal(value).gt(high)
                    ? 'above'
                    : 'within',
          };
        })
      : [],
  });
}
