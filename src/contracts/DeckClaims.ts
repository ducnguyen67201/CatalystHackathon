import { z } from 'zod';

export const deckClaimInputSchema = z.strictObject({
  quote: z.string().trim().min(1).max(2000),
  location: z.string().trim().min(1).max(200),
  metric: z.enum([
    'revenue',
    'operating_income',
    'net_income',
    'other_income_credit',
    'gross_margin',
    'support_adjusted_margin',
    'arr',
    'logo_churn',
    'nrr',
    'cac',
    'cac_payback',
    'runway',
  ]),
  value: z.string().regex(/^-?\d{1,16}(?:\.\d{1,8})?$/),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  unit: z.enum(['unspecified', 'USD', 'CAD', 'EUR', 'GBP', 'percent', 'months']),
  kind: z.enum(['actual', 'forecast']),
  precision: z.int().min(0).max(4),
});
export const deckClaimSchema = deckClaimInputSchema.extend({
  id: z.uuid(),
  snapshotId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  drafts: z
    .array(
      z.strictObject({
        id: z.uuid(),
        text: z.string().trim().min(1).max(3000),
        createdAt: z.iso.datetime(),
      }),
    )
    .max(100),
});
export const deckClaimsStateSchema = z.strictObject({
  version: z.int().nonnegative(),
  claims: z.array(deckClaimSchema).max(100),
  commands: z.array(z.strictObject({ key: z.uuid(), hash: z.string() })).max(2000),
});
export const deckClaimResultSchema = z.strictObject({
  claim: deckClaimSchema,
  status: z.enum([
    'supported',
    'contradicted',
    'insufficient_evidence',
    'ambiguous',
    'not_checked',
  ]),
  value: z.string().nullable(),
  formula: z.string(),
  explanation: z.string(),
  suggestion: z.string().nullable(),
  stale: z.boolean(),
  fictional: z.boolean(),
  fileName: z.string().nullable(),
  sourceRows: z
    .array(
      z.strictObject({
        row: z.int().positive(),
        period: z.string(),
        cells: z.record(z.string(), z.string()),
      }),
    )
    .max(24),
});
export const deckClaimsViewSchema = z.strictObject({
  version: z.int().nonnegative(),
  demoAvailable: z.boolean(),
  results: z.array(deckClaimResultSchema).max(100),
});
const base = { key: z.uuid(), version: z.int().nonnegative() };
export const deckClaimsCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...base, action: z.literal('add'), claim: deckClaimInputSchema }),
  z.strictObject({
    ...base,
    action: z.literal('save_draft'),
    claimId: z.uuid(),
    text: z.string().trim().min(1).max(3000),
  }),
  z.strictObject({ ...base, action: z.literal('demo') }),
]);
export type DeckClaim = z.infer<typeof deckClaimSchema>;
export type DeckClaimResult = z.infer<typeof deckClaimResultSchema>;
export type DeckClaimsView = z.infer<typeof deckClaimsViewSchema>;
export type DeckClaimsCommand = z.infer<typeof deckClaimsCommandSchema>;
