import {
  preparationAreaSchema,
  type PreparationArea,
  type PreparationProgress,
} from '../contracts/PreparationProgress.js';
import type { Job, Workspace } from '../contracts/Workspace.js';
import { assembleEvaluationContext } from './EvaluationContextAssembler.js';
import { projectFollowups } from './Followups.js';

const definitions: Record<
  PreparationArea,
  {
    title: string;
    description: string;
    drill: string;
    metrics: string[];
    missingEvidence: string[];
  }
> = {
  revenue: {
    title: 'Revenue & growth',
    description: 'Explain where revenue comes from and support growth claims.',
    drill:
      'Explain the latest revenue figure. Separate subscription revenue from services, then identify the evidence needed to explain changes over time.',
    metrics: ['revenue', 'subscription_revenue', 'revenue_growth', 'revenue_growth_pct'],
    missingEvidence: ['Customer, pricing and retention data to explain revenue drivers'],
  },
  margins: {
    title: 'Margins & delivery costs',
    description: 'Connect gross profit to revenue and the costs of delivering it.',
    drill:
      'Explain gross profit and gross margin using the same reporting period. Identify which delivery costs changed and what supports your explanation.',
    metrics: ['gross_profit', 'gross_margin', 'cogs'],
    missingEvidence: ['Delivery-cost drivers and volume or pricing evidence'],
  },
  expenses: {
    title: 'Operating expenses',
    description: 'Reconcile spending and distinguish cost behaviour from reducibility.',
    drill:
      'Reconcile operating expenses to the underlying categories. Explain which costs could change, with notice periods, commitments and timing.',
    metrics: ['operating_expenses', 'expenses', 'expense_growth'],
    missingEvidence: [
      'Expense ledger by category',
      'Contracts, notice periods and employment commitments',
    ],
  },
  profitability: {
    title: 'Operating performance',
    description: 'Distinguish the operating result from net income and credits.',
    drill:
      'Walk from gross profit through operating expenses to operating income, then reconcile net income separately. Identify any credit and what remains unknown about recurrence and cash timing.',
    metrics: ['operating_income', 'operating_margin', 'net_income', 'other_income_credit'],
    missingEvidence: ['Credit recurrence and cash-receipt evidence'],
  },
  cash: {
    title: 'Cash & forward planning',
    description: 'Support runway and breakeven statements with cash and forecast evidence.',
    drill:
      'List the cash balance, cash-flow assumptions and monthly forecast needed to support a runway or breakeven claim. State what remains unknown.',
    metrics: ['cash_runway', 'runway', 'cash_balance', 'cash_burn', 'burn_rate', 'breakeven'],
    missingEvidence: [
      'Cash balance and cash-flow plan',
      'Monthly forecast with explicit assumptions; forecasts are not connected',
    ],
  },
  explanation: {
    title: 'Evidence & explanation',
    description: 'Make claims traceable and acknowledge gaps in the available evidence.',
    drill:
      'Choose one claim from your feedback. Identify its source, reporting period and limitations, and explain what the evidence does and does not establish.',
    metrics: [],
    missingEvidence: ['The specific supporting documents requested in your feedback'],
  },
};
const areaIds = preparationAreaSchema.options;
function areaFor(metric: string | null | undefined): PreparationArea {
  return areaIds.find((id) => metric && definitions[id].metrics.includes(metric)) ?? 'explanation';
}
const emptyCounts = (): PreparationProgress['counts'] => ({
  assessed: 0,
  supported: 0,
  contradicted: 0,
  unresolved: 0,
  followups: 0,
  practised: 0,
  improved: 0,
  attention: 0,
});

