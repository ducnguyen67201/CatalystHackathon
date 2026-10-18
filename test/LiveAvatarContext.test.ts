import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { splitAvatarContext } from '../src/infrastructure/LiveAvatarContext.js';
import { LiveAvatarProvider } from '../src/infrastructure/LiveAvatar.js';
import {
  createEmptyPracticeContext,
  interviewerContext,
  practiceContextSchema,
} from '../src/contracts/PracticeContext.js';

const settings = {
  apiKey: 'test-key',
  avatarId: 'b672e83f-398a-4701-ac89-949fe3b680ea',
  voiceId: 'b672e83f-398a-4701-ac89-949fe3b680ea',
  contextId: 'b822515d-d4a5-431c-bbc4-059bfca7b702',
};

describe('LiveAvatar context transport', () => {
  it.each([0, 999, 1000, 1001, 18540, 50000])(
    'reconstructs all %i characters from ordered provider placeholders',
    (length) => {
      const source = 'x'.repeat(length);
      const variables = splitAvatarContext(source);
      expect(Object.keys(variables)).toEqual(
        Array.from(
          { length: 50 },
          (_, index) => `brief_part_${String(index + 1).padStart(2, '0')}`,
        ),
      );
      expect(Object.values(variables).every((part) => part.length <= 1000)).toBe(true);
      expect(Object.values(variables).join('')).toBe(source);
    },
  );

  it('keeps non-BMP characters intact at variable boundaries', () => {
    const source = 'a'.repeat(999) + '😀' + 'é𠮷'.repeat(800);
    const variables = splitAvatarContext(source);
    expect(variables.brief_part_01).toBe('a'.repeat(999));
    expect(variables.brief_part_02?.startsWith('😀')).toBe(true);
    expect(
      Object.values(variables).every((part) => Buffer.from(part).toString('utf8') === part),
    ).toBe(true);
    expect(Object.values(variables).join('')).toBe(source);
  });

  it('rejects overflow instead of dropping the last character', () => {
    expect(() => splitAvatarContext('x'.repeat(50001))).toThrow('no context was truncated');
    expect(() => splitAvatarContext(('x'.repeat(999) + '😀').repeat(50))).toThrow(
      'exceeds the live interviewer',
    );
  });

  it('sends the full large briefing in a single token request without changing saved context', async () => {
    const context = practiceContextSchema.parse({
      ...createEmptyPracticeContext(),
      mode: 'provided',
      meetingNotes: Array.from({ length: 3 }, (_, index) => ({
        id: `note-${index}`,
        title: 'Fictional practice note',
        text: 'Fictional source passage. '.repeat(300),
        recordedAt: null,
      })),
    });
    const original = structuredClone(context);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        code: 1000,
        data: {
          session_id: '67a1123f-a915-48c8-9d4c-aae60df15846',
          session_token: 'test-token',
        },
      }),
    );
    const provider = new LiveAvatarProvider();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await provider.createToken(settings, context);
      const raw: unknown = JSON.parse(z.string().parse(fetchMock.mock.calls[0]?.[1]?.body));
      const body = z
        .object({ dynamic_variables: z.record(z.string(), z.string().max(1000)) })
        .parse(raw);
      expect(Object.values(body.dynamic_variables).join('')).toBe(
        JSON.stringify(interviewerContext(context)),
      );
      expect(context).toEqual(original);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails before contacting the provider when the full briefing cannot fit', async () => {
    const context = practiceContextSchema.parse({
      ...createEmptyPracticeContext(),
      mode: 'provided',
      meetingNotes: Array.from({ length: 6 }, (_, index) => ({
        id: `note-${index}`,
        title: 'Fictional oversized source',
        text: 'x'.repeat(10000),
        recordedAt: null,
      })),
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(new LiveAvatarProvider().createToken(settings, context)).rejects.toThrow(
        'exceeds the live interviewer',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
