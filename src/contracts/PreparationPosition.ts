import { z } from 'zod';
export const preparationManifestSchema = z.strictObject({
  goal: z.string(),
  financial: z.string(),
  investor: z.string(),
  practice: z.string(),
});
export type PreparationManifest = z.infer<typeof preparationManifestSchema>;
export const preparationPositionSchema = z.strictObject({
  observedAt: z.iso.datetime(),
  revision: z.int().nonnegative(),
  financial: z
    .strictObject({
      snapshotId: z.string(),
      fileName: z.string(),
      period: z.string().nullable(),
      uploadedAt: z.iso.datetime(),
      operatingIncome: z.string().nullable(),
      currency: z.string(),
      fictional: z.boolean(),
    })
    .nullable(),
  investor: z
    .strictObject({
      id: z.uuid(),
      name: z.string(),
      lastCheckedAt: z.iso.datetime().nullable(),
      currentProfile: z.boolean(),
      nextAt: z.iso.datetime().nullable(),
      frequency: z.enum(['daily', 'weekly', 'paused']),
      status: z.enum(['never_checked', 'checked', 'queued', 'running', 'failed']),
    })
    .nullable(),
  pendingChanges: z.array(z.string()).max(5),
});
export type PreparationPosition = z.infer<typeof preparationPositionSchema>;
