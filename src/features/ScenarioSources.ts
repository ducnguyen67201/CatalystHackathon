import { createHash } from 'node:crypto';
import {
  scenarioInputSchema,
  type ScenarioInput,
  type ScenarioSource,
} from '../contracts/Scenario.js';
import type { Workspace } from '../contracts/Workspace.js';

export interface ScenarioSourceProvider {
  collect(state: Workspace, investorId: string, capturedAt: string): ScenarioSource[];
}

export class InitialInfoScenarioSource implements ScenarioSourceProvider {
  collect(state: Workspace, investorId: string, capturedAt: string): ScenarioSource[] {
    const meeting =
      state.onboarding.meeting?.investorId === investorId ? state.onboarding.meeting : null;
    const p = state.profile;
    return [
      {
        id: 'founder:' + String(p.version),
        kind: 'founder_initial',
        schemaVersion: 1,
        capturedAt,
        provenance: 'founder_provided',
        profileVersion: p.version,
        meetingRevision: meeting?.revision ?? null,
        company: {
          name: p.name,
          stage: p.stage === 'Not confirmed' ? null : p.stage,
          sector: p.sector || null,
          geography: p.geography || null,
          raiseTarget: p.raiseTarget,
          currency: p.currency === 'unspecified' ? null : p.currency,
          goal: p.goal,
        },
        meetingNotes: meeting?.notes || null,
      },
    ];
  }
}

function evidenceIds(state: Workspace, investorId: string): string[] {
  const investor = state.investors.find((item) => item.id === investorId);
  if (!investor) throw new Error('Investor unavailable. Choose a saved investor.');
  return [
    ...new Set([
      ...investor.checks.flatMap((check) => check.evidenceIds),
      ...(investor.discoveryEvidenceId ? [investor.discoveryEvidenceId] : []),
    ]),
  ];
}

export class InvestorResearchScenarioSource implements ScenarioSourceProvider {
  collect(state: Workspace, investorId: string, capturedAt: string): ScenarioSource[] {
    const records = evidenceIds(state, investorId)
      .map((id) => {
        const evidence = state.evidence.find((item) => item.id === id);
        if (!evidence)
          throw new Error(
            'Scenario source unavailable. Retry after restoring the referenced evidence.',
          );
        return evidence;
      })
      .filter((evidence) => evidence.excerpt.trim())
      .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt) || a.id.localeCompare(b.id));
    // Nine recent sources and one older source retain a bounded view of history.
    const selected = records.length > 10 ? [...records.slice(0, 9), ...records.slice(-1)] : records;
    return selected.map((e) => ({
      id: 'evidence:' + e.id,
      kind: 'investor_research',
      schemaVersion: 1,
      capturedAt,
      provenance:
        e.mode === 'demo'
          ? 'fictional_demo'
          : e.verified
            ? 'verified_evidence'
            : 'unverified_research',
      evidenceId: e.id,
      title: e.title.slice(0, 500),
      url: e.url,
      excerpt: e.excerpt.trim().slice(0, 2000),
      publishedAt: e.publishedAt,
      retrievedAt: e.discoveredAt,
      stage: e.stage,
      sector: e.sector,
      geography: e.geography,
      checkMin: e.checkMin,
      checkMax: e.checkMax,
      currency: e.currency === 'unspecified' ? null : e.currency,
    }));
  }
}

// Content hashes of the bundled fictional Tidewell.csv for each supported currency.
// Recognize legacy snapshots without relying on a filename or modifying their history.
const fictionalFinancialHashes = new Set([
  '65ee3b8465d3368d7f0b8f14591781e1644eb0acc8afbe23bd01f22def535df9',
  '4a8ebb4f8605ab010f270f6ee22f85ef67dfd087a37f9c773a11badeee17405a',
  'cb0f57020f241f996ccecc260bd4c0c394ebf509db0354d6616e0354ca9d68f3',
  '74c60b5f673aab6bb0870310387d796cd0e10023f9405a56aa5b0a3d3895e7b7',
  '4419272376f05a0fd6eecc6539c8455f7226540ba566f434612383124772aa52',
]);

export class FinancialScenarioSource implements ScenarioSourceProvider {
  collect(state: Workspace, _investorId: string, capturedAt: string): ScenarioSource[] {
    const ordered = [...state.snapshots].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
    const current = ordered.find((item) => item.id === state.onboarding.snapshotId) ?? ordered[0];
    if (!current) return [];
    const previous = ordered.find(
      (item) => item.id !== current.id && item.createdAt <= current.createdAt,
    );
    const selected = previous ? [current, previous] : [current];
    return [
      {
        id: 'financials:' + current.id,
        schemaVersion: 1,
        capturedAt,
        kind: 'financials',
        provenance: selected.some((item) => fictionalFinancialHashes.has(item.hash))
          ? 'fictional_demo'
          : 'unverified_financials',
        snapshots: selected.map((item, index) => ({
          snapshotId: item.id,
          hash: item.hash,
          fileName: item.fileName,
          createdAt: item.createdAt,
          currency: item.currency === 'unspecified' ? null : item.currency,
          fictional: fictionalFinancialHashes.has(item.hash),
          role: index === 0 ? 'current' : 'previous',
          totalRows: item.rows.length,
          periods: [...item.rows]
            .sort((a, b) => a.month.localeCompare(b.month))
            .slice(-24)
            .map(({ raw: _raw, ...row }) => row),
        })),
        omittedSnapshots: Math.max(0, state.snapshots.length - selected.length),
      },
    ];
  }
}

