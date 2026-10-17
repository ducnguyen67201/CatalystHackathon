import { describe, expect, it } from 'vitest';
import {
  createEmptyPracticeContext,
  practiceContextSchema,
} from '../src/contracts/PracticeContext.js';
import { rehearsalSchema } from '../src/contracts/Workspace.js';
import { NoopPracticeContextProvider } from '../src/features/PracticeContextProvider.js';

describe('voice context boundary', () => {
  it('returns a fresh empty context without loading company data', async () => {
    const provider = new NoopPracticeContextProvider();
    const first = await provider.loadContext();
    const second = await provider.loadContext();
    expect(first).toEqual({
      version: 1,
      mode: 'empty',
      company: null,
      financials: null,
      meetingNotes: [],
      investor: null,
      scenario: null,
    });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.meetingNotes).not.toBe(first.meetingNotes);
  });

  it('cannot label supplied company facts as an empty context', () => {
    expect(
      practiceContextSchema.safeParse({
        ...createEmptyPracticeContext(),
        company: { name: 'Tidewell', description: '', fundraisingGoal: '' },
      }).success,
    ).toBe(false);
    expect(
      practiceContextSchema.safeParse({ ...createEmptyPracticeContext(), prompt: 'override' })
        .success,
    ).toBe(false);
  });

  it('reserves typed inputs for future financial and meeting-note adapters', () => {
    const supplied = {
      ...createEmptyPracticeContext(),
      mode: 'provided',
      financials: {
        snapshotId: 'snapshot-1',
        fileName: 'Example.csv',
        currency: 'unspecified',
        facts: [{ label: 'Operating income', amount: '-10.25', month: '2026-07', sourceRow: 2 }],
      },
      meetingNotes: [
        {
          id: 'note-1',
          title: 'Founder discussion',
          text: 'Explain the business.',
          recordedAt: null,
        },
      ],
    };
    expect(practiceContextSchema.parse(supplied).financials?.facts[0]?.amount).toBe('-10.25');
    expect(
      practiceContextSchema.safeParse({
        ...supplied,
        financials: {
          ...supplied.financials,
          facts: [{ label: 'Operating income', amount: 10.25, month: '2026-07', sourceRow: 2 }],
        },
      }).success,
    ).toBe(false);
  });

  it('reads old rehearsal payloads without fabricating a context or verification receipt', () => {
    const session = rehearsalSchema.parse({
      id: 'old-session',
      briefId: 'old-brief',
      mode: 'elevenlabs',
      status: 'completed',
      createdAt: '2026-10-16T00:00:00Z',
      conversationId: 'old-provider-id',
      turns: [],
      review: null,
    });
    expect(session.context).toBeNull();
    expect(session.transcriptReceivedAt).toBeNull();
    expect(session.briefId).toBe('old-brief');
  });
});
