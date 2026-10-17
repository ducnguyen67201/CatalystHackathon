import { z } from 'zod';

export const SuggestionStatus = {
  SUGGESTED: 'suggested',
  TRACKED: 'tracked',
  DISMISSED: 'dismissed',
} as const;

export const DiscoveryFrequency = {
  WEEKLY: 'weekly',
  PAUSED: 'paused',
} as const;

export const suggestionLimit = 3;

/** Round totals describe the company financing, never an individual investor's check. */
export const comparableDealSchema = z.strictObject({
  company: z.string().min(1).max(200),
  sector: z.string().min(1).max(100),
  stage: z.string().min(1).max(100),
  geography: z.string().nullable(),
  announcedAt: z.string().nullable(),
  roundTotal: z.string().max(100).nullable(),
  participationQuote: z.string().min(1).max(1200),
  comparisonQuote: z.string().min(1).max(1200),
});

export const investorSuggestionSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  evidenceId: z.string(),
  profileVersion: z.int().positive(),
  status: z.enum(SuggestionStatus),
  createdAt: z.iso.datetime(),
});

export const discoveryStateSchema = z.strictObject({
  frequency: z.enum(DiscoveryFrequency).default(DiscoveryFrequency.WEEKLY),
  nextAt: z.iso.datetime().nullable().default(null),
  scheduledProfileVersion: z.int().nullable().default(null),
  lastAt: z.iso.datetime().nullable().default(null),
  lastJobId: z.string().nullable().default(null),
  note: z.string().default('Complete your company profile or choose Find more to begin.'),
  suggestions: z.array(investorSuggestionSchema).default([]),
});

export type DiscoveryState = z.infer<typeof discoveryStateSchema>;
export type InvestorSuggestion = z.infer<typeof investorSuggestionSchema>;

/** Public names only; excludes company financials and private meeting notes. */
export interface ResearchDiscoveryContext {
  knownInvestors: string[];
  excludedInvestors: string[];
}
