import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  evidenceReviewSchema,
  type EvidenceReview,
  type EvidenceCell,
  type ClaimLink,
  type FinancialChange,
} from '../contracts/EvidenceReview.js';
import type {
  EvaluationContext,
  EvaluationRecord,
  MetricFact,
} from '../contracts/RehearsalEvaluation.js';
import { rowSchema } from '../contracts/Workspace.js';

const financialRow = rowSchema.extend({ raw: z.record(z.string(), z.string()).optional() });
const metrics = [
  { metric: 'revenue', field: 'revenue', key: 'total_revenue', label: 'Total revenue' },
  { metric: 'cogs', field: 'cogs', key: 'total_cogs', label: 'Cost of goods sold' },
  { metric: 'gross_profit', field: 'grossProfit', key: 'gross_profit', label: 'Gross profit' },
  {
    metric: 'operating_expenses',
    field: 'expenses',
    key: 'total_operating_expenses',
    label: 'Operating expenses',
  },
  {
    metric: 'operating_income',
    field: 'operatingIncome',
    key: 'operating_income',
    label: 'Operating income',
  },
  {
    metric: 'other_income_credit',
    field: 'credit',
    key: 'other_income_srred_credit',
    label: 'SR&ED credit',
  },
  { metric: 'net_income', field: 'netIncome', key: 'net_income', label: 'Net income' },
] as const;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = (values: string[]) => [...new Set(values)];
const knownUnit = (unit: string) => unit !== '' && unit !== 'unspecified';

