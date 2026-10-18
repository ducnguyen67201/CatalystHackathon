import { describe, expect, it, vi } from 'vitest';
import {
  investorMandateFactSchema,
  type InvestorMandateFact,
  type InvestorMatchInput,
} from '../src/contracts/InvestorMatch.js';
import {
  assessInvestorMatch,
  investorMatchInputHash,
  matchFactsFromEvidence,
} from '../src/features/InvestorMatch.js';
import type { Evidence } from '../src/contracts/Workspace.js';
import { profileSchema } from '../src/contracts/Workspace.js';
import { LiveResearch } from '../src/infrastructure/Research.js';

const now = '2026-10-17T12:00:00.000Z';
const subjectKey = 'https://fictional-fund.example/';
const identity: InvestorMatchInput['identity'] = {
  investorId: 'fictional-investor',
  subjectKey,
  status: 'confirmed',
};
const goal: InvestorMatchInput['goal'] = {
  round: 'Seed',
  sector: 'B2B SaaS',
  geography: 'Canada',
  desiredCheck: { min: '100000.0001', max: '500000.0001', currency: 'CAD' },
  preferences: [],
};
function fact(
  criterion: InvestorMandateFact['criterion'],
  overrides: Partial<InvestorMandateFact> = {},
): InvestorMandateFact {
  return investorMandateFactSchema.parse({
    id: `fictional-${criterion}`,
    criterion,
    scope: 'stated_mandate',
    subjectKey,
    attribution: 'explicit',
    stance: 'includes',
    exhaustive: true,
    values:
      criterion === 'stage'
        ? ['Seed']
        : criterion === 'sector'
          ? ['Enterprise software']
          : criterion === 'geography'
            ? ['North America']
            : [],
    checkRange:
      criterion === 'check_size' ? { min: '100000', max: '500000', currency: 'CAD' } : null,
    preferenceKey: null,
    validFrom: null,
    validUntil: null,
    supersedesFactIds: [],
    source: {
      evidenceId: `fictional-evidence-${criterion}`,
      researchRunId: null,
      url: subjectKey,
      quote: 'Fictional test mandate; not real investor evidence.',
      publishedAt: null,
      retrievedAt: '2026-10-01T00:00:00.000Z',
      fictional: true,
    },
    ...overrides,
  });
}
const fullFacts = () => [fact('stage'), fact('sector'), fact('geography'), fact('check_size')];
const assess = (
  facts: InvestorMandateFact[] = fullFacts(),
  changes: Partial<InvestorMatchInput> = {},
) => assessInvestorMatch({ goal, identity, facts, now, ...changes });
const criterion = (value: ReturnType<typeof assess>, key: InvestorMandateFact['criterion']) =>
  value.criteria.find((result) => result.criterion === key);

