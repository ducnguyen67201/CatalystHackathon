import { evidenceSchema, type Evidence, type Profile } from '../../src/contracts/Workspace.js';
import type { ResearchProvider, ResearchExecution } from '../../src/features/ResearchProvider.js';
import type { InvestorResearchTarget } from '../../src/contracts/InvestorTracking.js';
import type { ResearchDiscoveryContext } from '../../src/contracts/InvestorDiscovery.js';

/** Deterministic test data only; never included in application builds. */
export class ResearchFixture implements ResearchProvider {
  readonly mode = 'demo';

  async discover(
    profile: Profile,
    target?: InvestorResearchTarget,
    discovery?: ResearchDiscoveryContext,
    _execution?: ResearchExecution,
  ): Promise<Evidence[]> {
    if (discovery) {
      return ['Cedar Ventures', 'Harbour Capital', 'Maple Seed Partners', 'Summit Ventures']
        .map((investor, index) =>
          evidenceSchema.parse({
            id: `demo-comparable-${index}`,
            eventKey: `demo-comparable-${index}`,
            mode: 'demo',
            investor,
            title: `Fictional example: ${investor} joins ExampleCo ${index + 1}'s seed round`,
            url: null,
            excerpt: `Fictional example: ${investor} participated in ExampleCo ${index + 1}'s CAD 2 million seed round. ExampleCo builds B2B software in Canada.`,
            publishedAt: '2026-10-01T00:00:00Z',
            discoveredAt: new Date().toISOString(),
            stage: null,
            sector: null,
            geography: null,
            checkMin: null,
            checkMax: null,
            currency: 'unspecified',
            explanation:
              'Fictional comparable funding example; investor mandate and individual check size remain unknown.',
            verified: false,
            comparableDeal: {
              company: `ExampleCo ${index + 1}`,
              sector: 'B2B software',
              stage: 'Seed',
              geography: 'Canada',
              announcedAt: '2026-10-01',
              roundTotal: 'CAD 2 million',
              participationQuote: `${investor} participated in ExampleCo ${index + 1}'s CAD 2 million seed round.`,
              comparisonQuote: 'ExampleCo builds B2B software in Canada.',
            },
          }),
        )
        .filter(
          (record) =>
            record.comparableDeal?.stage === profile.stage &&
            record.comparableDeal.sector === profile.sector,
        );
    }
    if (target && target.name.toLowerCase() !== 'northline ventures') {
      const examples = await this.discover(profile, undefined, {
        knownInvestors: [],
        excludedInvestors: [],
      });
      return examples.filter(
        (record) => record.investor.toLowerCase() === target.name.toLowerCase(),
      );
    }
    return Promise.resolve([
      evidenceSchema.parse({
        id: 'demo-northline',
        eventKey: 'demo-northline-seed-fund-v1',
        mode: 'demo',
        investor: 'Northline Ventures',
        title: 'Northline announces a Canadian software seed fund',
        url: null,
        excerpt:
          'Fictional demo announcement: Northline focuses on seed-stage B2B software in Canada, with example CAD checks of 500,000–1,500,000.',
        publishedAt: null,
        discoveredAt: new Date().toISOString(),
        stage: 'Seed',
        sector: 'B2B software',
        geography: 'Canada',
        checkMin: '500000',
        checkMax: '1500000',
        currency: 'CAD',
        explanation:
          'A fictional opportunity to demonstrate sourced matching. Confirm company stage, sector, location and currency.',
        verified: false,
      }),
    ]);
  }
}