/** A read model of frozen inputs. Never reads current financial amounts or runs inference. */
export function projectEvidenceReview(
  sessionId: string,
  evaluation: EvaluationRecord,
  context: EvaluationContext | null,
  failed = false,
  currentSnapshotId: string | null = null,
): EvidenceReview {
  const result: EvidenceReview = {
    version: 1,
    projectionVersion: 'csv-review-v1',
    sessionId,
    evaluationId: evaluation.id,
    contextHash: evaluation.contextHash,
    transcriptHash: evaluation.transcriptHash,
    scope: evaluation.scope,
    state: evaluation.status === 'queued' ? (failed ? 'failed' : 'pending') : evaluation.status,
    reason: evaluation.reason,
    currentSnapshotChanged: Boolean(
      context?.snapshotId && currentSnapshotId && context.snapshotId !== currentSnapshotId,
    ),
    coverage: {
      periods: [],
      limitations: [...(context?.limitations ?? [])],
      unavailableSources: [],
    },
    grids: [],
    claimLinks: [],
    changes: [],
  };
  if (context && digest(context) !== evaluation.contextHash) {
    result.reason =
      'Frozen evidence integrity could not be verified. The saved report is still available.';
    return evidenceReviewSchema.parse(result);
  }
  if (
    digest(evaluation.turns.map(({ role, text }) => ({ role, text }))) !== evaluation.transcriptHash
  ) {
    result.reason =
      'Frozen transcript integrity could not be verified. The saved report is still available.';
    return evidenceReviewSchema.parse(result);
  }
  if (!context)
    result.coverage.limitations.push(
      'This review has no frozen source context; current financials are not substituted.',
    );
  const unavailable = result.coverage.unavailableSources;
  const rows: {
    source: NonNullable<EvaluationContext>['sources'][number];
    row: z.infer<typeof financialRow>;
  }[] = [];
  for (const source of context?.sources.filter((s) => s.kind === 'financial') ?? []) {
    try {
      const raw: unknown = JSON.parse(source.text);
      const row = financialRow.parse(raw);
      if (
        !context?.snapshotId ||
        source.id !== `financial:${context.snapshotId}:${row.sourceRow}` ||
        context.sources.filter((s) => s.id === source.id).length !== 1 ||
        (source.financialLocation &&
          (source.financialLocation.snapshotId !== context.snapshotId ||
            source.financialLocation.sourceRow !== row.sourceRow))
      ) {
        throw new Error('Source identity mismatch');
      }
      if (row.raw)
        for (const metric of metrics) {
          const value = row.raw[metric.key];
          if (
            !value ||
            !/^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?$/.test(value) ||
            !new Decimal(value.replaceAll('$', '').replaceAll(',', '')).eq(row[metric.field])
          )
            throw new Error('Original column does not match the saved row');
        }
      rows.push({ source, row });
    } catch {
      unavailable.push({
        sourceId: source.id,
        reason: 'This frozen financial row could not be validated or linked to its snapshot.',
      });
    }
  }
  const validRows = rows
    .filter(({ source, row }) => {
      if (rows.filter((r) => r.row.month === row.month).length !== 1) {
        unavailable.push({
          sourceId: source.id,
          reason: 'Multiple source rows describe the same period; clarify before comparing.',
        });
        return false;
      }
      return true;
    })
    .sort((a, b) => a.row.month.localeCompare(b.row.month));
  if (validRows.length > 12) {
    for (const { source } of validRows.splice(0, validRows.length - 12))
      unavailable.push({
        sourceId: source.id,
        reason: 'Outside the supported twelve-period evidence view.',
      });
  }
  const cells: EvidenceCell[] = [];
  const factCells = new Map<string, string[]>();
  const facts = (context?.facts ?? []).filter(
    (fact, _, all) => all.filter((f) => f.id === fact.id).length === 1,
  );
  for (const [column, { source, row }] of validRows.entries()) {
    const sourceFacts = facts.filter(
      (f) => f.sourceIds.length === 1 && f.sourceIds[0] === source.id && f.period === row.month,
    );
    const units = unique(
      sourceFacts.filter((f) => metrics.some((m) => m.metric === f.metric)).map((f) => f.unit),
    );
    const unit = units.length === 1 ? (units[0] ?? 'unspecified') : 'unspecified';
    for (const [index, metric] of metrics.entries()) {
      const value = row[metric.field];
      const matching = sourceFacts.filter(
        (f) => f.metric === metric.metric && f.unit === unit && new Decimal(f.value).eq(value),
      );
      const cell: EvidenceCell = {
        id: `${source.id}:${metric.metric}`,
        displayAddress: `${String.fromCharCode(66 + column)}${4 + index}`,
        row: 4 + index,
        column: column + 2,
        metric: metric.metric,
        label: metric.label,
        period: row.month,
        unit,
        value,
        factIds: matching.length === 1 ? matching.map((f) => f.id) : [],
        sourceLocator: {
          kind: 'csv',
          snapshotId: context?.snapshotId ?? '',
          sourceId: source.id,
          fileName: source.financialLocation?.fileName ?? null,
          sourceTitle: source.title,
          sourceRow: row.sourceRow,
          columnKey: metric.key,
        },
        origin: source.origin,
        calculation: null,
      };
      cells.push(cell);
      for (const fact of matching.length === 1 ? matching : []) factCells.set(fact.id, [cell.id]);
    }
    for (const fact of sourceFacts.filter(
      (f) => f.unit === 'percent' && ['gross_margin', 'operating_margin'].includes(f.metric),
    )) {
      const numerator = fact.metric === 'gross_margin' ? 'gross_profit' : 'operating_income';
      const inputs = [numerator, 'revenue'].map((metric) =>
        cells.find((c) => c.sourceLocator.sourceId === source.id && c.metric === metric),
      );
      const [top, bottom] = inputs;
      if (
        top &&
        bottom &&
        !new Decimal(bottom.value).isZero() &&
        new Decimal(top.value).div(bottom.value).times(100).toDecimalPlaces(8).eq(fact.value)
      )
        factCells.set(fact.id, [top.id, bottom.id]);
    }
  }
  for (const cell of cells) {
    const at = (metric: string) =>
      cells.find((c) => c.period === cell.period && c.metric === metric)?.displayAddress;
    const formula =
      cell.metric === 'gross_profit'
        ? `${at('revenue')} - ${at('cogs')}`
        : cell.metric === 'operating_income'
          ? `${at('gross_profit')} - ${at('operating_expenses')}`
          : cell.metric === 'net_income'
            ? `${at('operating_income')} + ${at('other_income_credit')}`
            : null;
    if (formula && !formula.includes('undefined')) cell.calculation = formula;
  }
  result.coverage.periods = validRows.map((r) => r.row.month);
  if (cells.length && context?.snapshotId)
    result.grids.push({
      id: context.snapshotId,
      snapshotId: context.snapshotId,
      title: validRows[0]?.source.financialLocation?.fileName ?? 'Frozen financial evidence',
      layoutKind: 'csv_review',
      periods: result.coverage.periods,
      cells,
    });
  result.changes = financialChanges(
    facts.filter((f) => factCells.has(f.id) && metrics.some((m) => m.metric === f.metric)),
  );
  if (result.state !== 'completed' || !evaluation.report) return evidenceReviewSchema.parse(result);
  for (const claim of evaluation.report.extraction.claims) {
    const turn = evaluation.turns.find((t) => t.id === claim.turnId && t.role === 'user');
    const start = turn?.text.indexOf(claim.quote) ?? -1;
    const repeated = start >= 0 && (turn?.text.indexOf(claim.quote, start + 1) ?? -1) >= 0;
    const check = evaluation.report.checks.find((c) => c.claimId === claim.id);
    const coaching = evaluation.report.coaching.items.filter((i) => i.claimId === claim.id);
    const primary = unique(check?.factIds ?? []);
    const supporting = unique(coaching.flatMap((i) => i.factIds)).filter(
      (id) => !primary.includes(id),
    );
    const primaryCellIds = unique(primary.flatMap((id) => factCells.get(id) ?? []));
    const linkedCells = unique([
      ...primaryCellIds,
      ...supporting.flatMap((id) => factCells.get(id) ?? []),
    ]);
    const fact = primary.length === 1 ? facts.find((f) => f.id === primary[0]) : undefined;
    const compatible =
      start >= 0 &&
      fact &&
      factCells.has(fact.id) &&
      facts.filter(
        (f) => f.metric === fact.metric && f.period === fact.period && f.unit === fact.unit,
      ).length === 1 &&
      claim.kind === 'actual' &&
      !claim.supersededByTurnId &&
      claim.metric === fact.metric &&
      claim.period === fact.period &&
      claim.unit === fact.unit &&
      knownUnit(fact.unit) &&
      claim.value !== null &&
      ['supported', 'contradicted'].includes(check?.support ?? '');
    const link: ClaimLink = {
      claimId: claim.id,
      turnId: claim.turnId,
      span:
        start >= 0 && !repeated
          ? { startUtf16: start, endUtf16: start + claim.quote.length }
          : null,
      spanStatus: start < 0 ? 'unavailable' : repeated ? 'repeated' : 'exact',
      support: claim.supersededByTurnId ? 'not_checked' : (check?.support ?? 'not_checked'),
      explanation: check?.explanation ?? 'This claim has no saved evidence check.',
      primaryFactIds: primary,
      supportingFactIds: supporting,
      cellIds: linkedCells,
      primaryCellIds,
      sourceIds: unique(
        [...primary, ...supporting]
          .flatMap((id) => facts.find((f) => f.id === id)?.sourceIds ?? [])
          .concat(coaching.flatMap((i) => i.sourceIds)),
      ),
      correctedByTurnId: claim.supersededByTurnId,
      comparison:
        compatible && claim.value !== null
          ? {
              claimed: claim.value,
              source: fact.value,
              difference: new Decimal(claim.value).minus(fact.value).toFixed(),
              period: fact.period,
              unit: fact.unit,
            }
          : null,
      unavailableReason: compatible
        ? null
        : claim.supersededByTurnId
          ? 'This claim was corrected later in the transcript.'
          : fact && !knownUnit(fact.unit)
            ? 'Currency is unspecified; a monetary comparison is unavailable.'
            : 'No unique comparable fact with validated source cells, period and units is available.',
    };
    result.claimLinks.push(link);
  }
  return evidenceReviewSchema.parse(result);
}

