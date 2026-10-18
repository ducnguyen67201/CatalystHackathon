import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RadarInvestorList } from '../src/web/RadarInvestorList.js';
import type { RadarInvestorGroup } from '../src/contracts/RadarDelivery.js';

const group: RadarInvestorGroup = {
  key: 'investor:first',
  investorId: 'first',
  suggestionIds: [],
  name: 'Fictional Northline',
  updateCount: 25,
  unreadCount: 3,
  sourceCount: 2,
  latestAt: null,
  latestHeadline: null,
  latestEventId: null,
};
describe('investor navigation', () => {
  it('offers one labeled entry per identity and exposes the selected investor and unread count', () => {
    const html = renderToStaticMarkup(
      <RadarInvestorList
        groups={[
          group,
          {
            ...group,
            key: 'investor:second',
            investorId: 'second',
            name: 'Fictional Southline',
            unreadCount: 0,
          },
        ]}
        selectedKey={group.key}
        onSelect={() => undefined}
      />,
    );
    expect(html.match(/class="radar-person"/g)).toHaveLength(2);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('3 unread updates');
    expect(html).toContain('25');
    expect(html).toContain('Fictional Northline');
    expect(html).toContain('Fictional Southline');
  });
});

import { randomUUID } from 'node:crypto';
import { TargetInvestors } from '../src/web/GoalJourney.js';
import { goalJourneyViewSchema } from '../src/contracts/GoalJourney.js';
import { radarItemSchema } from '../src/contracts/RadarDelivery.js';
import { RadarInvestorCard } from '../src/web/RadarInvestorCard.js';

it('keeps preparation actions scoped to the selected investor while preserving the all-target view', () => {
  const firstId = randomUUID();
  const secondId = randomUUID();
  const makeTarget = (investorId: string, name: string) => ({
    id: randomUUID(),
    investorId,
    name,
    assessmentId: null,
    rationale: 'Fictional preparation target',
    status: 'active',
    included: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    eventId: null,
    assessment: null,
    matchOutdated: false,
    track: null,
  });
  const data = goalJourneyViewSchema.parse({
    journey: null,
    revision: 0,
    intent: 'Fictional goal',
    position: null,
    assessments: [],
    targets: [
      makeTarget(firstId, 'Fictional Northline'),
      makeTarget(secondId, 'Fictional Southline'),
    ],
    events: [],
    historyAvailable: false,
  });
  const controller: Parameters<typeof TargetInvestors>[0]['controller'] = {
    data,
    busy: false,
    error: '',
    workspaceRevision: 0,
    act: () => Promise.resolve(data),
    refresh: () => undefined,
  };
  const scoped = renderToStaticMarkup(
    <TargetInvestors controller={controller} investorId={firstId} />,
  );
  expect(scoped).toContain('Fictional Northline');
  expect(scoped).not.toContain('Fictional Southline');
  expect(scoped).toContain('Continue preparation');
  expect(renderToStaticMarkup(<TargetInvestors controller={controller} />)).toContain(
    'Fictional Southline',
  );
});

it('keeps every source and update action available in compact news and expands exact linked articles', () => {
  const item = radarItemSchema.parse({
    id: 'fictional-event',
    resultId: 'result',
    dedupeKey: 'key',
    researchRunId: null,
    jobId: null,
    investorId: randomUUID(),
    suggestionId: null,
    investorName: 'Fictional Northline',
    profileVersion: 1,
    signal: {
      category: 'investment',
      headline: 'Fictional funding headline',
      summary: 'Full fictional news summary',
      whyItMatters: 'Fictional relevance',
      supportingQuote: 'Exact fictional passage.',
      notificationEligible: false,
      needsReview: true,
      canonicalEventKey: null,
    },
    evidenceId: 'evidence',
    occurredAt: null,
    observedAt: new Date().toISOString(),
    committedAt: new Date().toISOString(),
    readAt: null,
    dismissedAt: null,
    supersedesEventId: null,
    historical: true,
    fictional: true,
    source: {
      url: 'https://example.com/source',
      title: 'Fictional source title',
      excerpt: 'Fictional excerpt',
    },
    delivery: null,
    stale: true,
  });
  const html = renderToStaticMarkup(
    <RadarInvestorCard
      item={item}
      compact
      expanded
      matchLabel="Needs verification"
      matchKind="unverified"
      savedTarget
      reviewing={false}
      busy={false}
      onReview={() => undefined}
      onToggleRead={() => undefined}
      onDismiss={() => undefined}
      onRetryEmail={() => undefined}
    />,
  );
  for (const preserved of [
    'Fictional funding headline',
    'Full fictional news summary',
    'Exact fictional passage.',
    'Fictional source title',
    'Fictional example',
    'Historical',
    'Older company context',
    'Mark read',
    'Dismiss update',
    'https://example.com/source',
  ])
    expect(html).toContain(preserved);
  expect(html).toContain('open=""');
  expect(html).not.toContain('Review target investor');
});
