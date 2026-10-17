import { z } from 'zod';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const amount = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .max(100);
export const financialPerformanceQuerySchema = z.strictObject({
  current: month.optional(),
  comparison: month.optional(),
});
const bridgeSchema = z.strictObject({ value: amount, start: amount, end: amount });
export const financialPerformanceSchema = z.strictObject({
  snapshotId: z.string().nullable(),
  fileName: z.string().nullable(),
  fictional: z.boolean(),
  currency: z.string(),
  availablePeriods: z.array(month).max(1200),
  currentPeriod: month.nullable(),
  comparisonPeriod: month.nullable(),
  currentSourceRow: z.int().positive().nullable(),
  comparisonSourceRow: z.int().positive().nullable(),
  comparisonNote: z.string(),
  rows: z
    .array(
      z.strictObject({
        id: z.string(),
        label: z.string(),
        kind: z.enum(['contribution', 'subtotal']),
        favorableDirection: z.enum(['higher', 'lower']),
        sourceColumns: z.array(z.string()).max(2),
        current: bridgeSchema.nullable(),
        comparison: bridgeSchema.nullable(),
        delta: amount.nullable(),
        deltaPercent: amount.nullable(),
        favorable: z.boolean().nullable(),
        formula: z.string(),
      }),
    )
    .max(12),
});
export type FinancialPerformance = z.infer<typeof financialPerformanceSchema>;
export type FinancialPerformanceQuery = z.infer<typeof financialPerformanceQuerySchema>;
