import { z } from 'zod';
import { publicProfileUrlSchema } from './ProfileLinks.js';

export const InvestorOrigin = {
  ADDED: 'added',
  DISCOVERED: 'discovered',
} as const;

export const CheckFrequency = {
  PAUSED: 'paused',
  DAILY: 'daily',
  WEEKLY: 'weekly',
} as const;

export const investorInputSchema = z.strictObject({
  name: z.string().trim().max(100).default(''),
  url: z.string().trim().min(1).max(500),
  frequency: z.enum(CheckFrequency).default(CheckFrequency.DAILY),
});

export const investorCheckSchema = z.strictObject({
  jobId: z.string(),
  checkedAt: z.iso.datetime(),
  profileVersion: z.int().positive(),
  evidenceIds: z.array(z.string()),
  addedIds: z.array(z.string()),
  changedIds: z.array(z.string()),
  note: z.string(),
});

export const trackedInvestorSchema = z.strictObject({
  id: z.uuid(),
  key: z.string(),
  name: z.string().min(1).max(100),
  url: z.url().nullable(),
  profileLinks: z.array(publicProfileUrlSchema).max(3).default([]),
  origin: z.enum(InvestorOrigin),
  discoveryEvidenceId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  frequency: z.enum(CheckFrequency),
  nextAt: z.iso.datetime().nullable(),
  checks: z.array(investorCheckSchema),
});

export type TrackedInvestor = z.infer<typeof trackedInvestorSchema>;
export type InvestorInput = z.infer<typeof investorInputSchema>;
export type InvestorCheck = z.infer<typeof investorCheckSchema>;

/** Public identity hints only; never company financial records or goals. */
export type InvestorResearchTarget = Pick<TrackedInvestor, 'name' | 'url'> & {
  profileLinks?: string[];
};
