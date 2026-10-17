import { buildPeerComparison } from './PeerComparison.js';
import { Decimal } from 'decimal.js';
import {
  evaluationContextSchema,
  type EvaluationContext,
} from '../contracts/RehearsalEvaluation.js';
import type { Brief, Workspace } from '../contracts/Workspace.js';
import type { PracticeContext } from '../contracts/PracticeContext.js';

/** Versioned, bounded local snapshot. It is never implicitly sent to the interviewer. */
export function assembleEvaluationContext(
  state: Workspace,
  practice: PracticeContext | null,
  brief: Brief | null = null,
): EvaluationContext {
  const scenarioInput = practice?.version === 2 ? practice.input : null;
  const founder = scenarioInput?.sources.find((s) => s.kind === 'founder_initial');
  const scenarioFinancials = scenarioInput?.sources.find((s) => s.kind === 'financials');
  const scenarioSnapshot = scenarioFinancials?.snapshots.find((s) => s.role === 'current');
  const selectedSnapshotId =
    brief?.snapshotId ?? practice?.financials?.snapshotId ?? state.onboarding.snapshotId;
  // A saved scenario must not silently acquire newer company data or another investor's notes.
  const snapshot = scenarioInput
    ? scenarioSnapshot && {
        id: scenarioSnapshot.snapshotId,
        fileName: scenarioSnapshot.fileName,
        currency: scenarioSnapshot.currency ?? 'unspecified',
        createdAt: scenarioSnapshot.createdAt,
        rows: scenarioSnapshot.periods,
      }
    : state.snapshots.find((s) => s.id === selectedSnapshotId);
  const meeting = scenarioInput ? null : brief ? brief.meeting : state.onboarding.meeting;
  const investor = state.investors.find((i) => i.id === meeting?.investorId);
  const context: EvaluationContext = {
    version: 1,
    capturedAt: new Date().toISOString(),
    workspaceRevision: state.revision,
    companyName: scenarioInput ? (founder?.company.name ?? 'Unknown company') : state.profile.name,
    profileVersion: scenarioInput ? (founder?.profileVersion ?? 1) : state.profile.version,
    snapshotId: snapshot?.id ?? null,
    investorId: scenarioInput?.investor.id ?? investor?.id ?? null,
    investorName: scenarioInput?.investor.name ?? investor?.name ?? meeting?.name ?? null,
    scenario:
      practice?.scenario?.objective ??
      brief?.finding.question ??
      (state.profile.goal || 'Explain the company and support claims with evidence.'),
    interviewerContextMode: practice?.mode ?? 'legacy',
    sources: [
      {
        id: 'company',
        kind: 'company',
        title: scenarioInput ? 'Company profile saved with scenario' : 'Saved company profile',
        text: JSON.stringify(scenarioInput ? (founder?.company ?? null) : state.profile),
        url: null,
        recordedAt: null,
        origin: 'founder',
      },
    ],
    facts: [],
    limitations: [],
  };
  if (scenarioInput) {
    context.limitations.push(
      'Scenario evidence is frozen at generation time. Only its selected current financial snapshot is checked; previous snapshots and prior practice are not treated as current facts.',
    );
    if (!founder) context.limitations.push('The scenario has no saved company profile.');
    if (founder?.meetingNotes)
      context.sources.push({
        id: 'meeting',
        kind: 'meeting',
        title: 'Meeting notes saved with scenario',
        text: founder.meetingNotes,
        url: null,
        recordedAt: founder.capturedAt,
        origin: 'founder',
      });
    for (const source of scenarioInput.sources)
      if (source.kind === 'investor_research')
        context.sources.push({
          id: `investor:${source.evidenceId}`,
          kind: 'investor',
          title: source.title || 'Saved investor research',
          text: source.excerpt,
          url: source.url,
          recordedAt: source.retrievedAt,
          origin: source.provenance === 'fictional_demo' ? 'fictional' : 'public_unverified',
        });
    if (scenarioInput.omittedEvidenceIds.length)
      context.limitations.push('Some investor sources were omitted from the saved scenario.');
  }
  if (brief && brief.profileVersion !== state.profile.version)
    context.limitations.push(
      'The company profile has changed since the selected brief; current profile context is labeled separately from the pinned financial evidence.',
    );
  if (meeting)
    context.sources.push({
      id: 'meeting',
      kind: 'meeting',
      title: 'Meeting notes',
      text: meeting.notes,
      url: null,
      recordedAt: null,
      origin: 'founder',
    });
  if (snapshot) {
    // Use a bounded recent year. Explicitly disclose omitted history; never truncate silently.
    const rows = snapshot.rows.slice(-12);
    if (rows.length < (scenarioSnapshot?.totalRows ?? snapshot.rows.length))
      context.limitations.push(
        'Only the latest twelve reporting periods are included; older periods cannot be checked.',
      );
    for (const row of rows) {
      const sourceId = `financial:${snapshot.id}:${row.sourceRow}`;
      context.sources.push({
        id: sourceId,
        kind: 'financial',
        title: `${snapshot.fileName}, row ${row.sourceRow}, ${row.month}`,
        text: JSON.stringify(row),
        url: null,
        recordedAt: snapshot.createdAt,
        origin: (
          scenarioSnapshot ? scenarioSnapshot.fictional : snapshot.fileName === 'Tidewell.csv'
        )
          ? 'fictional'
          : 'uploaded',
        financialLocation: {
          kind: 'csv',
          snapshotId: snapshot.id,
          fileName: snapshot.fileName,
          sourceRow: row.sourceRow,
        },
      });
      const fields = {
        revenue: row.revenue,
        cogs: row.cogs,
        gross_profit: row.grossProfit,
        operating_expenses: row.expenses,
        operating_income: row.operatingIncome,
        other_income_credit: row.credit,
        net_income: row.netIncome,
      };
      for (const [metric, value] of Object.entries(fields))
        context.facts.push({
          id: `${row.month}:${metric}`,
          metric,
          value,
          unit: snapshot.currency,
          period: row.month,
          sourceIds: [sourceId],
          calculation: 'Imported reconciled income statement',
        });
      if (!new Decimal(row.revenue).isZero()) {
        for (const [metric, numerator] of [
          ['gross_margin', row.grossProfit],
          ['operating_margin', row.operatingIncome],
        ]) {
          if (!metric || numerator === undefined) continue;
          context.facts.push({
            id: `${row.month}:${metric}`,
            metric,
            value: new Decimal(numerator).div(row.revenue).times(100).toFixed(8),
            unit: 'percent',
            period: row.month,
            sourceIds: [sourceId],
            calculation: `${metric === 'gross_margin' ? 'gross_profit' : 'operating_income'} / revenue * 100; rounded to eight decimal places`,
          });
        }
      }
    }
  } else context.limitations.push('No financial snapshot was selected when this session started.');
  const evidenceIds = new Set(
    scenarioInput
      ? []
      : brief
        ? brief.evidenceId
          ? [brief.evidenceId]
          : []
        : investor
          ? [
              ...investor.checks.flatMap((c) => c.evidenceIds),
              ...(investor.discoveryEvidenceId ? [investor.discoveryEvidenceId] : []),
            ]
          : [],
  );
  for (const evidence of state.evidence.filter((e) => evidenceIds.has(e.id)).slice(-10))
    context.sources.push({
      id: `investor:${evidence.id}`,
      kind: 'investor',
      title: evidence.title,
      text: evidence.excerpt,
      url: evidence.url,
      recordedAt: evidence.discoveredAt,
      origin: evidence.mode === 'demo' ? 'fictional' : 'public_unverified',
    });
  if (!context.sources.some((s) => s.kind === 'investor'))
    context.limitations.push('No sourced investor priorities are available.');
  context.limitations.push(
    'The income statement does not establish cash balance, cash runway, ad attribution, customer acquisition counts or retention.',
  );
  if (scenarioInput?.peerComparison) {
    context.peerComparison = scenarioInput.peerComparison;
  } else if (!scenarioInput) {
    const selected = state.snapshots.find((item) => item.id === selectedSnapshotId);
    context.peerComparison = buildPeerComparison(
      selected,
      state.peers ?? [],
      state.profile.version,
      context.capturedAt,
    );
  }
  const company = scenarioInput ? founder?.company : state.profile;
  const observations = scenarioInput
    ? scenarioInput.sources
        .filter((source) => source.kind === 'investor_research')
        .map((source) => ({
          sourceId: `investor:${source.evidenceId}`,
          stage: source.stage,
          sector: source.sector,
          geography: source.geography,
        }))
    : state.evidence
        .filter((source) => evidenceIds.has(source.id))
        .slice(-10)
        .map((source) => ({
          sourceId: `investor:${source.id}`,
          stage: source.stage,
          sector: source.sector,
          geography: source.geography,
        }));
  context.investorAssessment = {
    company: {
      stage: company?.stage ?? null,
      sector: company?.sector ?? null,
      geography: company?.geography ?? null,
    },
    observations: observations.filter((observation) =>
      context.sources.some((source) => source.id === observation.sourceId),
    ),
  };
  return evaluationContextSchema.parse(context);
}