describe('Source-backed investor match', () => {
  it('uses the versioned rubric and taxonomy with source dates and exact components', () => {
    const assessment = assess();
    expect(assessment.status).toBe('scored');
    expect(assessment.score).toBe('10.0');
    expect(assessment.coverage).toBe('1');
    expect(assessment.applicableWeight).toBe('90');
    expect(assessment.supportedWeight).toBe('90');
    expect(assessment.weightedResult).toBe('90');
    expect(criterion(assessment, 'preferences')?.state).toBe('not_applicable');
    expect(assessment.sources[0]?.publishedAt).toBeNull();
    expect(assessment.sources.every((source) => source.fictional)).toBe(true);
  });

  it('supports a score at 70% weighted coverage but requires stage and geography', () => {
    const preferences: InvestorMatchInput['goal']['preferences'] = [
      { key: 'type', values: ['Angel'], required: false },
    ];
    const assessment = assess(
      fullFacts().filter((value) => value.criterion !== 'check_size'),
      { goal: { ...goal, preferences } },
    );
    expect(assessment.coverage).toBe('0.7');
    expect(assessment.status).toBe('scored');
    expect(assessment.score).toBe('10.0');
    expect(criterion(assessment, 'preferences')?.state).toBe('unknown');
    const missingEligibility = assess(
      fullFacts().filter((value) => value.criterion !== 'geography'),
    );
    expect(
      new Set(
        missingEligibility.criteria
          .filter((value) => value.result !== null)
          .map((value) => value.criterion),
      ),
    ).toEqual(new Set(['stage', 'sector', 'check_size']));
    expect(missingEligibility.score).toBeNull();
  });

  it('does not convert unknown or stale evidence into zero-valued mismatches', () => {
    const assessment = assess([fact('stage'), fact('geography')]);
    expect(assessment.supportedWeight).toBe('45');
    expect(assessment.weightedResult).toBe('45');
    expect(assessment.score).toBeNull();
    expect(criterion(assessment, 'sector')?.state).toBe('unknown');
  });

  it('compares individual check bounds exactly, including touching endpoints', () => {
    const matching = fact('check_size', {
      checkRange: { min: '500000.0001', max: '800000', currency: 'CAD' },
    });
    expect(
      criterion(assess([fact('stage'), fact('sector'), fact('geography'), matching]), 'check_size')
        ?.state,
    ).toBe('match');
    const disjoint = fact('check_size', {
      checkRange: { min: '500000.0002', max: '800000', currency: 'CAD' },
    });
    const assessment = assess([fact('stage'), fact('sector'), fact('geography'), disjoint]);
    expect(criterion(assessment, 'check_size')?.state).toBe('mismatch');
    expect(assessment.score).toBe('7.8');
  });

  it('keeps differing currencies unknown and never compares a raise total', () => {
    const usd = fact('check_size', {
      checkRange: { min: '100000', max: '500000', currency: 'USD' },
    });
    expect(
      criterion(assess([fact('stage'), fact('sector'), fact('geography'), usd]), 'check_size')
        ?.state,
    ).toBe('unknown');
    expect(
      criterion(assess(fullFacts(), { goal: { ...goal, desiredCheck: null } }), 'check_size')
        ?.state,
    ).toBe('unknown');
  });

  it('excludes historical participation from mandate coverage, at any age', () => {
    const historical = fullFacts().map((value) =>
      fact(value.criterion, { ...value, scope: 'historical_participation' }),
    );
    const assessment = assess(historical);
    expect(assessment.coverage).toBe('0');
    expect(assessment.score).toBeNull();
    expect(assessment.sources).toHaveLength(4);
  });

  it('requires attribution for the exact subject and reviewed investor identity', () => {
    expect(
      assess(fullFacts(), { identity: { ...identity, status: 'needs_review' } }).score,
    ).toBeNull();
    expect(
      assess(
        fullFacts().map((value) => ({ ...value, subjectKey: 'https://another-fund.example/' })),
      ).coverage,
    ).toBe('0');
    expect(
      assess(fullFacts().map((value) => ({ ...value, attribution: 'needs_review' }))).score,
    ).toBeNull();
    expect(assess([], { identity }).score).toBeNull();
  });

  it('retains contradictory sources instead of trusting the newest article', () => {
    const contradictory = fact('stage', {
      id: 'fictional-stage-new',
      values: ['Series A'],
      source: { ...fact('stage').source, retrievedAt: '2026-10-16T00:00:00.000Z' },
    });
    const assessment = assess([...fullFacts(), contradictory]);
    expect(criterion(assessment, 'stage')?.state).toBe('conflict');
    expect(assessment.score).toBeNull();
    const replacement = {
      ...contradictory,
      values: ['Seed'],
      supersedesFactIds: ['fictional-stage'],
    };
    expect(assess([...fullFacts(), replacement]).score).toBe('10.0');
  });

  it('blocks scoring for inconsistent exhaustive stage sets even when both include this round', () => {
    const second = fact('stage', { id: 'fictional-stage-extra', values: ['Seed', 'Series A'] });
    expect(criterion(assess([...fullFacts(), second]), 'stage')?.state).toBe('conflict');
  });

  it('shows explicit stage or geographic exclusion without a positive numerical score', () => {
    const excluded = fact('geography', { stance: 'excludes', values: ['Canada'] });
    const assessment = assess([fact('stage'), fact('sector'), excluded, fact('check_size')]);
    expect(assessment.status).toBe('outside_mandate');
    expect(assessment.score).toBeNull();
    expect(criterion(assessment, 'geography')?.explicitExclusion).toBe(true);
  });

  it('does not infer exclusions from categories omitted by a non-exhaustive statement', () => {
    const illustrative = fact('stage', { values: ['Series A'], exhaustive: false });
    const assessment = assess([
      illustrative,
      fact('sector'),
      fact('geography'),
      fact('check_size'),
    ]);
    expect(criterion(assessment, 'stage')?.state).toBe('unknown');
    expect(assessment.status).toBe('needs_verification');
  });

  it('keeps ambiguous stage and unsupported geographic categories unknown', () => {
    const broadStage = fact('stage', { values: ['Early stage'] });
    expect(
      criterion(
        assess([broadStage, fact('sector'), fact('geography'), fact('check_size')]),
        'stage',
      )?.state,
    ).toBe('unknown');
    const ambiguousRegion = fact('geography', { values: ['Ontario'] });
    expect(
      criterion(
        assess([fact('stage'), fact('sector'), ambiguousRegion, fact('check_size')]),
        'geography',
      )?.state,
    ).toBe('unknown');
  });

  it('enforces the 180-day review boundary and explicit validity instead of publication recency', () => {
    const retrievedAt = new Date(Date.parse(now) - 180 * 24 * 60 * 60 * 1000).toISOString();
    const stale = fact('stage', {
      source: { ...fact('stage').source, retrievedAt, publishedAt: now },
    });
    expect(
      criterion(assess([stale, fact('sector'), fact('geography'), fact('check_size')]), 'stage')
        ?.state,
    ).toBe('outdated');
    const stillValid = { ...stale, validUntil: '2026-12-01T00:00:00.000Z' };
    expect(assess([stillValid, fact('sector'), fact('geography'), fact('check_size')]).score).toBe(
      '10.0',
    );
    const expired = { ...fact('stage'), validUntil: now };
    expect(
      criterion(assess([expired, fact('sector'), fact('geography'), fact('check_size')]), 'stage')
        ?.state,
    ).toBe('outdated');
    const sameInstant = { ...fact('stage'), validUntil: '2026-10-17T12:00:00Z' };
    expect(
      criterion(
        assess([sameInstant, fact('sector'), fact('geography'), fact('check_size')]),
        'stage',
      )?.state,
    ).toBe('outdated');
    expect(
      criterion(
        assess([
          { ...fact('stage'), validFrom: '2026-11-01T00:00:00.000Z' },
          fact('sector'),
          fact('geography'),
          fact('check_size'),
        ]),
        'stage',
      )?.state,
    ).toBe('unknown');
  });

  it('allows partial credit only for fully supported, non-required structured preferences', () => {
    const preferences: InvestorMatchInput['goal']['preferences'] = [
      { key: 'type', values: ['Venture capital'], required: false },
      { key: 'firm_size', values: ['Small'], required: false },
    ];
    const matchingType = fact('preferences', {
      id: 'fictional-type',
      values: ['Venture capital'],
      preferenceKey: 'type',
    });
    const wrongSize = fact('preferences', {
      id: 'fictional-size',
      values: ['Large'],
      preferenceKey: 'firm_size',
    });
    const assessment = assess([...fullFacts(), matchingType, wrongSize], {
      goal: { ...goal, preferences },
    });
    expect(criterion(assessment, 'preferences')?.result).toBe('0.5');
    expect(assessment.score).toBe('9.5');
    const required = preferences.map((value) => ({ ...value, required: true }));
    expect(
      criterion(
        assess([...fullFacts(), matchingType, wrongSize], {
          goal: { ...goal, preferences: required },
        }),
        'preferences',
      )?.state,
    ).toBe('mismatch');
  });

  it('hashes semantic inputs independently from evaluation time, field order, and duplicate aliases', () => {
    const input = { goal, identity, facts: fullFacts(), now };
    const changed = {
      ...input,
      now: '2026-10-18T00:00:00.000Z',
      goal: {
        ...goal,
        round: ' seed ',
        desiredCheck: { min: '100000.0001', max: '500000.0001', currency: 'CAD' as const },
      },
      facts: fullFacts().reverse(),
    };
    expect(investorMatchInputHash(input)).toBe(investorMatchInputHash(changed));
    expect(investorMatchInputHash({ ...input, goal: { ...goal, round: 'Series A' } })).not.toBe(
      investorMatchInputHash(input),
    );
  });

  it('does not promote legacy deal observations, and retains authoritative saved provenance', () => {
    const evidence: Evidence = {
      id: 'fictional-saved-evidence',
      eventKey: 'fictional-event',
      mode: 'demo',
      investor: 'Fictional fund',
      title: 'Fictional source',
      url: subjectKey,
      excerpt: 'Fictional source text.',
      publishedAt: null,
      discoveredAt: now,
      stage: 'Seed',
      sector: 'B2B SaaS',
      geography: 'Canada',
      checkMin: '100000',
      checkMax: '500000',
      currency: 'CAD',
      explanation: 'Fictional test.',
      verified: false,
    };
    expect(matchFactsFromEvidence([evidence], identity)).toEqual([]);
    const facts = matchFactsFromEvidence(
      [{ ...evidence, mandateFacts: [fact('stage')] }],
      identity,
    );
    expect(facts[0]?.source.evidenceId).toBe(evidence.id);
    expect(facts[0]?.source.retrievedAt).toBe(now);
    expect(facts[0]?.source.fictional).toBe(true);
  });

  it('rejects unordered, zero, or oversized individual checks at the boundary', () => {
    expect(() =>
      fact('check_size', { checkRange: { min: '100', max: '99.9999', currency: 'CAD' } }),
    ).toThrow();
    expect(() =>
      fact('check_size', { checkRange: { min: '0', max: '1', currency: 'CAD' } }),
    ).toThrow();
    expect(() =>
      fact('check_size', {
        checkRange: { min: '10000000000000000', max: '10000000000000001', currency: 'CAD' },
      }),
    ).toThrow();
  });

  it('extracts quote-checked mandate facts in the existing bounded research call with conservative identity', async () => {
    const text = 'Fictional Fund invests in Seed companies. We invest in Canada.';
    const extractedFact = {
      criterion: 'stage',
      scope: 'stated_mandate',
      stance: 'includes',
      exhaustive: false,
      values: ['Seed'],
      checkRange: null,
      preferenceKey: null,
      validFrom: null,
      validUntil: null,
      quote: 'Fictional Fund invests in Seed companies.',
    };
    let sourceUrl = 'https://fictional-fund.example/mandate';
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(
        body.includes('numResults')
          ? Response.json({
              results: [{ title: 'Fictional mandate test', url: sourceUrl, text }],
            })
          : Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      investor: 'Fictional Fund',
                      matchesTarget: true,
                      stage: 'Seed',
                      sector: null,
                      geography: null,
                      checkMin: null,
                      checkMax: null,
                      currency: 'unspecified',
                      quote: extractedFact.quote,
                      explanation: 'Fictional test.',
                      comparableDeal: null,
                      mandateFacts: [
                        extractedFact,
                        {
                          ...extractedFact,
                          criterion: 'geography',
                          values: ['Canada'],
                          quote: 'Unsupported invented quotation.',
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const research = new LiveResearch(
        'fictional-exa-test',
        'fictional-openai-test',
        'test-model',
      );
      const profile = profileSchema.parse({
        name: 'Fictional startup',
        stage: 'Seed',
        sector: 'B2B SaaS',
        geography: 'Canada',
        raiseTarget: null,
        currency: 'CAD',
        goal: 'Private goal',
        version: 1,
        watchlist: [],
      });
      const target = { name: 'Fictional Fund', url: subjectKey };
      const official = await research.discover(profile, target);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(official[0]?.mandateFacts).toHaveLength(1);
      expect(official[0]?.mandateFacts?.[0]).toMatchObject({
        subjectKey,
        attribution: 'explicit',
        scope: 'stated_mandate',
      });
      expect(official[0]?.mandateFacts?.[0]?.source.researchRunId).toBe(official[0]?.researchRunId);
      sourceUrl = 'https://another-source.example/fund-profile';
      const external = await research.discover(profile, target);
      expect(external[0]?.mandateFacts?.[0]?.attribution).toBe('needs_review');
      expect(matchFactsFromEvidence(external, identity)).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
