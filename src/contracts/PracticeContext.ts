import { z } from 'zod';

const referenceSchema = z.string().min(1).max(100);

export const PracticeContextMode = {
  EMPTY: 'empty',
  PROVIDED: 'provided',
} as const;

const companySchema = z.strictObject({
  name: z.string().min(1).max(100),
  description: z.string().max(2000),
  fundraisingGoal: z.string().max(2000),
});

const financialContextSchema = z.strictObject({
  snapshotId: referenceSchema,
  fileName: z.string().min(1).max(300),
  currency: z.string().min(1).max(20),
  facts: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(200),
        amount: z
          .string()
          .regex(/^-?\d+(?:\.\d{1,4})?$/)
          .max(24),
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        sourceRow: z.int().positive(),
      }),
    )
    .max(100),
});

const meetingNoteSchema = z.strictObject({
  id: referenceSchema,
  title: z.string().min(1).max(300),
  text: z.string().min(1).max(10000),
  recordedAt: z.iso.datetime().nullable(),
});

const investorContextSchema = z.strictObject({
  name: z.string().min(1).max(200),
  firm: z.string().max(200).nullable(),
  sources: z
    .array(
      z.strictObject({
        url: z.url({ protocol: /^https?$/ }),
        title: z.string().min(1).max(300),
        excerpt: z.string().min(1).max(2000),
        retrievedAt: z.iso.datetime(),
      }),
    )
    .max(10),
});

const scenarioSchema = z.strictObject({
  objective: z.string().min(1).max(2000),
  openingQuestion: z.string().min(1).max(1000),
  followupTopics: z.array(z.string().min(1).max(500)).max(10),
});

/** Frozen inputs for one conversation. Null means unknown, never an inferred fact. */
export const practiceContextSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    version: z.literal(1),
    mode: z.literal(PracticeContextMode.EMPTY),
    company: z.null(),
    financials: z.null(),
    meetingNotes: z.array(meetingNoteSchema).max(0),
    investor: z.null(),
    scenario: z.null(),
  }),
  z.strictObject({
    version: z.literal(1),
    mode: z.literal(PracticeContextMode.PROVIDED),
    company: companySchema.nullable(),
    financials: financialContextSchema.nullable(),
    meetingNotes: z.array(meetingNoteSchema).max(10),
    investor: investorContextSchema.nullable(),
    scenario: scenarioSchema.nullable(),
  }),
]);

export type PracticeContext = z.infer<typeof practiceContextSchema>;

export function createEmptyPracticeContext(): PracticeContext {
  return practiceContextSchema.parse({
    version: 1,
    mode: PracticeContextMode.EMPTY,
    company: null,
    financials: null,
    meetingNotes: [],
    investor: null,
    scenario: null,
  });
}
