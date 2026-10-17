import { createHash } from 'node:crypto';
import type { PracticeContext } from '../contracts/PracticeContext.js';
import type { Workspace, Rehearsal, Job } from '../contracts/Workspace.js';
import type {
  PreparationCycle,
  PreparationRecommendation,
  PreparedPitchContext,
  ConnectedPreparationView,
} from '../contracts/ConnectedPreparation.js';
import { ConflictError } from './WorkspaceStore.js';

export const connectedHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function connectedSourceHash(state: Workspace) {
  const snapshot = state.snapshots.find((s) => s.id === state.onboarding.snapshotId);
  const goal = state.preparation?.goals.at(-1);
  return connectedHash({
    goal,
    profile: state.profile,
    snapshot: snapshot ? { id: snapshot.id, hash: snapshot.hash } : null,
  });
}
export function investorSources(state: Workspace, investorId: string) {
  const investor = state.investors.find((i) => i.id === investorId);
  if (!investor) return [];
  const ids = new Set([
    ...investor.checks
      .filter((c) => c.profileVersion === state.profile.version)
      .flatMap((c) => c.evidenceIds),
    ...(investor.discoveryEvidenceId ? [investor.discoveryEvidenceId] : []),
  ]);
  return state.evidence.filter((e) => ids.has(e.id)).slice(-10);
}
export function connectedInvestorHash(state: Workspace, investorId: string) {
  const investor = state.investors.find((i) => i.id === investorId);
  return connectedHash({
    investor: investor ? { id: investor.id, name: investor.name, url: investor.url } : null,
    sources: investorSources(state, investorId),
  });
}
export function cycleOutdated(state: Workspace, cycle: PreparationCycle) {
  return (
    cycle.sourceHash !== connectedSourceHash(state) ||
    (!!cycle.investorId &&
      (!state.investors.some((i) => i.id === cycle.investorId) ||
        cycle.investorSourceHash !== connectedInvestorHash(state, cycle.investorId)))
  );
}
const known = (value: string | null | undefined) =>
  value?.trim() && value.trim().toLowerCase() !== 'not confirmed' ? value.trim() : null;
