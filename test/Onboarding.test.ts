import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileLinksSchema } from '../src/contracts/ProfileLinks.js';
import { onboardingSchema } from '../src/contracts/Onboarding.js';
import { profileSchema, Stage } from '../src/contracts/Workspace.js';
import { DemoResearch, LiveResearch } from '../src/infrastructure/Research.js';
import { evaluateInvestorFit } from '../src/features/InvestorFit.js';

const profile = profileSchema.parse({
  name: 'Example',
  stage: Stage.UNKNOWN,
  sector: '',
  geography: '',
  raiseTarget: null,
  currency: 'CAD',
  goal: 'PRIVATE goal must not go to research',
  watchlist: [],
  version: 1,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('onboarding boundaries', () => {
  it('loads legacy onboarding as incomplete without inventing company or investor facts', () => {
    expect(onboardingSchema.parse({})).toEqual({
      step: 1,
      snapshotId: null,
      completedAt: null,
      meeting: null,
    });
  });

  it('canonicalizes all profile hints and rejects inappropriate destinations', () => {
    expect(
      profileLinksSchema.parse({
        linkedin: 'https://www.linkedin.com/in/alex/?trk=x',
        x: 'https://twitter.com/AlexVC',
        website: 'https://example.com/team?utm_source=x',
      }),
    ).toEqual({
      linkedin: 'https://linkedin.com/in/alex',
      x: 'https://x.com/alexvc',
      website: 'https://example.com/team',
    });
    for (const url of [
      'https://localhost',
      'https://127.0.0.1',
      'javascript:alert(1)',
      'https://user:password@example.com',
      'https://example.internal',
    ]) {
      expect(profileLinksSchema.safeParse({ website: url }).success).toBe(false);
    }
    expect(profileLinksSchema.safeParse({ linkedin: 'https://example.com/in/alex' }).success).toBe(
      false,
    );
    expect(profileLinksSchema.safeParse({ x: 'https://x.com/alex/status/123' }).success).toBe(
      false,
    );
  });

  it('keeps missing segment and raise details unknown in matching', async () => {
    const evidence = (await new DemoResearch().discover(profile))[0];
    if (!evidence) {
      throw new Error('Fixture missing');
    }
    expect(evaluateInvestorFit(profile, evidence)).toEqual({
      stage: 'unknown',
      sector: 'unknown',
      geography: 'unknown',
      checkRange: 'unknown',
      suitable: true,
    });
  });

  it('passes all public profile links into live discovery without sending private company goals', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new LiveResearch('test-exa', 'test-model', 'test-model').discover(profile, {
      name: 'Alex, Example Ventures',
      url: 'https://linkedin.com/in/alex',
      profileLinks: [
        'https://linkedin.com/in/alex',
        'https://x.com/alexvc',
        'https://example.com/team',
      ],
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(body).toContain('https://linkedin.com/in/alex');
    expect(body).toContain('https://x.com/alexvc');
    expect(body).toContain('https://example.com/team');
    expect(body).not.toContain('PRIVATE');
  });
});
