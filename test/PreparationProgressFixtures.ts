import { randomUUID } from 'node:crypto';
import {
  rehearsalSchema,
  rowSchema,
  workspaceSchema,
  type Job,
} from '../src/contracts/Workspace.js';
import { preparationProgressSchema } from '../src/contracts/PreparationProgress.js';
import { projectPreparationProgress } from '../src/features/PreparationProgress.js';
import { evidenceFixture } from './EvidenceReviewFixtures.js';

/** Fictional preparation history for local tests and preview only. */
export function preparationFixture() {
  const { context, evaluation } = evidenceFixture();
  const session = rehearsalSchema.parse({
    id: randomUUID(),
    briefId: null,
    mode: 'text',
    status: 'completed',
    createdAt: context.capturedAt,
    conversationId: null,
    turns: [],
    review: null,
    evaluationContext: context,
    evaluations: [evaluation],
  });
  const rows = context.sources
    .filter((source) => source.kind === 'financial')
    .map((source) => {
      const raw: unknown = JSON.parse(source.text);
      return rowSchema.parse({ ...rowSchema.partial().parse(raw), raw: {} });
    });
  const state = workspaceSchema.parse({
    id: 'fictional-test',
    revision: 1,
    profile: {
      name: 'Fictional Tidewell',
      version: 1,
      stage: 'Not confirmed',
      sector: '',
      geography: '',
      currency: 'CAD',
      raiseTarget: null,
      goal: '',
      watchlist: [],
    },
    schedule: { frequency: 'paused', timezone: 'UTC', nextAt: null, lastAt: null },
    snapshots: [
      {
        id: 'fictional-snapshot',
        hash: 'fixture',
        fileName: 'Tidewell.csv',
        createdAt: context.capturedAt,
        currency: 'CAD',
        rows,
      },
    ],
    evidence: [],
    briefs: [],
    rehearsals: [],
    milestones: [],
    notices: [],
  });
  state.rehearsals.push(session);
  state.onboarding.snapshotId = 'fictional-snapshot';
  const jobs: Job[] = [];
  const project = () => preparationProgressSchema.parse(projectPreparationProgress(state, jobs));
  const savedEvaluation = session.evaluations[0];
  if (!savedEvaluation) throw new Error('Missing fixture evaluation');
  return { state, session, evaluation: savedEvaluation, jobs, project };
}
