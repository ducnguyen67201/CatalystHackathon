import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { preparationFixture } from './PreparationProgressFixtures.js';
import { stateResponseSchema } from '../src/contracts/Workspace.js';
import { PreparationIntentForm } from '../src/web/PreparationIntentForm.js';
import { OnboardingPage } from '../src/web/OnboardingPage.js';
import { InvestorMeetingContext } from '../src/web/InvestorMeetingContext.js';
import { WorkspaceLayout } from '../src/web/WorkspaceLayout.js';
import { Page } from '../src/web/WorkspaceNavigation.js';
describe('goal-first experience', () => {
  it('has one goal input and one primary action', () => {
    const html = renderToStaticMarkup(
      <PreparationIntentForm intent="" busy={false} onSave={() => Promise.resolve()} />,
    );
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain('I want to raise my next round');
    expect(html).toContain('Build my preparation plan');
    expect(html).not.toContain('required hours');
  });
  it('finishes onboarding after the goal and keeps company details optional', () => {
    const { state } = preparationFixture();
    state.onboarding.step = 3;
    const response = stateResponseSchema.parse({
      workspace: stateResponseSchema.shape.workspace.strip().parse(state),
      jobs: [],
      capabilities: {
        researchReady: false,
        voiceReady: false,
        avatarReady: false,
        researchMode: 'live',
        localOnly: true,
      },
    });
    const html = renderToStaticMarkup(
      <OnboardingPage
        state={response}
        onComplete={() => Promise.resolve()}
        onRefresh={() => Promise.resolve()}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('Step 2 of 2');
    expect(html).toContain('Raise my next round');
    expect(html).toContain('Stage, funding target &amp; market · optional');
    expect(html).not.toContain('Who’s on the other side');
    const context = renderToStaticMarkup(
      <InvestorMeetingContext
        state={response}
        onRefresh={() => Promise.resolve()}
        onPrepare={() => undefined}
      />,
    );
    expect(context).toContain('Add conversation');
  });
  it('removes Meetings from navigation without removing investor radar', () => {
    const html = renderToStaticMarkup(
      <WorkspaceLayout
        page={Page.RADAR}
        onNavigate={() => undefined}
        researchReady={false}
        unread={0}
        onNotifications={() => undefined}
      >
        Content
      </WorkspaceLayout>,
    );
    expect(html).not.toContain('aria-label="Meetings"');
    expect(html).toContain('aria-label="Investor radar"');
  });
});
