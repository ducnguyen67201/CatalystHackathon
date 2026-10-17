import { randomUUID } from 'node:crypto';
import {
  evaluationContextSchema,
  evaluationRecordSchema,
  type EvaluationContext,
  type EvaluationRecord,
} from '../src/contracts/RehearsalEvaluation.js';
import { hashEvaluationInput } from '../src/features/RehearsalEvaluationService.js';

/** Fictional financial and transcript fixtures; never imported by runtime application code. */
export function evidenceFixture(): { context: EvaluationContext; evaluation: EvaluationRecord } {
  const context = evaluationContextSchema.parse({
    version: 1,
    capturedAt: '2026-10-17T12:00:00.000Z',
    workspaceRevision: 1,
    companyName: 'Fictional Tidewell',
    profileVersion: 1,
    snapshotId: 'fictional-snapshot',
    investorId: null,
    scenario: 'Explain profitability using fictional evidence.',
    interviewerContextMode: 'provided',
    sources: [],
    facts: [],
    limitations: ['All evidence in this test fixture is fictional.'],
  });
  for (const [month, revenue, operating, credit] of [
    ['2026-08', '80000', '-22000', '0'],
    ['2026-09', '92000', '-18000', '30000'],
  ] as const) {
    const sourceRow = month === '2026-08' ? 3 : 4;
    const sourceId = `financial:${context.snapshotId}:${sourceRow}`;
    const row = {
      month,
      revenue,
      subscriptionRevenue: revenue,
      cogs: '28000',
      grossProfit: month === '2026-08' ? '52000' : '64000',
      expenses: month === '2026-08' ? '74000' : '82000',
      operatingIncome: operating,
      credit,
      netIncome: month === '2026-08' ? '-22000' : '12000',
      sourceRow,
    };
    context.sources.push({
      id: sourceId,
      kind: 'financial',
      title: `Fictional.csv, row ${sourceRow}, ${month}`,
      text: JSON.stringify(row),
      url: null,
      recordedAt: context.capturedAt,
      origin: 'fictional',
      financialLocation: {
        kind: 'csv',
        fileName: 'Fictional.csv',
        snapshotId: 'fictional-snapshot',
        sourceRow,
      },
    });
    for (const [metric, value] of Object.entries({
      revenue: row.revenue,
      cogs: row.cogs,
      gross_profit: row.grossProfit,
      operating_expenses: row.expenses,
      operating_income: row.operatingIncome,
      other_income_credit: row.credit,
      net_income: row.netIncome,
    }))
      context.facts.push({
        id: `${month}:${metric}`,
        metric,
        value,
        unit: 'CAD',
        period: month,
        sourceIds: [sourceId],
        calculation: 'Fictional reconciled statement',
      });
  }
  const turns = [
    { id: 'question', role: 'agent', text: 'Are operations profitable?' },
    {
      id: 'answer',
      role: 'user',
      text: 'September revenue was CAD 92000. We made CAD 12000 in operating profit.',
    },
    { id: 'runway', role: 'user', text: 'We have eighteen months of runway.' },
  ];
  const extraction = {
    claims: [
      {
        id: 'profit',
        turnId: 'answer',
        questionTurnId: 'question',
        quote: 'We made CAD 12000 in operating profit.',
        metric: 'operating_income',
        value: '12000',
        period: '2026-09',
        unit: 'CAD',
        kind: 'actual',
        supersededByTurnId: null,
        uncertainty: '',
      },
      {
        id: 'revenue',
        turnId: 'answer',
        questionTurnId: 'question',
        quote: 'September revenue was CAD 92000.',
        metric: 'revenue',
        value: '92000',
        period: '2026-09',
        unit: 'CAD',
        kind: 'actual',
        supersededByTurnId: null,
        uncertainty: '',
      },
      {
        id: 'runway',
        turnId: 'runway',
        questionTurnId: 'question',
        quote: 'We have eighteen months of runway.',
        metric: 'cash_runway',
        value: '18',
        period: '2026-09',
        unit: 'months',
        kind: 'actual',
        supersededByTurnId: null,
        uncertainty: '',
      },
    ],
    focusAreas: [],
  };
  const evaluation = evaluationRecordSchema.parse({
    id: randomUUID(),
    version: 1,
    evaluatorVersion: 'test-fictional',
    model: 'test-fictional',
    contextHash: hashEvaluationInput(context),
    transcriptHash: hashEvaluationInput(turns.map(({ role, text }) => ({ role, text }))),
    turns,
    scope: 'complete',
    status: 'completed',
    reason: null,
    generation: 0,
    createdAt: context.capturedAt,
    completedAt: context.capturedAt,
    parentEvaluationId: null,
    parentItemId: null,
    clarification: null,
    requestKey: null,
    report: {
      extraction,
      checks: [
        {
          claimId: 'profit',
          support: 'contradicted',
          factIds: ['2026-09:operating_income'],
          explanation: 'Operating income differs from the claim.',
        },
        {
          claimId: 'revenue',
          support: 'supported',
          factIds: ['2026-09:revenue'],
          explanation: 'Revenue matches the saved statement.',
        },
        {
          claimId: 'runway',
          support: 'insufficient_evidence',
          factIds: [],
          explanation: 'No cash balance or cash-flow evidence is available.',
        },
      ],
      coaching: {
        summary: 'Fictional coaching: explain operating income separately from net income.',
        comparison: null,
        items: [
          {
            id: 'profit-coaching',
            claimId: 'profit',
            relevance: 'useful_but_incomplete',
            establishes: 'You identified positive net income.',
            gap: 'It does not establish operating profitability.',
            suggestion: 'Explain the credit separately.',
            sourceIds: ['financial:fictional-snapshot:4'],
            factIds: [
              '2026-09:operating_income',
              '2026-09:other_income_credit',
              '2026-09:net_income',
            ],
            investorSourceIds: [],
            missingInputs: ['Cash-flow data for runway'],
            exampleAnswer:
              'Net income was CAD 12000, including a CAD 30000 credit. Operations lost CAD 18000.',
            clarificationQuestion: 'Did you mean net income?',
            practiceQuestion: 'Explain the bridge from operating loss to net income.',
            successCriteria: ['Separate operations from the credit.'],
          },
        ],
      },
    },
  });
  return { context, evaluation };
}

export function refreshEvidenceHashes(
  context: EvaluationContext,
  evaluation: EvaluationRecord,
): void {
  evaluation.contextHash = hashEvaluationInput(context);
  evaluation.transcriptHash = hashEvaluationInput(
    evaluation.turns.map(({ role, text }) => ({ role, text })),
  );
}