/** Saved evidence and outcomes only. No model calls, mastery scores, or history mutations. */
export function projectPreparationProgress(state: Workspace, jobs: Job[]): PreparationProgress {
  const sessions = projectFollowups(state, jobs, 0, state.rehearsals.length).sessions;
  const current = assembleEvaluationContext(state, null);
  const snapshot = state.snapshots.find((item) => item.id === state.onboarding.snapshotId);
  const latestRow = snapshot?.rows.at(-1);
  const areas: PreparationProgress['areas'] = areaIds.map((id) => ({
    id,
    title: definitions[id].title,
    description: definitions[id].description,
    drill: definitions[id].drill,
    missingEvidence: definitions[id].missingEvidence,
    counts: emptyCounts(),
    facts: current.facts.filter(
      (fact) => fact.period === latestRow?.month && areaFor(fact.metric) === id,
    ),
    actions: [],
    strengths: [],
  }));
  const counts = emptyCounts();
  const recentSessions: PreparationProgress['recentSessions'] = [];
  let reviewedSessions = 0;
  let pendingSessions = 0;
  let unavailableSessions = 0;
  for (const [index, session] of sessions.entries()) {
    const saved = state.rehearsals.find((item) => item.id === session.id);
    const evaluation = saved?.evaluations.find((item) => item.id === session.evaluationId);
    const report = session.reviewStatus === 'ready' ? evaluation?.report : null;
    const sessionCounts = emptyCounts();
    const add = (area: PreparationProgress['areas'][number], field: keyof typeof counts) => {
      area.counts[field]++;
      counts[field]++;
      sessionCounts[field]++;
    };
    const partial =
      session.partial || (evaluation !== undefined && evaluation.scope !== 'complete');
    if (report) {
      reviewedSessions++;
      for (const check of report.checks) {
        const claim = report.extraction.claims.find((item) => item.id === check.claimId);
        if (!claim || claim.supersededByTurnId) continue;
        const area = areas.find((item) => item.id === areaFor(claim.metric));
        if (!area) continue;
        add(area, 'assessed');
        add(
          area,
          check.support === 'supported'
            ? 'supported'
            : check.support === 'contradicted'
              ? 'contradicted'
              : 'unresolved',
        );
      }
      for (const task of session.tasks) {
        const coaching = report.coaching.items.find((item) => item.id === task.id);
        const claim = report.extraction.claims.find((item) => item.id === coaching?.claimId);
        const area = areas.find((item) => item.id === areaFor(claim?.metric));
        if (!area) continue;
        add(area, 'followups');
        if (task.retrySessionId) add(area, 'practised');
        if (task.status === 'improved') add(area, 'improved');
        if (!['improved', 'dismissed', 'pending'].includes(task.status)) add(area, 'attention');
        if (task.status !== 'dismissed')
          area.actions.push({
            sessionId: session.id,
            investorId: session.investorId,
            snapshotId: saved?.evaluationContext?.snapshotId ?? null,
            createdAt: session.createdAt,
            fictional: session.fictional,
            partial,
            offset: Math.floor(index / 10) * 10,
            task,
            interpretation: coaching?.analysis?.financialInterpretation ?? null,
            implication: coaching?.analysis?.investorImplication ?? null,
          });
      }
      for (const strength of report.coaching.strengths ?? []) {
        const claim = report.extraction.claims.find(
          (item) => strength.claimIds.includes(item.id) && !item.supersededByTurnId,
        );
        const area = areas.find((item) => item.id === areaFor(claim?.metric));
        if (claim && area && area.strengths.length < 3)
          area.strengths.push({
            statement: strength.statement,
            quote: claim.quote,
            createdAt: session.createdAt,
            fictional: session.fictional,
            partial,
          });
      }
    } else if (['queued', 'awaiting_transcript'].includes(session.reviewStatus)) pendingSessions++;
    else unavailableSessions++;
    if (recentSessions.length < 5)
      recentSessions.push({
        id: session.id,
        scenario: session.scenario,
        createdAt: session.createdAt,
        fictional: session.fictional,
        partial,
        reviewStatus: session.reviewStatus,
        counts: sessionCounts,
        offset: Math.floor(index / 10) * 10,
      });
  }
  for (const area of areas) {
    const priority = (status: string) => (status === 'improved' ? 2 : status === 'pending' ? 1 : 0);
    area.actions.sort((a, b) => priority(a.task.status) - priority(b.task.status));
    area.actions = area.actions.slice(0, 3);
  }
  return {
    reviewedSessions,
    pendingSessions,
    unavailableSessions,
    counts,
    areas,
    recentSessions,
    currentEvidence: {
      snapshotId: snapshot?.id ?? null,
      fileName: snapshot?.fileName ?? null,
      fictional: snapshot?.fileName === 'Tidewell.csv',
      period: latestRow?.month ?? null,
      sourceRow: latestRow?.sourceRow ?? null,
    },
  };
}