const normalized = (value: string) => value.trim().toLowerCase();
export function preparationRecommendations(state: Workspace): PreparationRecommendation[] {
  const goal = state.preparation?.goals.at(-1);
  const candidates = [
    ...state.investors.map((i) => ({
      investorId: i.id,
      suggestionId: null,
      name: i.name,
      records: investorSources(state, i.id),
    })),
    ...state.discovery.suggestions
      .filter((s) => s.status === 'suggested' && s.profileVersion === state.profile.version)
      .map((s) => ({
        investorId: null,
        suggestionId: s.id,
        name: s.name,
        records: state.evidence.filter((e) => e.id === s.evidenceId),
      })),
  ];
  const unique = new Set<string>();
  const ranked = candidates
    .filter((c) => {
      const key = normalized(c.name);
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    })
    .map((c) => {
      const reasons: string[] = [];
      const unknowns: string[] = [
        'Current investment mandate, check size and application route require confirmation.',
      ];
      let aligned = 0,
        mismatches = 0;
      const criteria = [
        ['stage', known(goal?.round) ?? known(state.profile.stage)],
        ['sector', known(state.profile.sector)],
        ['geography', known(state.profile.geography)],
      ] as const;
      for (const [criterion, target] of criteria) {
        const values = [
          ...new Set(c.records.map((e) => known(e[criterion])).filter((v): v is string => !!v)),
        ];
        if (!target || !values.length)
          unknowns.push(
            `${criterion}: insufficient confirmed company context or saved investor observations.`,
          );
        else if (values.length > 1) {
          mismatches++;
          unknowns.push(`${criterion}: conflicting observations (${values.join(', ')}).`);
        } else if (values[0] && normalized(values[0]) === normalized(target)) {
          aligned++;
          reasons.push(
            `${criterion}: saved observation “${values[0]}” aligns with your ${criterion === 'stage' ? 'intended round' : 'company context'} “${target}”.`,
          );
        } else {
          mismatches++;
          unknowns.push(
            `${criterion}: observation “${values[0]}” differs from “${target}”; review the tradeoff.`,
          );
        }
      }
      if (goal?.previousRounds !== null && goal?.previousRounds !== undefined)
        reasons.push(
          `You confirmed ${goal.previousRounds} prior financing round(s); intended round is separately recorded as ${goal.round}. Prior financing alone does not establish investor eligibility.`,
        );
      if (!c.records.length)
        unknowns.push('No saved research for this candidate. Run an explicit investor check.');
      return {
        value: {
          investorId: c.investorId,
          suggestionId: c.suggestionId,
          name: c.name,
          label:
            aligned && !mismatches
              ? 'Recommended to review'
              : mismatches
                ? 'Review tradeoffs'
                : 'Needs verification',
          reasons,
          unknowns: unknowns.slice(0, 6),
          sources: c.records.map((e) => ({
            id: e.id,
            title: e.title.slice(0, 500),
            excerpt: e.excerpt.slice(0, 16000),
            url: e.url,
            recordedAt: e.discoveredAt,
            fictional: e.mode === 'demo',
          })),
          stage: c.records.at(-1)?.stage ?? null,
          sector: c.records.at(-1)?.sector ?? null,
          geography: c.records.at(-1)?.geography ?? null,
        } satisfies PreparationRecommendation,
        aligned,
        mismatches,
      };
    });
  return ranked
    .sort(
      (a, b) =>
        a.mismatches - b.mismatches ||
        b.aligned - a.aligned ||
        a.value.name.localeCompare(b.value.name),
    )
    .slice(0, 3)
    .map((r) => r.value);
}
export function preparedPitchContext(state: Workspace, cycleId: string): PreparedPitchContext {
  const saved = state.preparation?.connected;
  const cycle = saved?.cycles.at(-1);
  const pitch = saved?.pitches.find((p) => p.id === cycle?.pitchId);
  if (
    !cycle ||
    cycle.id !== cycleId ||
    cycle.closedAt ||
    cycleOutdated(state, cycle) ||
    !pitch ||
    !cycle.pitchApprovedAt ||
    !cycle.briefApprovedAt ||
    !cycle.brief ||
    !cycle.investorId ||
    !cycle.investorSourceHash
  )
    throw new ConflictError(
      'Preparation changed. Review the current pitch and brief before generating or practising.',
    );
  return {
    cycleId,
    pitchId: pitch.id,
    goalId: cycle.goalId,
    sourceHash: cycle.sourceHash,
    investorSourceHash: cycle.investorSourceHash,
    pitch: pitch.text,
    brief: cycle.brief,
    sources: pitch.sources,
    fictional:
      pitch.fictional || investorSources(state, cycle.investorId).some((e) => e.mode === 'demo'),
  };
}
export function linkedPractices(state: Workspace, cycleId: string): Rehearsal[] {
  return state.rehearsals
    .filter((r) => r.context?.version === 2 && r.context.input.preparation?.cycleId === cycleId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export function latestLoopReview(state: Workspace, cycle: PreparationCycle, jobs: Job[]) {
  const session = linkedPractices(state, cycle.id).at(-1);
  if (!session) return null;
  const evaluation = session.evaluations.at(-1);
  const report =
    evaluation?.status === 'completed' &&
    evaluation.scope === 'complete' &&
    session.status === 'completed'
      ? evaluation.report
      : null;
  const evaluationJob = evaluation
    ? jobs
        .filter((job) => job.kind === `evaluate:${session.id}:${evaluation.id}`)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  const failedJob = evaluationJob?.status === 'failed';
  const status = report
    ? 'ready'
    : failedJob
      ? 'failed'
      : session.status === 'partial'
        ? 'unavailable'
        : !session.turns.length || session.status !== 'completed'
          ? 'awaiting_transcript'
          : evaluation?.status === 'queued'
            ? 'pending'
            : 'unavailable';
  return {
    session,
    evaluation,
    report,
    public: {
      id: session.id,
      evaluationId: evaluation?.id ?? null,
      status,
      summary: report?.coaching.summary ?? evaluation?.reason ?? null,
      hasGaps:
        !!report &&
        (report.coaching.items.length > 0 || report.checks.some((c) => c.support !== 'supported')),
    } satisfies NonNullable<ConnectedPreparationView['latestSession']>,
  };
}
export function connectedSteps(
  state: Workspace,
  jobs: Job[],
  generation: ConnectedPreparationView['generation'],
): ConnectedPreparationView['steps'] {
  const cycle = state.preparation?.connected?.cycles.at(-1);
  const outdated = !!cycle && cycleOutdated(state, cycle);
  const review = cycle ? latestLoopReview(state, cycle, jobs) : null;
  const feedback = cycle?.feedback;
  const reviewed = !!(
    review?.report &&
    feedback &&
    feedback.evaluationId === review.evaluation?.id &&
    feedback.sessionId === review.session.id
  );
  const submitted = !!review?.session.turns.length && review.session.status === 'completed';
  const statuses: ConnectedPreparationView['steps'][number]['status'][] = [
    cycle?.pitchApprovedAt ? 'complete' : cycle ? 'needs_review' : 'ready',
    cycle?.investorId ? 'complete' : cycle?.pitchApprovedAt ? 'ready' : 'blocked',
    cycle?.briefApprovedAt ? 'complete' : cycle?.investorId ? 'needs_review' : 'blocked',
    submitted
      ? 'complete'
      : generation?.status === 'failed'
        ? 'failed'
        : generation?.status === 'queued' ||
            generation?.status === 'running' ||
            review?.public.status === 'awaiting_transcript'
          ? 'running'
          : cycle?.briefApprovedAt
            ? 'ready'
            : 'blocked',
    reviewed
      ? 'complete'
      : review?.public.status === 'failed'
        ? 'failed'
        : review?.report
          ? 'needs_review'
          : review?.public.status === 'pending'
            ? 'running'
            : 'blocked',
    cycle?.closedAt && cycle.outcome !== 'superseded'
      ? 'complete'
      : reviewed
        ? 'needs_review'
        : 'blocked',
  ];
  const info = [
    [
      'story',
      'Review financial story',
      'Approve the exact saved revision; edits and source changes require review.',
      'Investor recommendation review',
    ],
    [
      'investor',
      'Review recommendations & select investor',
      'Compare sourced observations, financing context and unknowns. Selection prepares the brief.',
      'Tailored meeting brief',
    ],
    [
      'brief',
      'Approve tailored brief',
      'Review the approved story with the selected investor’s own saved sources.',
      'Scenario source review',
    ],
    [
      'practice',
      'Prepare scenario & practise',
      'Review sources, generate a scenario, then submit a written answer or finish a provider-receipted conversation.',
      'Saved practice assessment',
    ],
    [
      'feedback',
      'Review saved feedback',
      'A completed report is required. Failed and pending reviews cannot pass this gate.',
      'Evidence-linked revision proposal',
    ],
    [
      'revision',
      'Decide revision & complete cycle',
      'Approve or reject the proposed revision, or finish when no actionable gap remains. A revision is not proof of improvement.',
      'Next preparation cycle or watch for new inputs',
    ],
  ] as const;
  return info.map(([id, title, detail, workflow], i) => ({
    id,
    title,
    detail,
    workflow,
    status: outdated && !cycle.closedAt ? 'outdated' : (statuses[i] ?? 'blocked'),
  }));
}

/** Recheck inside the write transaction after loading a scenario, for every transport. */
export function assertCurrentPreparedPractice(state: Workspace, context: PracticeContext | null) {
  if (context?.version !== 2 || !context.input.preparation) return;
  const current = preparedPitchContext(state, context.input.preparation.cycleId);
  if (connectedHash(current) !== connectedHash(context.input.preparation))
    throw new ConflictError('Prepared sources changed before practice.');
  if (
    linkedPractices(state, current.cycleId).some(
      (r) =>
        r.status === 'active' ||
        r.status === 'awaiting_transcript' ||
        (r.status === 'completed' && r.turns.some((t) => t.role === 'user' && t.text.trim())),
    )
  )
    throw new ConflictError(
      'Review the current practice or start the next preparation cycle before another session.',
    );
}
