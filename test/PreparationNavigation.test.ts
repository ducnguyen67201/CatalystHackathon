import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TargetInvestors } from '../src/web/GoalJourney.js';
import { goalJourneyViewSchema } from '../src/contracts/GoalJourney.js';
import {
  followupObjective,
  preparationScenarioHref,
  targetPreparationHref,
} from '../src/contracts/PreparationNavigation.js';
import type { GoalTrackPosition } from '../src/contracts/GoalJourney.js';

const targetId = '437b8de5-3b07-4436-b1c1-4503c206b769';
const cycleId = '00d6aeaf-4b01-426f-bd2c-12b598b0242e';
function track(href: string): GoalTrackPosition {
  return {
    targetId,
    investorId: 'e3177a01-7157-4588-a6db-634c7847c8a9',
    name: 'Fictional investor',
    cycleId,
    pitchId: null,
    briefVersionId: null,
    sessionId: null,
    evaluationId: null,
    fictional: true,
    outdated: false,
    hasGaps: false,
    steps: [],
    completed: 2,
    required: 5,
    nextAction: 'Continue saved preparation.',
    href,
  };
}

describe('resuming an investor preparation track', () => {
  it.each(['story', 'brief', 'practice', 'feedback', 'revision'])(
    'opens the saved %s step with its exact target and cycle',
    (step) => {
      const href = `/?targetId=${targetId}&preparationStep=${step}&preparationCycleId=${cycleId}`;
      expect(targetPreparationHref({ id: targetId, track: track(href) })).toBe(href);
    },
  );
  it('keeps changed-match review routed to Radar and unstarted tracks routed through preparation prerequisites', () => {
    const href = `/?page=radar&targetId=${targetId}`;
    expect(targetPreparationHref({ id: targetId, track: track(href) })).toBe(href);
    expect(targetPreparationHref({ id: targetId, track: null })).toBe(
      `/?preparationStep=brief&targetId=${targetId}`,
    );
  });
  it.each([
    'https://external.example/',
    '//external.example/',
    '/\\external.example/',
    'javascript:alert(1)',
  ])('does not follow an external or unsafe saved destination: %s', (href) => {
    expect(targetPreparationHref({ id: targetId, track: track(href) })).toBe(
      `/?preparationStep=brief&targetId=${targetId}`,
    );
  });
  it('keeps Continue as a direct link even while mutations are busy, without issuing a focus command', () => {
    const href = `/?targetId=${targetId}&preparationStep=practice&preparationCycleId=${cycleId}`;
    const data = goalJourneyViewSchema.parse({
      journey: null,
      revision: 0,
      intent: 'Fictional goal',
      position: null,
      assessments: [],
      events: [],
      historyAvailable: false,
      targets: [
        {
          id: targetId,
          investorId: 'e3177a01-7157-4588-a6db-634c7847c8a9',
          assessmentId: null,
          rationale: 'Fictional test selection',
          status: 'active',
          included: true,
          createdAt: '2026-10-17T12:00:00.000Z',
          updatedAt: '2026-10-17T12:00:00.000Z',
          eventId: null,
          name: 'Fictional investor',
          assessment: null,
          matchOutdated: false,
          track: {
            ...track(href),
            steps: ['story', 'investor', 'brief', 'practice', 'feedback', 'revision'].map((id) => ({
              id,
              complete: false,
              status: 'ready',
              reason: 'Fixture step',
            })),
          },
        },
      ],
    });
    const act = vi.fn(() => Promise.resolve(data));
    const html = renderToStaticMarkup(
      createElement(TargetInvestors, {
        controller: {
          data,
          busy: true,
          error: '',
          act,
          workspaceRevision: 0,
          refresh: () => undefined,
        },
      }),
    );
    expect(html).toContain(
      `<a class="button" href="${href.replaceAll('&', '&amp;')}">Continue preparation`,
    );
    expect(act).not.toHaveBeenCalled();
  });
});

describe('feedback to scenario navigation', () => {
  it('carries the feedback, question and evidence needs into a safely encoded editable objective', () => {
    const objective = followupObjective({
      title: 'Explain operating income & credits.',
      practiceQuestion: 'What changed?',
      missingInputs: ['Cash balance', 'Credit documentation'],
    });
    const url = new URL(preparationScenarioHref(objective, 'investor-1'), 'http://127.0.0.1');
    expect(url.pathname).toBe('/scenarios');
    expect(url.searchParams.get('objective')).toBe(
      'Explain operating income & credits. What changed? Evidence to gather: Cash balance; Credit documentation',
    );
    expect(url.searchParams.get('investor')).toBe('investor-1');
    expect(url.searchParams.has('generationId')).toBe(false);
  });
  it('respects the editable objective limit and leaves investor selection open when absent', () => {
    const url = new URL(preparationScenarioHref('x'.repeat(1200)), 'http://127.0.0.1');
    expect(url.searchParams.get('objective')).toHaveLength(1000);
    expect(url.searchParams.has('investor')).toBe(false);
    expect(
      followupObjective({
        title: 'Explain your margin.',
        practiceQuestion: 'What is missing?',
        missingInputs: [],
      }),
    ).toBe('Explain your margin. What is missing?');
  });
});
