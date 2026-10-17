import { z } from 'zod';
import { preparedPitchContextSchema } from './ConnectedPreparation.js';
import { peerComparisonSchema } from './PeerComparison.js';
import { questionWhySchema } from './QuestionWhy.js';

const text = z.string().trim().min(1).max(2000);
const reference = z.string().min(1).max(200);
const amount = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,4})?$/)
  .max(24);
const metadata = {
  id: reference,
  schemaVersion: z.literal(1),
  capturedAt: z.iso.datetime(),
};

const financialPeriodSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  sourceRow: z.int().positive(),
  revenue: amount,
  subscriptionRevenue: amount,
  cogs: amount,
  grossProfit: amount,
  expenses: amount,
  operatingIncome: amount,
  credit: amount,
  netIncome: amount,
});

export const scenarioSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...metadata,
    kind: z.literal('founder_initial'),
    provenance: z.literal('founder_provided'),
    profileVersion: z.int().positive(),
    meetingRevision: z.int().positive().nullable(),
    company: z.strictObject({
      name: z.string().min(1).max(100),
      stage: z.string().max(100).nullable(),
      sector: z.string().max(100).nullable(),
      geography: z.string().max(100).nullable(),
      raiseTarget: amount.nullable(),
      currency: z.string().max(20).nullable(),
      goal: z.string().max(1000),
    }),
    meetingNotes: z.string().max(5000).nullable(),
  }),
  z.strictObject({
    ...metadata,
    kind: z.literal('investor_research'),
    provenance: z.enum(['unverified_research', 'verified_evidence', 'fictional_demo']),
    evidenceId: reference,
    title: z.string().max(500),
    url: z.url({ protocol: /^https?$/ }).nullable(),
    excerpt: text,
    publishedAt: z.string().max(100).nullable(),
    retrievedAt: z.iso.datetime(),
    stage: z.string().max(200).nullable(),
    sector: z.string().max(200).nullable(),
    geography: z.string().max(200).nullable(),
    checkMin: amount.nullable(),
    checkMax: amount.nullable(),
    currency: z.string().max(20).nullable(),
  }),
  z.strictObject({
    ...metadata,
    kind: z.literal('financials'),
    provenance: z.enum(['unverified_financials', 'fictional_demo']),
    snapshots: z
      .array(
        z.strictObject({
          snapshotId: reference,
          hash: z.string().max(200),
          fileName: z.string().max(200),
          createdAt: z.iso.datetime(),
          currency: z.string().max(20).nullable(),
          fictional: z.boolean(),
          role: z.enum(['current', 'previous']),
          totalRows: z.int().positive(),
          periods: z.array(financialPeriodSchema).min(1).max(24),
        }),
      )
      .min(1)
      .max(2),
    omittedSnapshots: z.int().nonnegative(),
  }),
  z.strictObject({
    ...metadata,
    kind: z.literal('prior_calls'),
    provenance: z.enum(['practice_transcript', 'fictional_demo']),
    sessionId: reference,
    recordedAt: z.iso.datetime(),
    totalTurns: z.int().nonnegative(),
    turns: z
      .array(z.strictObject({ role: z.enum(['agent', 'user']), text: z.string().max(800) }))
      .max(6),
    review: z
      .strictObject({
        note: z.string().max(1000),
        covered: z.array(z.string().max(300)).max(5),
        missing: z.array(z.string().max(300)).max(5),
      })
      .nullable(),
  }),
]);
export type ScenarioSource = z.infer<typeof scenarioSourceSchema>;

export const coverageSchema = z.strictObject({
  kind: z.enum([
    'founder_initial',
    'investor_research',
    'financials',
    'pitch',
    'forecast',
    'prior_calls',
    'rehearsal_feedback',
  ]),
  status: z.enum(['available', 'missing', 'not_supported']),
  detail: z.string().max(500),
});

