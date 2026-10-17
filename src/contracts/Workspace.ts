import { radarSignalSchema, radarStateSchema } from './RadarDelivery.js';
import {
  evaluationContextSchema,
  evaluationRecordSchema,
  evaluationResponseRecordSchema,
} from './RehearsalEvaluation.js';
import { z } from 'zod';
import {
  comparableDealSchema,
  discoveryStateSchema,
  investorPreferencesSchema,
} from './InvestorDiscovery.js';
import { onboardingSchema, meetingSchema } from './Onboarding.js';
import { practiceContextSchema } from './PracticeContext.js';
import { trackedInvestorSchema } from './InvestorTracking.js';
import { guidedStateSchema } from './GuidedPractice.js';

export const ResearchMode = {
  DEMO: 'demo',
  LIVE: 'live',
} as const;

export const JobStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export const Stage = {
  UNKNOWN: 'Not confirmed',
  PRE_SEED: 'Pre-seed',
  SEED: 'Seed',
  SERIES_A: 'Series A',
  SERIES_B: 'Series B',
} as const;

export const moneySchema = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,4})?$/)
  .max(24);

export const idSchema = z.string().min(1).max(100);

const dateSchema = z.iso.datetime();

export const profileSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  stage: z.enum(Stage),
  sector: z.string().trim().max(100),
  geography: z.string().trim().max(100),
  raiseTarget: moneySchema.refine((value) => Number(value) > 0).nullable(),
  currency: z.enum(['unspecified', 'USD', 'CAD', 'EUR', 'GBP']),
  goal: z.string().max(1000),
  version: z.int().positive(),
  watchlist: z.array(z.string().trim().min(2).max(100)).max(5),
  investorPreferences: investorPreferencesSchema.optional(),
});

export type Profile = z.infer<typeof profileSchema>;

export const rowSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  revenue: moneySchema,
  subscriptionRevenue: moneySchema,
  cogs: moneySchema,
  grossProfit: moneySchema,
  expenses: moneySchema,
  operatingIncome: moneySchema,
  credit: moneySchema,
  netIncome: moneySchema,
  sourceRow: z.int().positive(),
  raw: z.record(z.string(), z.string()),
});

export type FinancialRow = z.infer<typeof rowSchema>;

export const snapshotSchema = z.strictObject({
  id: idSchema,
  hash: z.string(),
  fileName: z.string().max(200),
  createdAt: dateSchema,
  currency: profileSchema.shape.currency,
  rows: z.array(rowSchema).min(1).max(1200),
});

export type FinancialSnapshot = z.infer<typeof snapshotSchema>;

