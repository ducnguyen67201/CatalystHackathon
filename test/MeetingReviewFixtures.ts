import { readFileSync } from 'node:fs';
import { stateResponseSchema } from '../src/contracts/Workspace.js';
import { importFinancials, findFinancialQuestion } from '../src/features/Financials.js';
import { evidenceFixture } from './EvidenceReviewFixtures.js';

/** Fictional browser/unit-test evidence. Never imported by application code. */
export function meetingReviewFixture() {
  const { context, evaluation } = evidenceFixture();
  if (!evaluation.report) throw new Error('Missing fictional report');
  evaluation.report.coaching.strengths = [
    {
      statement: 'You identified the reporting period and sourced revenue.',
      significance: 'A specific period keeps the financial discussion grounded.',
      claimIds: ['revenue'],
      turnIds: ['answer'],
    },
  ];
  const snapshot = importFinancials(
    readFileSync('fixtures/Tidewell.csv', 'utf8'),
    'Fictional.csv',
    'CAD',
  );
  const brief = {
    id: 'fictional-brief',
    createdAt: context.capturedAt,
    snapshotId: snapshot.id,
    profileVersion: 1,
    evidenceId: null,
    meeting: null,
    investor: 'Fictional Seed Fund',
    fit: {
      stage: 'unknown',
      sector: 'unknown',
      geography: 'unknown',
      checkRange: 'unknown',
      suitable: true,
    },
    finding: findFinancialQuestion(snapshot),
    openQuestions: ['What evidence supports cash runway?'],
    previousBriefId: null,
    review: null,
  };
  return stateResponseSchema.parse({
    workspace: {
      id: 'tidewell',
      revision: 0,
      profile: {
        name: 'Fictional Tidewell',
        version: 1,
        stage: 'Seed',
        sector: 'software',
        geography: 'Canada',
        currency: 'CAD',
        raiseTarget: null,
        goal: 'Explain operating performance',
        watchlist: [],
      },
      onboarding: { completedAt: context.capturedAt, snapshotId: snapshot.id },
      snapshots: [snapshot],
      evidence: [],
      briefs: [brief],
      rehearsals: [
        {
          id: '519138dc-4b41-46ee-a70a-8a846fa79b93',
          briefId: brief.id,
          createdAt: context.capturedAt,
          mode: 'text',
          status: 'completed',
          conversationId: null,
          turns: evaluation.turns.map(({ role, text }) => ({ role, text })),
          review: null,
          evaluationContext: context,
          evaluations: [evaluation],
          transcriptReceivedAt: context.capturedAt,
        },
      ],
      milestones: [],
      notices: [],
      investors: [],
      schedule: { frequency: 'paused', timezone: 'America/Toronto', nextAt: null, lastAt: null },
    },
    jobs: [],
    capabilities: {
      researchMode: 'live',
      researchReady: false,
      voiceReady: false,
      localOnly: true,
    },
  });
}