function financialChanges(facts: MetricFact[]): FinancialChange[] {
  return facts.map((fact) => {
    const year = Number(fact.period.slice(0, 4));
    const month = Number(fact.period.slice(5, 7));
    const previousPeriod = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`;
    const candidates = facts.filter(
      (f) => f.metric === fact.metric && f.period === previousPeriod && f.unit === fact.unit,
    );
    const previous = candidates.length === 1 ? candidates[0] : undefined;
    const change: FinancialChange = {
      metric: fact.metric,
      unit: fact.unit,
      currentPeriod: fact.period,
      previousPeriod: previous?.period ?? null,
      currentFactId: fact.id,
      previousFactId: previous?.id ?? null,
      absoluteDelta: null,
      percentDelta: null,
      unavailableReason: null,
    };
    if (!knownUnit(fact.unit)) change.unavailableReason = 'Currency is unspecified.';
    else if (!previous)
      change.unavailableReason = 'The adjacent prior month is not available with matching units.';
    else {
      change.absoluteDelta = new Decimal(fact.value).minus(previous.value).toFixed();
      if (new Decimal(previous.value).gt(0))
        change.percentDelta = new Decimal(change.absoluteDelta)
          .div(previous.value)
          .times(100)
          .toFixed(2, Decimal.ROUND_HALF_UP);
      else
        change.unavailableReason =
          'Percentage change needs a positive prior value; absolute change is shown.';
    }
    return change;
  });
}