export const scenarioInputSchema = z.strictObject({
  preparation: preparedPitchContextSchema.optional(),
  peerComparison: peerComparisonSchema.optional(),
  schemaVersion: z.literal(1),
  capturedAt: z.iso.datetime(),
  investor: z.strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(100),
    url: z.url().nullable(),
    profileLinks: z.array(z.url()).max(3),
  }),
  objective: z.string().max(1000),
  sources: z.array(scenarioSourceSchema).min(1).max(14),
  coverage: z.array(coverageSchema).max(10),
  omittedEvidenceIds: z.array(reference),
  previousScenarios: z
    .array(z.strictObject({ title: z.string().max(200), objective: z.string().max(300) }))
    .max(12)
    .default([]),
});
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

const insightSchema = z.strictObject({
  text,
  kind: z.enum(['observation', 'hypothesis']),
  sourceIds: z.array(reference).min(1).max(11),
});
export const generatedScenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  title: z.string().min(1).max(200),
  situation: text,
  objective: text,
  challenge: text,
  rationale: z.array(insightSchema).min(1).max(5),
  openingQuestion: text,
  openingWhy: questionWhySchema.optional(),
  branches: z
    .array(z.strictObject({ condition: text, question: text, why: questionWhySchema.optional() }))
    .min(2)
    .max(4),
  successCriteria: z.array(text).min(2).max(4),
  unknowns: z.array(text).max(8),
  clarificationQuestions: z.array(text).max(5),
  personalization: z.enum(['research_grounded', 'limited_context']),
});
export const scenarioOutputSchema = z.strictObject({
  investorProfile: z.strictObject({
    themes: z.array(insightSchema).max(5),
    practiceApproach: z.array(insightSchema).min(1).max(4),
    unknowns: z.array(text).min(1).max(8),
  }),
  scenarios: z.array(generatedScenarioSchema).min(1).max(3),
});
export type ScenarioOutput = z.infer<typeof scenarioOutputSchema>;
export type GeneratedScenario = z.infer<typeof generatedScenarioSchema>;

/** New provider outputs require explanations; historical saved scenarios remain readable. */
export const scenarioGenerationOutputSchema = scenarioOutputSchema.extend({
  scenarios: z
    .array(
      generatedScenarioSchema.extend({
        openingWhy: questionWhySchema,
        branches: z
          .array(z.strictObject({ condition: text, question: text, why: questionWhySchema }))
          .min(2)
          .max(4),
      }),
    )
    .min(1)
    .max(3),
});

export const scenarioRequestSchema = z.strictObject({
  preparationCycleId: z.uuid().optional(),
  investorId: z.uuid(),
  objective: z.string().trim().max(1000).default(''),
  key: z.uuid(),
  expectedInputHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const scenarioSelectionSchema = z.strictObject({
  generationId: z.uuid(),
  scenarioId: z.string().regex(/^[a-z0-9-]{1,60}$/),
});
export type ScenarioSelection = z.infer<typeof scenarioSelectionSchema>;

export const generationSchema = z.strictObject({
  id: z.uuid(),
  jobId: z.uuid(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  input: scenarioInputSchema,
  inputHash: z.string().length(64),
  requestHash: z.string().length(64),
  promptVersion: z.string().max(100),
  model: z.string().max(200),
  mode: z.enum(['demo', 'live']),
  output: scenarioOutputSchema.nullable(),
  createdAt: z.iso.datetime(),
  error: z.string().nullable(),
});
export type ScenarioGeneration = z.infer<typeof generationSchema>;
export const generationViewSchema = generationSchema.extend({ outdated: z.boolean() });
export type ScenarioGenerationView = z.infer<typeof generationViewSchema>;
export const generationListSchema = z.array(generationViewSchema).max(20);

export const scenarioPreviewRequestSchema = scenarioRequestSchema.omit({
  key: true,
  expectedInputHash: true,
});
export const scenarioPreviewSchema = z.strictObject({
  input: scenarioInputSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(['demo', 'live']),
  model: z.string().max(200),
});
export type ScenarioPreview = z.infer<typeof scenarioPreviewSchema>;
