import { z } from 'zod';

export const radarCategories = [
  'new_candidate',
  'investment',
  'fund_announcement',
  'thesis_change',
  'other_news',
] as const;
export const radarCategorySchema = z.enum(radarCategories);
export const radarSignalSchema = z.strictObject({
  category: radarCategorySchema,
  headline: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(1500),
  whyItMatters: z.string().trim().min(1).max(1000),
  supportingQuote: z.string().min(1).max(1200),
  notificationEligible: z.boolean(),
  needsReview: z.boolean(),
  canonicalEventKey: z.string().min(1).max(200).nullable(),
});
const id = z.string().min(1).max(100);
const date = z.iso.datetime();
export const radarEventSchema = z.strictObject({
  id,
  resultId: id,
  dedupeKey: id,
  researchRunId: z.uuid().nullable(),
  jobId: id.nullable(),
  investorId: z.uuid().nullable(),
  suggestionId: z.uuid().nullable(),
  investorName: z.string().min(1).max(200),
  profileVersion: z.int().positive(),
  signal: radarSignalSchema,
  evidenceId: id,
  occurredAt: z.string().max(100).nullable(),
  observedAt: date,
  committedAt: date,
  readAt: date.nullable(),
  dismissedAt: date.nullable(),
  supersedesEventId: id.nullable(),
  historical: z.boolean(),
  fictional: z.boolean(),
});
export const deliveryStatusSchema = z.enum([
  'pending',
  'sending',
  'retry_wait',
  'sent',
  'failed',
  'unknown',
  'skipped',
]);
export const emailMessageSchema = z.strictObject({
  from: z.email(),
  to: z.email(),
  subject: z.string().min(1).max(240),
  text: z.string().min(1).max(10000),
});
export const deliverySchema = z.strictObject({
  id: z.uuid(),
  eventId: id.nullable(),
  kind: z.enum(['event', 'confirmation']),
  recipientRevision: z.int().nonnegative(),
  status: deliveryStatusSchema,
  attempts: z.int().nonnegative(),
  uncertain: z.boolean().default(false),
  createdAt: date,
  nextAt: date,
  firstAttemptAt: date.nullable(),
  leaseToken: z.uuid().nullable(),
  leaseUntil: date.nullable(),
  providerMessageId: z.string().max(200).nullable(),
  acceptedAt: date.nullable(),
  error: z.string().max(200).nullable(),
  message: emailMessageSchema.nullable(),
});
export const notificationPreferencesSchema = z.strictObject({
  enabled: z.boolean().default(false),
  recipient: z.email().nullable().default(null),
  recipientRevision: z.int().nonnegative().default(0),
  categories: z
    .array(radarCategorySchema)
    .max(5)
    .default([...radarCategories]),
  challenge: z
    .strictObject({
      recipient: z.email(),
      hash: z.string(),
      expiresAt: date,
      requestedAt: date,
      attempts: z.int().nonnegative(),
      deliveryId: z.uuid(),
    })
    .nullable()
    .default(null),
});
export const radarStateSchema = z.strictObject({
  events: z.array(radarEventSchema).default([]),
  deliveries: z.array(deliverySchema).default([]),
  preferences: notificationPreferencesSchema.default(() => notificationPreferencesSchema.parse({})),
  backfilledAt: date.nullable().default(null),
});
export const workerHeartbeatSchema = z.strictObject({
  at: date,
  jobId: id.nullable(),
  state: z.enum(['waiting', 'checking', 'retrying', 'blocked']),
  lastCompletedAt: date.nullable(),
});
export const radarStatusSchema = z.strictObject({
  state: z.enum(['waiting', 'checking', 'retrying', 'blocked', 'offline', 'paused']),
  heartbeatAt: date.nullable(),
  lastCompletedAt: date.nullable(),
  nextAt: date.nullable(),
});
export const radarQuerySchema = z.strictObject({
  investorId: z.uuid().optional(),
  suggestionId: z.uuid().optional(),
  category: radarCategorySchema.optional(),
  unread: z.enum(['true', 'false']).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const publicDeliverySchema = deliverySchema.pick({
  id: true,
  status: true,
  attempts: true,
  nextAt: true,
  acceptedAt: true,
  error: true,
});
export const radarItemSchema = radarEventSchema.extend({
  source: z.strictObject({ url: z.url().nullable(), title: z.string(), excerpt: z.string() }),
  delivery: publicDeliverySchema.nullable(),
  stale: z.boolean(),
});
export const radarFeedSchema = z.strictObject({
  items: z.array(radarItemSchema),
  nextCursor: id.nullable(),
  unreadCount: z.int().nonnegative(),
  status: radarStatusSchema,
});
export const publicPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  recipient: z.string().nullable(),
  categories: z.array(radarCategorySchema),
  ready: z.boolean(),
  confirmationPending: z.boolean(),
  confirmationDelivery: publicDeliverySchema.nullable(),
});
export const updatePreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  categories: z.array(radarCategorySchema).max(5),
});
export type RadarEvent = z.infer<typeof radarEventSchema>;
export type RadarSignal = z.infer<typeof radarSignalSchema>;
export type RadarState = z.infer<typeof radarStateSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type WorkerHeartbeat = z.infer<typeof workerHeartbeatSchema>;
export type RadarFeed = z.infer<typeof radarFeedSchema>;
export type RadarItem = z.infer<typeof radarItemSchema>;

/** Complete per-identity counts, independent of the paginated event view. */
export const radarInvestorGroupSchema = z.strictObject({
  key: z.string().min(1),
  investorId: z.uuid().nullable(),
  suggestionIds: z.array(z.uuid()),
  name: z.string().min(1),
  updateCount: z.int().nonnegative(),
  unreadCount: z.int().nonnegative(),
  sourceCount: z.int().nonnegative(),
  latestEventId: z.string().nullable(),
  latestHeadline: z.string().nullable(),
  latestAt: z.iso.datetime().nullable(),
});
export const radarInvestorGroupsSchema = z.object({ items: z.array(radarInvestorGroupSchema) });
export type RadarInvestorGroup = z.infer<typeof radarInvestorGroupSchema>;