export const evidenceSchema = z.strictObject({
  id: idSchema,
  eventKey: z.string(),
  mode: z.enum(ResearchMode),
  investor: z.string(),
  title: z.string(),
  url: z.url().nullable(),
  excerpt: z.string().max(16000),
  publishedAt: z.string().nullable(),
  discoveredAt: dateSchema,
  stage: z.string().nullable(),
  sector: z.string().nullable(),
  geography: z.string().nullable(),
  checkMin: moneySchema.nullable(),
  checkMax: moneySchema.nullable(),
  currency: profileSchema.shape.currency,
  explanation: z.string(),
  verified: z.boolean(),
  comparableDeal: comparableDealSchema.optional(),
  signal: radarSignalSchema.nullable().optional(),
  researchRunId: z.uuid().optional(),
  supersedesEvidenceId: z.string().max(100).optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const fitSchema = z.strictObject({
  stage: z.enum(['aligned', 'mismatch', 'unknown']),
  sector: z.enum(['aligned', 'mismatch', 'unknown']),
  geography: z.enum(['aligned', 'mismatch', 'unknown']),
  checkRange: z.enum(['overlap', 'participation', 'unknown']),
  suitable: z.boolean(),
});

export type InvestorFit = z.infer<typeof fitSchema>;

export const findingSchema = z.strictObject({
  month: z.string(),
  sourceRow: z.int(),
  operatingIncome: moneySchema,
  credit: moneySchema,
  netIncome: moneySchema,
  question: z.string(),
  answer: z.string(),
});

export type Finding = z.infer<typeof findingSchema>;

export const reviewSchema = z.strictObject({
  answer: z.string(),
  missing: z.array(z.string()),
  covered: z.array(z.string()),
  note: z.string(),
});

export type AnswerReview = z.infer<typeof reviewSchema>;

export const briefSchema = z.strictObject({
  id: idSchema,
  createdAt: dateSchema,
  snapshotId: idSchema,
  profileVersion: z.int(),
  evidenceId: idSchema.nullable(),
  meeting: meetingSchema.nullable().default(null),
  investor: z.string(),
  fit: fitSchema,
  finding: findingSchema,
  openQuestions: z.array(z.string()),
  previousBriefId: idSchema.nullable(),
  review: reviewSchema.nullable(),
});

export type Brief = z.infer<typeof briefSchema>;

export const turnSchema = z.strictObject({
  role: z.enum(['agent', 'user']),
  text: z.string().min(1).max(10000),
});

export type TranscriptTurn = z.infer<typeof turnSchema>;

export const RehearsalMode = {
  DEMO: 'demo',
  ELEVENLABS: 'elevenlabs',
  TEXT: 'text',
  LIVEAVATAR: 'liveavatar',
} as const;

export const rehearsalSchema = z.strictObject({
  guided: guidedStateSchema.optional(),
  id: idSchema,
  briefId: idSchema.nullable(),
  mode: z.enum(RehearsalMode),
  status: z.enum(['active', 'awaiting_transcript', 'completed', 'partial']),
  createdAt: dateSchema,
  conversationId: z.string().nullable(),
  turns: z.array(turnSchema).max(200),
  review: reviewSchema.nullable(),
  context: practiceContextSchema.nullable().default(null),
  transcriptReceivedAt: dateSchema.nullable().default(null),
  avatarSessionId: z.uuid().nullable().default(null),
  evaluationContext: evaluationContextSchema.nullable().default(null),
  evaluations: z.array(evaluationRecordSchema).default([]),
  evaluationResponses: z.array(evaluationResponseRecordSchema).default([]),
  avatarCorrelationHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .default(null),
});

export type Rehearsal = z.infer<typeof rehearsalSchema>;

export const milestoneSchema = z.strictObject({
  id: idSchema,
  briefId: idSchema,
  snapshotId: idSchema,
  title: z.string().min(1).max(300),
  dueAt: dateSchema,
  status: z.enum(['open', 'reviewed', 'done']),
  createdAt: dateSchema,
  observation: z.string().nullable(),
});

export type Milestone = z.infer<typeof milestoneSchema>;

export const scheduleSchema = z.strictObject({
  frequency: z.enum(['paused', 'weekdays', 'weekly']),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use an IANA timezone'),
  nextAt: dateSchema.nullable(),
  lastAt: dateSchema.nullable(),
});

export type Schedule = z.infer<typeof scheduleSchema>;

export const noticeSchema = z.strictObject({
  id: idSchema,
  title: z.string(),
  message: z.string(),
  createdAt: dateSchema,
  read: z.boolean(),
});

export const workspaceSchema = z.strictObject({
  id: idSchema,
  revision: z.int().nonnegative(),
  profile: profileSchema,
  onboarding: onboardingSchema.default(() => onboardingSchema.parse({})),
  schedule: scheduleSchema,
  snapshots: z.array(snapshotSchema),
  evidence: z.array(evidenceSchema),
  briefs: z.array(briefSchema),
  rehearsals: z.array(rehearsalSchema),
  milestones: z.array(milestoneSchema),
  notices: z.array(noticeSchema),
  investors: z.array(trackedInvestorSchema).default([]),
  radar: radarStateSchema.default(() => radarStateSchema.parse({})),
  discovery: discoveryStateSchema.default(() => discoveryStateSchema.parse({})),
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const jobSchema = z.strictObject({
  id: idSchema,
  kind: z.string(),
  status: z.enum(JobStatus),
  attempts: z.int(),
  createdAt: dateSchema,
  result: z.string().nullable(),
  error: z.string().nullable(),
});

export type Job = z.infer<typeof jobSchema>;

export const capabilitiesSchema = z.strictObject({
  guidedReady: z.boolean().optional(),
  researchMode: z.literal('live'),
  voiceReady: z.boolean(),
  avatarReady: z.boolean().default(false),
  scenarioReady: z.boolean().default(false),
  scenarioMode: z.enum(['demo', 'live']).default('demo'),
  researchReady: z.boolean(),
  localOnly: z.literal(true),
});

export const stateResponseSchema = z.strictObject({
  workspace: workspaceSchema.omit({ radar: true }),
  jobs: z.array(jobSchema),
  capabilities: capabilitiesSchema,
});

export type StateResponse = z.infer<typeof stateResponseSchema>;

export const voiceResponseSchema = z.strictObject({
  session: rehearsalSchema,
  token: z.string().nullable(),
  conversationId: z.string().nullable(),
  context: z.string(),
  previousSummary: z.string(),
});

export type VoiceResponse = z.infer<typeof voiceResponseSchema>;

export const uploadSchema = z.strictObject({
  fileName: z.string().min(1).max(200),
  csv: z.string().min(1).max(2000000),
  currency: profileSchema.shape.currency,
});

export const finishSchema = z.strictObject({
  turns: z.array(turnSchema).max(200),
  completed: z.boolean(),
});

export const radarRequestSchema = z.strictObject({ key: z.uuid() });
