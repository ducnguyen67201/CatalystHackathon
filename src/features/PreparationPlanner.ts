import { preparationChangeLabels, projectPreparationPosition } from './PreparationPosition.js';
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { Workspace, Job } from '../contracts/Workspace.js';
import {
  preparationStateSchema,
  type PreparationGoal,
  type PreparationPlan,
  type PreparationArtifact,
  type PreparationView,
} from '../contracts/FundraisingPreparation.js';
import { projectFollowups } from './Followups.js';
import { connectedSteps, cycleOutdated, activePreparationCycle } from './ConnectedPreparation.js';

export const preparationHash = (input: unknown): string =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
export function preparationState(state: Workspace) {
  return state.preparation ?? preparationStateSchema.parse({});
}
function contextualGoal(state: Workspace, goal: PreparationGoal): PreparationGoal {
  const journey = state.preparation?.journey;
  if (!journey) return goal;
  const focused = journey.targets.find(
    (target) => target.id === journey.focusedTargetId && target.status === 'active',
  );
  return {
    ...goal,
    investorId: focused?.investorId ?? state.onboarding.meeting?.investorId ?? goal.investorId,
  };
}
function selectedEvidence(state: Workspace, goal: PreparationGoal) {
  const investor = state.investors.find((item) => item.id === goal.investorId);
  const ids = new Set([
    ...(investor?.checks
      .filter((check) => check.profileVersion === state.profile.version)
      .flatMap((check) => check.evidenceIds) ?? []),
    ...(investor?.discoveryEvidenceId ? [investor.discoveryEvidenceId] : []),
  ]);
  return state.evidence.filter((item) => ids.has(item.id)).slice(-10);
}
export function preparationInputs(state: Workspace, goal: PreparationGoal) {
  goal = contextualGoal(state, goal);
  const snapshot = state.snapshots.find((item) => item.id === state.onboarding.snapshotId);
  return {
    plannerVersion: 3,
    goal,
    profile: state.profile,
    snapshot: snapshot ? { id: snapshot.id, hash: snapshot.hash } : null,
    investor: (() => {
      const investor = state.investors.find((item) => item.id === goal.investorId);
      return investor ? { id: investor.id, name: investor.name, url: investor.url } : null;
    })(),
    evidence: selectedEvidence(state, goal),
    // Only completed, relevant reviews change the preparation plan. Captions are not inputs.
    reviews: state.rehearsals
      .filter(
        (session) =>
          session.evaluationContext?.snapshotId === snapshot?.id &&
          (!goal.investorId || session.evaluationContext?.investorId === goal.investorId),
      )
      .flatMap((session) =>
        session.evaluations
          .filter((review) => review.status === 'completed')
          .map((review) => ({ sessionId: session.id, reviewId: review.id, report: review.report })),
      ),
  };
}
export function preparationManifest(inputs: ReturnType<typeof preparationInputs>) {
  return {
    goal: preparationHash({ goal: inputs.goal, profile: inputs.profile }),
    financial: preparationHash(inputs.snapshot),
    investor: preparationHash({ investor: inputs.investor, evidence: inputs.evidence }),
    practice: preparationHash(inputs.reviews),
  };
}
export function buildPreparationPlan(
  state: Workspace,
  goal: PreparationGoal,
  now: string,
): PreparationPlan {
  goal = contextualGoal(state, goal);
  const inputs = preparationInputs(state, goal);
  const snapshot = state.snapshots.find((item) => item.id === state.onboarding.snapshotId);
  const row =
    snapshot?.rows
      .slice(-12)
      .filter(
        (item) =>
          new Decimal(item.credit).gt(0) &&
          new Decimal(item.operatingIncome).lt(0) &&
          new Decimal(item.netIncome).gt(0),
      )
      .at(-1) ?? snapshot?.rows.at(-1);
  const artifacts: PreparationArtifact[] = [];
  if (snapshot && row) {
    const unit = snapshot.currency === 'unspecified' ? 'currency not confirmed' : snapshot.currency;
    const narrative = `In ${row.month}, operating income was ${row.operatingIncome}, the reported credit was ${row.credit}, and net income was ${row.netIncome} (${unit}). ${new Decimal(row.operatingIncome).lt(0) && new Decimal(row.netIncome).gt(0) ? 'Positive net income does not establish operating profitability. ' : ''}The statement does not establish credit recurrence, cash receipt timing or cash runway.`;
    artifacts.push({
      id: preparationHash(['financial-v1', snapshot.id, row]),
      kind: 'financial',
      title: 'Review your operating-performance explanation',
      narrative,
      why: 'Separate operating performance from credits and support the explanation with the exact statement row.',
      question: `Explain operating income, the credit and net income in ${row.month}. What does this establish about operations, and what remains unknown about cash runway?`,
      criteria: [
        'Use the correct period and sourced figures.',
        'Distinguish operating income from net income and the credit.',
        'Acknowledge that cash runway needs additional evidence.',
      ],
      snapshotId: snapshot.id,
      investorId: null,
      fictional: snapshot.fileName === 'Tidewell.csv',
      sources: [
        {
          id: `financial:${snapshot.id}:${row.sourceRow}`,
          title: `${snapshot.fileName}, row ${row.sourceRow}, ${row.month}`,
          excerpt: JSON.stringify(row.raw),
          url: null,
          recordedAt: snapshot.createdAt,
          fictional: snapshot.fileName === 'Tidewell.csv',
        },
      ],
      chart: {
        period: row.month,
        fileName: snapshot.fileName,
        sourceRow: row.sourceRow,
        currency: unit,
        operatingIncome: row.operatingIncome,
        credit: row.credit,
        netIncome: row.netIncome,
      },
    });
  }
  const investor = inputs.investor;
  if (investor) {
    const evidence = inputs.evidence;
    const sources = evidence.map((item) => ({
      id: item.id,
      title: item.title,
      excerpt: item.excerpt,
      url: item.url,
      recordedAt: item.discoveredAt,
      publishedAt: item.publishedAt,
      ...(item.researchRunId ? { researchRunId: item.researchRunId } : {}),
      investorName: item.investor,
      interpretation: item.explanation.slice(0, 3000),
      fictional: item.mode === 'demo',
    }));
    const companyStage = state.profile.stage;
    const criteria = ['stage', 'sector', 'geography'] as const;
    const fit = criteria.map((key) => {
      const target = state.profile[key];
      const observed = [
        ...new Set(
          evidence
            .map((item) => item[key])
            .filter((value) => value !== null && value !== 'Not confirmed' && value !== ''),
        ),
      ];
      if (!target || target === 'Not confirmed' || !observed.length) return `${key}: unknown`;
      if (observed.length > 1) return `${key}: conflicting source observations`;
      return `${key}: ${observed[0]?.toLowerCase() === target.toLowerCase() ? 'aligned observation' : 'possible mismatch'}; verify current mandate`;
    });
    const narrative = `Prepare for ${investor.name}: your intended round is ${goal.round}; company stage is ${companyStage}. ${fit.join('. ')}. These are historical public-source observations, not confirmed eligibility. Individual check size and application route require confirmation. Start with the reviewed operating-performance explanation, then ask about current stage, participation and evidence requirements.`;
    artifacts.push({
      id: preparationHash(['investor-v1', goal, state.profile, sources, artifacts[0]?.id]),
      kind: 'investor',
      title: `Review your brief for ${investor.name}`,
      narrative,
      why: 'Use company context and this investor’s saved sources to prepare a specific conversation without assuming private preferences.',
      question: `Explain why you are approaching ${investor.name} for ${goal.round}, support your financial story, and ask one question about unconfirmed fit.`,
      criteria: [
        'Explain the intended round.',
        'Support the financial story.',
        'Distinguish sourced observations from unknown investor criteria.',
      ],
      snapshotId: snapshot?.id ?? null,
      investorId: investor.id,
      fictional:
        sources.some((source) => source.fictional) || snapshot?.fileName === 'Tidewell.csv',
      sources,
      chart: null,
    });
  }
  const inputHash = preparationHash(inputs);
  const manifest = preparationManifest(inputs);
  const changes = preparationChangeLabels(state.preparation?.plans.at(-1)?.manifest, manifest);
  return {
    manifest,
    id: inputHash,
    goalId: goal.id,
    inputHash,
    createdAt: now,
    summary: snapshot
      ? `Selected evidence: ${snapshot.fileName}, latest period ${snapshot.rows.at(-1)?.month ?? 'unknown'}. ${goal.previousRounds === null ? 'Previous financing is not confirmed.' : `${goal.previousRounds} prior rounds confirmed by the founder.`}`
      : 'Select a saved financial statement to prepare an evidence-backed explanation.',
    changes: changes.length
      ? changes
      : ['Saved evidence content is unchanged; preparation rules were updated.'],
    artifacts,
  };
}
export function projectPreparationPlan(
  state: Workspace,
  jobs: Job[],
  heartbeatAt: string | null,
): PreparationView {
  const saved = preparationState(state);
  const savedGoal = saved.goals.at(-1);
  const goal = savedGoal ? contextualGoal(state, savedGoal) : null;
  const plan = saved.plans.at(-1) ?? null;
  const outdated =
    !!goal && (!plan || plan.inputHash !== preparationHash(preparationInputs(state, goal)));
  const accepted = (kind: PreparationArtifact['kind']) => {
    const artifact = plan?.artifacts.find((item) => item.kind === kind);
    return (
      !!artifact &&
      saved.decisions.findLast((item) => item.artifactId === artifact.id)?.kind === 'accepted'
    );
  };
  const allReviews: PreparationView['reviews'] = saved.rehearsals
    .slice()
    .reverse()
    .map((link) => {
      const session = state.rehearsals.find((item) => item.id === link.sessionId);
      const review = session?.evaluations.at(-1);
      const job =
        review && jobs.find((item) => item.kind === `evaluate:${session?.id}:${review.id}`);
      const report = review?.status === 'completed' ? review.report : null;
      const financial = plan?.artifacts.find((item) => item.id === link.artifactId);
      const period = financial?.chart?.period;
      const required = ['operating_income', 'other_income_credit', 'net_income'];
      const covered = required.every((metric) =>
        report?.extraction.claims.some(
          (claim) =>
            claim.metric === metric &&
            claim.period === period &&
            !claim.supersededByTurnId &&
            report.checks.some(
              (check) => check.claimId === claim.id && check.support === 'supported',
            ),
        ),
      );
      const gaps =
        (report?.coaching.items.length ?? 0) > 0 ||
        report?.checks.some((check) => check.support !== 'supported');
      return {
        sessionId: link.sessionId,
        artifactId: link.artifactId,
        current:
          !!financial &&
          !!plan &&
          saved.plans.find((item) => item.id === link.planId)?.goalId === plan.goalId,
        status: report
          ? covered && !gaps
            ? 'assessed'
            : 'needs_attention'
          : job?.status === 'failed'
            ? 'failed'
            : review?.status === 'queued'
              ? 'pending'
              : 'unavailable',
        summary: report?.coaching.summary ?? review?.reason ?? null,
      };
    });
  // An assessment is not mastery or a before/after improvement claim.
  const assessed =
    accepted('financial') && allReviews.find((review) => review.current)?.status === 'assessed';
  const reviews = allReviews.slice(0, 5);
  const financial = plan?.artifacts.some((item) => item.kind === 'financial');
  const milestones: PreparationView['milestones'] = [
    {
      id: 'strategy',
      title: 'Confirm strategy',
      status: goal ? 'complete' : 'available',
      detail: goal
        ? `Intended round: ${goal.round}. Prior rounds: ${goal.previousRounds ?? 'not confirmed'}.`
        : 'Confirm the target round and context before preparing a plan.',
    },
    {
      id: 'financial',
      title: 'Review financial story',
      status: accepted('financial') ? 'complete' : financial ? 'needs_review' : 'blocked',
      detail: financial
        ? 'Review the sourced explanation and comparison chart.'
        : 'Select financial evidence in setup.',
    },
    {
      id: 'investor',
      title: 'Select investor',
      status: goal?.investorId ? 'complete' : goal ? 'available' : 'blocked',
      detail: goal?.investorId
        ? 'An investor is selected; current mandate and check size may still be unknown.'
        : 'Choose a saved investor when ready; general financial rehearsal can proceed without one.',
    },
    {
      id: 'brief',
      title: 'Approve investor brief',
      status:
        accepted('investor') && accepted('financial')
          ? 'complete'
          : goal?.investorId && financial
            ? 'needs_review'
            : 'blocked',
      detail: 'Review company evidence and investor context; sources do not establish eligibility.',
    },
    {
      id: 'rehearse',
      title: 'Rehearse and review',
      status: assessed ? 'complete' : accepted('financial') ? 'available' : 'blocked',
      detail: assessed
        ? 'Saved assessment covers the three financial figures with no remaining coaching gaps. Cash understanding still requires founder review.'
        : 'Review the explanation, then submit a written rehearsal for assessment.',
    },
  ];
  const cycle = activePreparationCycle(state);
  if (cycle) {
    const steps = connectedSteps(state, jobs, null);
    const status = (items: typeof steps): PreparationView['milestones'][number]['status'] =>
      items.every((step) => step.status === 'complete')
        ? 'complete'
        : items.some((step) => step.status === 'needs_review' || step.status === 'outdated')
          ? 'needs_review'
          : items.some((step) => ['ready', 'running', 'failed'].includes(step.status))
            ? 'available'
            : 'blocked';
    for (const milestone of milestones) {
      const group =
        milestone.id === 'financial'
          ? steps.slice(0, 1)
          : milestone.id === 'investor'
            ? steps.slice(1, 2)
            : milestone.id === 'brief'
              ? steps.slice(2, 3)
              : milestone.id === 'rehearse'
                ? steps.slice(3)
                : [];
      if (!group.length) continue;
      const next = group.find((step) => step.status !== 'complete') ?? group.at(-1);
      milestone.status = status(group);
      milestone.preparationStep = next?.id;
      if (milestone.id === 'rehearse' && next) milestone.title = next.title;
      milestone.detail = `Current preparation cycle · ${group.map((step) => `${step.title}: ${step.status}`).join('; ')}.`;
    }
  }
  const sessions = projectFollowups(state, jobs, 0, state.rehearsals.length).sessions;
  const feedback = sessions
    .filter((session) => {
      const context = state.rehearsals.find((item) => item.id === session.id)?.evaluationContext;
      return (
        context?.snapshotId === state.onboarding.snapshotId &&
        (!goal?.investorId || session.investorId === goal.investorId)
      );
    })
    .flatMap((session) =>
      session.tasks
        .filter((task) => !['improved', 'dismissed'].includes(task.status))
        .map((task) => ({
          title: task.title,
          status: task.status,
          sessionId: session.id,
          taskId: task.id,
          offset: Math.floor(sessions.findIndex((item) => item.id === session.id) / 10) * 10,
        })),
    )
    .slice(0, 3);
  return {
    position: projectPreparationPosition(
      state,
      jobs,
      goal,
      plan,
      goal ? preparationManifest(preparationInputs(state, goal)) : null,
      outdated,
    ),
    intent: state.profile.goal,
    profileVersion: state.profile.version,
    connectedActive: !!saved.connected?.cycles.length,
    version: saved.version,
    automatic: saved.automatic,
    goal,
    schedule: saved.schedules.at(-1) ?? null,
    ...(saved.journey ? { journeyPace: saved.journey.pace ?? 1 } : {}),
    plan,
    outdated: cycle ? cycleOutdated(state, cycle) : outdated,
    heartbeatAt,
    decisions: plan
      ? saved.decisions.filter((item) =>
          plan.artifacts.some((artifact) => artifact.id === item.artifactId),
        )
      : [],
    milestones,
    reviews,
    feedback,
    nextAction: !goal
      ? 'Confirm your fundraising preparation goal.'
      : outdated
        ? 'Review changes and refresh the plan.'
        : !financial
          ? 'Select your financial statement in setup.'
          : !accepted('financial')
            ? 'Review the prepared operating-performance explanation.'
            : !goal.investorId
              ? 'Practise the financial explanation, or select an investor to tailor preparation.'
              : !accepted('investor')
                ? 'Review the prepared investor brief.'
                : !assessed
                  ? 'Rehearse and review the saved assessment.'
                  : feedback.length
                    ? 'Resolve the remaining saved preparation feedback.'
                    : 'Preparation reviewed. Confirm outstanding investor criteria before approaching them.',
  };
}