function relevantRehearsals(state: Workspace, investorId: string) {
  return state.rehearsals
    .filter((session) => {
      if (session.status !== 'completed' || !session.turns.length) return false;
      if (session.context?.version === 2) return session.context.input.investor.id === investorId;
      return state.briefs.some(
        (brief) => brief.id === session.briefId && brief.meeting?.investorId === investorId,
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export class RehearsalScenarioSource implements ScenarioSourceProvider {
  collect(state: Workspace, investorId: string, capturedAt: string): ScenarioSource[] {
    return relevantRehearsals(state, investorId)
      .slice(0, 2)
      .map((session) => ({
        id: 'practice:' + session.id,
        schemaVersion: 1,
        capturedAt,
        kind: 'prior_calls',
        provenance: session.mode === 'demo' ? 'fictional_demo' : 'practice_transcript',
        sessionId: session.id,
        recordedAt: session.createdAt,
        totalTurns: session.turns.length,
        turns: session.turns.slice(-6).map((turn) => ({ ...turn, text: turn.text.slice(0, 800) })),
        review: session.review
          ? {
              note: session.review.note.slice(0, 1000),
              covered: session.review.covered.slice(0, 5).map((item) => item.slice(0, 300)),
              missing: session.review.missing.slice(0, 5).map((item) => item.slice(0, 300)),
            }
          : null,
      }));
  }
}

export function assembleScenarioInput(
  state: Workspace,
  investorId: string,
  objective: string,
): ScenarioInput {
  const investor = state.investors.find((item) => item.id === investorId);
  if (!investor) throw new Error('Investor unavailable. Choose a saved investor.');
  const capturedAt = new Date().toISOString();
  const providers: ScenarioSourceProvider[] = [
    new InitialInfoScenarioSource(),
    new InvestorResearchScenarioSource(),
    new FinancialScenarioSource(),
    new RehearsalScenarioSource(),
  ];
  const sources = providers.flatMap((provider) => provider.collect(state, investorId, capturedAt));
  const research = sources.filter((source) => source.kind === 'investor_research');
  const financials = sources.find((source) => source.kind === 'financials');
  const rehearsals = sources.filter((source) => source.kind === 'prior_calls');
  return scenarioInputSchema.parse({
    schemaVersion: 1,
    capturedAt,
    investor: {
      id: investor.id,
      name: investor.name,
      url: investor.url,
      profileLinks: investor.profileLinks,
    },
    objective,
    sources,
    coverage: [
      {
        kind: 'founder_initial',
        status: 'available',
        detail: 'Saved company details and matching meeting notes; founder-provided.',
      },
      {
        kind: 'investor_research',
        status: research.length ? 'available' : 'missing',
        detail: research.length
          ? 'Up to ten saved excerpts, each limited to 2,000 characters; dates and uncertainty preserved.'
          : 'No saved research excerpts for this investor. Questions will use limited context.',
      },
      {
        kind: 'financials',
        status: financials ? 'available' : 'missing',
        detail: financials
          ? 'Selected current CSV plus one preceding snapshot; up to 24 recent months each, exact amounts and row references. Other snapshots and rows are excluded and counted.'
          : 'No saved financial CSV. No financial figures will be assumed.',
      },
      {
        kind: 'prior_calls',
        status: rehearsals.length ? 'available' : 'missing',
        detail: rehearsals.length
          ? `Last six turns (800 characters each) from ${rehearsals.length} completed practice sessions for this investor; ${Math.max(0, relevantRehearsals(state, investorId).length - rehearsals.length)} older sessions omitted. These are rehearsals, not real investor meetings.`
          : 'No completed practice transcripts linked to this investor. Open conversations and other investors are excluded.',
      },
      {
        kind: 'rehearsal_feedback',
        status: rehearsals.some((item) => item.review) ? 'available' : 'missing',
        detail:
          'Saved feedback from included practice sessions only; up to five covered and missing topics. Feedback is coaching, not verified company evidence.',
      },
      ...['pitch', 'forecast'].map((kind) => ({
        kind,
        status: 'not_supported',
        detail: 'Not connected to scenario generation yet.',
      })),
    ],
    omittedEvidenceIds: evidenceIds(state, investorId)
      .filter((id) => !research.some((source) => source.evidenceId === id))
      .sort(),
  });
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Capture time is not a data change. All selected content and source identities are. */
export function scenarioInputHash(input: ScenarioInput): string {
  return hashValue({
    ...input,
    previousScenarios: [],
    capturedAt: null,
    sources: input.sources.map((source) => ({ ...source, capturedAt: null })),
  });
}

/** Includes the prior exercise list for exact pre-generation review, unlike source freshness. */
export function scenarioReviewHash(input: ScenarioInput): string {
  return hashValue({
    sourceHash: scenarioInputHash(input),
    previousScenarios: input.previousScenarios,
  });
}
