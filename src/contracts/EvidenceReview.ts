import { z } from 'zod';
import { evidenceCheckSchema, evaluationSourceSchema } from './RehearsalEvaluation.js';

const id = z.string().min(1).max(500);
const decimal = z
  .string()
  .max(100)
  .regex(/^-?\d+(?:\.\d+)?$/);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const evidenceCellSchema = z.strictObject({
  id,
  displayAddress: z.string().regex(/^[A-Z]+\d+$/),
  row: z.int().positive(),
  column: z.int().positive(),
  metric: id,
  label: z.string().max(100),
  period,
  unit: z.string().max(30),
  value: decimal,
  factIds: z.array(id).max(20),
  sourceLocator: z.strictObject({
    kind: z.literal('csv'),
    snapshotId: id,
    sourceId: id,
    fileName: z.string().max(200).nullable(),
    sourceTitle: z.string().max(2000),
    sourceRow: z.int().positive(),
    columnKey: id,
  }),
  origin: evaluationSourceSchema.shape.origin,
  calculation: z.string().max(500).nullable(),
});
export type EvidenceCell = z.infer<typeof evidenceCellSchema>;

export const claimLinkSchema = z.strictObject({
  claimId: id,
  turnId: id,
  span: z
    .strictObject({ startUtf16: z.int().nonnegative(), endUtf16: z.int().positive() })
    .nullable(),
  spanStatus: z.enum(['exact', 'repeated', 'unavailable']),
  support: evidenceCheckSchema.shape.support,
  explanation: z.string().max(2000),
  primaryFactIds: z.array(id).max(20),
  supportingFactIds: z.array(id).max(60),
  cellIds: z.array(id).max(300),
  primaryCellIds: z.array(id).max(40),
  sourceIds: z.array(id).max(100),
  correctedByTurnId: id.nullable(),
  comparison: z
    .strictObject({
      claimed: decimal,
      source: decimal,
      difference: decimal,
      period,
      unit: z.string().max(30),
    })
    .nullable(),
  unavailableReason: z.string().max(2000).nullable(),
});
export type ClaimLink = z.infer<typeof claimLinkSchema>;

export const financialChangeSchema = z.strictObject({
  metric: id,
  unit: z.string().max(30),
  currentPeriod: period,
  previousPeriod: period.nullable(),
  currentFactId: id,
  previousFactId: id.nullable(),
  absoluteDelta: decimal.nullable(),
  percentDelta: decimal.nullable(),
  unavailableReason: z.string().max(500).nullable(),
});
export type FinancialChange = z.infer<typeof financialChangeSchema>;

export const evidenceReviewSchema = z.strictObject({
  version: z.literal(1),
  projectionVersion: z.literal('csv-review-v1'),
  sessionId: id,
  evaluationId: id,
  contextHash: id,
  transcriptHash: id,
  state: z.enum(['pending', 'failed', 'skipped', 'completed']),
  reason: z.string().max(2000).nullable(),
  scope: z.enum(['complete', 'partial', 'transcript_only']),
  currentSnapshotChanged: z.boolean(),
  coverage: z.strictObject({
    periods: z.array(period).max(12),
    limitations: z.array(z.string().max(2000)).max(100),
    unavailableSources: z
      .array(z.strictObject({ sourceId: id, reason: z.string().max(500) }))
      .max(300),
  }),
  grids: z
    .array(
      z.strictObject({
        id,
        snapshotId: id,
        title: z.string().max(2000),
        layoutKind: z.literal('csv_review'),
        periods: z.array(period).max(12),
        cells: z.array(evidenceCellSchema).max(100),
      }),
    )
    .max(1),
  claimLinks: z.array(claimLinkSchema).max(30),
  changes: z.array(financialChangeSchema).max(100),
});
export type EvidenceReview = z.infer<typeof evidenceReviewSchema>;

export const supportLabels: Record<ClaimLink['support'], string> = {
  supported: 'Matches selected evidence',
  contradicted: 'Conflicts with selected evidence',
  insufficient_evidence: 'Missing supporting evidence',
  ambiguous: 'Clarification needed',
  not_checked: 'Not compared',
};
