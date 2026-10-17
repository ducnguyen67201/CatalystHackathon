import { z } from 'zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,8})?$/)
  .max(80);
const inputAmount = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,4})?$/)
  .max(24);
const sourceUrl = z
  .url({ protocol: /^https$/ })
  .max(1000)
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }, 'Source URLs must not contain credentials.');
export const peerPeriodSchema = z.strictObject({
  month,
  revenue: inputAmount.refine((value) => !value.startsWith('-'), 'Revenue must be nonnegative.'),
  grossProfit: inputAmount,
  operatingIncome: inputAmount,
});
export const peerInputSchema = z.strictObject({
  peerId: z.uuid(),
  expectedVersion: z.int().nonnegative(),
  name: z.string().trim().min(1).max(100),
  stage: z.string().trim().min(1).max(100),
  customer: z.string().trim().min(1).max(300),
  businessModel: z.string().trim().min(1).max(300),
  rationale: z.string().trim().min(1).max(1000),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP']),
  sourceUrl,
  excerpt: z.string().trim().min(1).max(2000),
  publishedAt: z.iso.date().nullable(),
  fictional: z.boolean(),
  periods: z
    .array(peerPeriodSchema)
    .min(1)
    .max(24)
    .refine(
      (rows) => new Set(rows.map((row) => row.month)).size === rows.length,
      'Use one row per month.',
    ),
});
export const peerRecordSchema = peerInputSchema.omit({ expectedVersion: true }).extend({
  id: z.uuid(),
  version: z.int().positive(),
  recordedAt: z.iso.datetime(),
  archived: z.boolean(),
});
export type PeerInput = z.infer<typeof peerInputSchema>;
export type PeerRecord = z.infer<typeof peerRecordSchema>;
export const peerMetricSchema = z.enum(['revenue_growth', 'gross_margin', 'operating_margin']);
export type PeerMetric = z.infer<typeof peerMetricSchema>;
export const peerMetricLabels: Record<PeerMetric, string> = {
  revenue_growth: 'Revenue growth',
  gross_margin: 'Gross margin',
  operating_margin: 'Operating margin',
};
const observationSchema = z.strictObject({
  peer: peerRecordSchema,
  value: decimal,
});
export const metricComparisonSchema = z.strictObject({
  metric: peerMetricSchema,
  companySource: z.strictObject({
    snapshotId: z.string(),
    fileName: z.string(),
    currency: z.string(),
    fictional: z.boolean(),
    rows: z
      .array(
        z.strictObject({
          month,
          revenue: decimal,
          grossProfit: decimal,
          operatingIncome: decimal,
          sourceRow: z.int().positive(),
        }),
      )
      .max(2),
  }),
  startMonth: month,
  endMonth: month,
  value: decimal.nullable(),
  reason: z.string().max(500).nullable(),
  peers: z.array(observationSchema).max(20),
  excluded: z.array(z.strictObject({ name: z.string(), reason: z.string() })).max(20),
  low: decimal.nullable(),
  high: decimal.nullable(),
  position: z.enum(['above', 'below', 'within', 'unavailable']),
});
export type MetricComparison = z.infer<typeof metricComparisonSchema>;
export const peerComparisonSchema = z.strictObject({
  version: z.literal(1),
  capturedAt: z.iso.datetime(),
  profileVersion: z.int().positive(),
  snapshotId: z.string().nullable(),
  fileName: z.string().nullable(),
  currency: z.string(),
  fictional: z.boolean(),
  metrics: z.array(metricComparisonSchema).max(3),
  trend: z
    .array(
      z.strictObject({
        month,
        revenue: decimal,
        sourceRow: z.int().positive(),
      }),
    )
    .max(12),
});
export type PeerComparison = z.infer<typeof peerComparisonSchema>;
export const peerInsightSchema = z.strictObject({
  capturedAt: z.iso.datetime(),
  claimId: z.string(),
  turnId: z.string(),
  comparison: metricComparisonSchema,
  preparation: z.string(),
});
export const peerDashboardSchema = z.strictObject({
  peers: z.array(peerRecordSchema).max(20),
  comparison: peerComparisonSchema,
});
