import { randomUUID } from 'node:crypto';
import { evidenceSchema } from '../../src/contracts/Workspace.js';
const now = () => new Date().toISOString();
/** Fictional evidence. Live mode is used only to exercise notification eligibility with a fake sender. */
export function radarEvidence(id = randomUUID()) {
  return evidenceSchema.parse({
    id,
    eventKey: id,
    mode: 'live',
    investor: 'Fictional Northline',
    title: 'Fictional investment',
    url: 'https://example.com/funding',
    excerpt: 'Fictional Northline funded ExampleCo.',
    publishedAt: null,
    discoveredAt: now(),
    stage: 'Seed',
    sector: 'B2B software',
    geography: 'Canada',
    checkMin: null,
    checkMax: null,
    currency: 'unspecified',
    explanation: 'Fictional comparable investment.',
    verified: false,
    researchRunId: randomUUID(),
    signal: {
      category: 'investment',
      headline: 'Fictional Northline backs ExampleCo',
      summary: 'Fictional seed investment.',
      whyItMatters: 'Fictional investment in the same sector.',
      supportingQuote: 'Fictional Northline funded ExampleCo.',
      notificationEligible: true,
      needsReview: false,
      canonicalEventKey: null,
    },
  });
}
