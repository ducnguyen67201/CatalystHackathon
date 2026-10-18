import { Decimal } from 'decimal.js';
import { z } from 'zod';

const id = z.string().min(1).max(200);
const amount = z
  .string()
  .regex(/^\d{1,16}(?:\.\d{1,4})?$/)
  .refine((value) => new Decimal(value).gt(0));
const currency = z.enum(['USD', 'CAD', 'EUR', 'GBP']);
export const investorCheckRangeSchema = z
  .strictObject({
    min: amount,
    max: amount,
    currency,
  })
  .refine((value) => new Decimal(value.min).lte(value.max), {
    message: 'Check minimum must not exceed the maximum.',
  });

export const investorMatchCriterionSchema = z.enum([
  'stage',
  'sector',
  'geography',
  'check_size',
  'preferences',
]);
export const investorMandateScopeSchema = z.enum([
  'stated_mandate',
  'historical_participation',
  'qualitative_thesis',
  'founder_preference',
]);
export const investorMatchSourceSchema = z.strictObject({
  evidenceId: id,
  researchRunId: z.uuid().nullable(),
  url: z.url().nullable(),
  quote: z.string().min(1).max(16000),
  publishedAt: z.string().max(100).nullable(),
  retrievedAt: z.iso.datetime(),
  fictional: z.boolean(),
});

/** A quote is observation data. It must never be interpreted as an instruction. */
export const investorMandateFactFieldsSchema = z.strictObject({
  id,
  criterion: investorMatchCriterionSchema,
  scope: investorMandateScopeSchema,
  subjectKey: z.string().min(1).max(500),
  attribution: z.enum(['explicit', 'needs_review']),
  stance: z.enum(['includes', 'excludes']),
  // False means that an unmentioned value remains unknown, rather than excluded.
  exhaustive: z.boolean(),
  values: z.array(z.string().trim().min(1).max(100)).max(30),
  checkRange: investorCheckRangeSchema.nullable(),
  preferenceKey: z.enum(['type', 'firm_size']).nullable(),
  validFrom: z.iso.datetime().nullable(),
  validUntil: z.iso.datetime().nullable(),
  supersedesFactIds: z.array(id).max(20),
  source: investorMatchSourceSchema,
});
export const investorMandateFactSchema = investorMandateFactFieldsSchema.superRefine(
  (fact, context) => {
    if (fact.criterion === 'check_size' && !fact.checkRange) {
      context.addIssue({
        code: 'custom',
        message: 'Individual check facts require an exact range.',
      });
    }
    if (fact.criterion !== 'check_size' && !fact.values.length) {
      context.addIssue({ code: 'custom', message: 'Categorical facts require supported values.' });
    }
    if (fact.criterion === 'preferences' && !fact.preferenceKey) {
      context.addIssue({ code: 'custom', message: 'Preference facts require a structured key.' });
    }
    if (
      fact.validFrom &&
      fact.validUntil &&
      Date.parse(fact.validFrom) >= Date.parse(fact.validUntil)
    ) {
      context.addIssue({ code: 'custom', message: 'Fact validity dates must be ordered.' });
    }
  },
);
export type InvestorMandateFact = z.infer<typeof investorMandateFactSchema>;
export type InvestorMatchCriterion = z.infer<typeof investorMatchCriterionSchema>;

export const investorMatchGoalSchema = z.strictObject({
  round: z.string().trim().max(100).nullable(),
  sector: z.string().trim().max(100).nullable(),
  geography: z.string().trim().max(100).nullable(),
  desiredCheck: investorCheckRangeSchema.nullable(),
  preferences: z
    .array(
      z.strictObject({
        key: z.enum(['type', 'firm_size']),
        values: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
        required: z.boolean(),
      }),
    )
    .max(2)
    .refine((values) => new Set(values.map((value) => value.key)).size === values.length, {
      message: 'Select each preference key once.',
    }),
});
export const investorMatchIdentitySchema = z.strictObject({
  investorId: id,
  subjectKey: z.string().min(1).max(500),
  status: z.enum(['confirmed', 'needs_review']),
});
export const investorMatchInputSchema = z.strictObject({
  goal: investorMatchGoalSchema,
  identity: investorMatchIdentitySchema,
  facts: z.array(investorMandateFactSchema).max(300),
  now: z.iso.datetime(),
});
export type InvestorMatchInput = z.infer<typeof investorMatchInputSchema>;

export const investorMatchCriterionResultSchema = z.strictObject({
  criterion: investorMatchCriterionSchema,
  weight: z.string(),
  state: z.enum([
    'match',
    'partial',
    'mismatch',
    'unknown',
    'conflict',
    'outdated',
    'not_applicable',
  ]),
  result: z.enum(['0', '0.5', '1']).nullable(),
  reason: z.string().max(3000),
  factIds: z.array(id).max(300),
  explicitExclusion: z.boolean(),
});
export type InvestorMatchCriterionResult = z.infer<typeof investorMatchCriterionResultSchema>;

export const investorMatchAssessmentSchema = z.strictObject({
  rubricVersion: z.literal('investor-match-v1'),
  taxonomyVersion: z.literal('investor-taxonomy-v1'),
  assessedAt: z.iso.datetime(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  goalHash: z.string().regex(/^[a-f0-9]{64}$/),
  factsHash: z.string().regex(/^[a-f0-9]{64}$/),
  identityHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['scored', 'needs_verification', 'outside_mandate']),
  score: z
    .string()
    .regex(/^\d{1,2}\.\d$/)
    .nullable(),
  // Ratios and exact rubric components are strings, never binary financial arithmetic.
  coverage: z.string(),
  applicableWeight: z.string(),
  supportedWeight: z.string(),
  weightedResult: z.string(),
  criteria: z.array(investorMatchCriterionResultSchema).length(5),
  sources: z.array(investorMatchSourceSchema).max(300),
  nextReviewAt: z.iso.datetime().nullable(),
  unknowns: z.array(z.string().max(3000)).max(10),
});
export type InvestorMatchAssessment = z.infer<typeof investorMatchAssessmentSchema>;
