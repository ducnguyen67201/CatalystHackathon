import { z } from 'zod';
import { investorPreferencesSchema } from './InvestorDiscovery.js';
import { evidenceSchema } from './Workspace.js';

export const ResearchRunKind = {
  INVESTOR: 'investor',
  DISCOVERY: 'discovery',
  RADAR: 'radar',
} as const;
export const ResearchRunStatus = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SOURCE_ONLY: 'source_only',
} as const;
export const ResearchRunOrigin = { WORKFLOW: 'workflow', IMPORT: 'import' } as const;
export const SourceDecision = { ACCEPTED: 'accepted', REJECTED: 'rejected' } as const;

/** Public retrieved content, retained as untrusted data rather than agent instructions. */
export const researchSourceSchema = z.object({
  title: z.string().max(2000),
  url: z.url().max(4000),
  text: z.string().max(10000).optional(),
  highlights: z.array(z.string().max(10000)).max(20).optional(),
  publishedDate: z.string().max(100).optional(),
});

export const researchSearchSchema = z.strictObject({
  query: z.string().max(5000),
  retrievedAt: z.iso.datetime(),
  sources: z.array(researchSourceSchema).max(10),
});

export const researchInputSchema = z.strictObject({
  profileVersion: z.int().positive(),
  investorPreferences: investorPreferencesSchema.optional(),
  segment: z.strictObject({
    stage: z.string().max(100),
    sector: z.string().max(100),
    geography: z.string().max(100),
  }),
  target: z
    .strictObject({
      name: z.string().max(100),
      url: z.url().nullable(),
      profileLinks: z.array(z.url()).max(3),
    })
    .nullable(),
  discovery: z
    .strictObject({
      knownInvestors: z.array(z.string().max(100)).max(20),
      excludedInvestors: z.array(z.string().max(100)).max(200),
    })
    .nullable(),
});

export const researchDecisionSchema = z.strictObject({
  sourceIndex: z.int().nonnegative(),
  url: z.url(),
  status: z.enum(SourceDecision),
  reason: z
    .enum([
      'no_text',
      'empty_completion',
      'identity_mismatch',
      'quote_not_found',
      'comparable_evidence_missing',
      'non_https',
    ])
    .nullable(),
  evidenceId: z.string().max(100).nullable(),
});

export const researchRunSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(ResearchRunKind),
  origin: z.enum(ResearchRunOrigin),
  status: z.enum(ResearchRunStatus),
  investorId: z.uuid().nullable(),
  jobId: z.string().min(1).max(150).nullable(),
  attempt: z.int().positive().nullable(),
  model: z.string().max(150).nullable(),
  input: researchInputSchema,
  searches: z.array(researchSearchSchema).max(2),
  decisions: z.array(researchDecisionSchema).max(5),
  evidence: z.array(evidenceSchema).max(5),
  failure: z
    .strictObject({
      reason: z.string().max(100),
      provider: z.enum(['exa', 'openai']).optional(),
      statusCode: z.int().min(100).max(599).optional(),
    })
    .nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
});

/** Imports can archive source material, never assert successful model extraction or trusted evidence. */
export const importResearchRunSchema = researchRunSchema
  .pick({
    id: true,
    kind: true,
    investorId: true,
    input: true,
    searches: true,
    startedAt: true,
    finishedAt: true,
  })
  .refine((value) => Date.parse(value.finishedAt) >= Date.parse(value.startedAt), {
    message: 'Completion must follow start.',
  });

export const researchRunQuerySchema = z.strictObject({
  investorId: z.uuid().optional(),
  kind: z.enum(ResearchRunKind).optional(),
  jobId: z.string().min(1).max(150).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const researchRunSummarySchema = researchRunSchema
  .omit({ input: true, searches: true, decisions: true, evidence: true })
  .extend({
    profileVersion: z.int().positive(),
    sourceCount: z.int().nonnegative(),
    evidenceCount: z.int().nonnegative(),
  });
export const researchRunListSchema = z.strictObject({
  items: z.array(researchRunSummarySchema),
  nextOffset: z.int().nonnegative().nullable(),
});
export type ResearchRun = z.infer<typeof researchRunSchema>;
export type ResearchSearch = z.infer<typeof researchSearchSchema>;
export type ResearchDecision = z.infer<typeof researchDecisionSchema>;
export type ResearchRunQuery = z.infer<typeof researchRunQuerySchema>;
export type ResearchRunList = z.infer<typeof researchRunListSchema>;
