import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { evaluationRecordSchema } from '../src/contracts/RehearsalEvaluation.js';
import { PitchPreparationReport } from '../src/web/PitchPreparationReport.js';
import { evidenceFixture } from './EvidenceReviewFixtures.js';

describe('Pitch preparation report', () => {
  it('keeps historical reviews readable without fabricating strengths', () => {
    const { evaluation } = evidenceFixture();
    const before = JSON.stringify(evaluation);
    const html = renderToStaticMarkup(
      <PitchPreparationReport evaluation={evaluationRecordSchema.parse(evaluation)} fictional />,
    );
    expect(html).toContain('Your Pitch Preparation Report');
    expect(html).toContain('Strengths were not assessed in this earlier review.');
    expect(html).toContain('Financial blind spots');
    expect(html).toContain('Recommended preparation');
    expect(html).toContain('Fictional demo');
    expect(html).toContain(evaluation.report?.coaching.items[0]?.gap);
    expect(html).toContain(evaluation.report?.coaching.items[0]?.suggestion);
    expect(JSON.stringify(evaluation)).toBe(before);
  });
  it('shows saved strengths with their supporting answers even when no coaching pivot is needed', () => {
    const { evaluation } = evidenceFixture();
    if (!evaluation.report) throw new Error('Missing report');
    evaluation.report.coaching.strengths = [
      {
        statement: 'You distinguished operations from the net result.',
        claimIds: ['claim'],
        turnIds: [evaluation.turns[1]?.id ?? ''],
      },
    ];
    evaluation.report.coaching.items = [];
    evaluation.scope = 'partial';
    const html = renderToStaticMarkup(
      <PitchPreparationReport evaluation={evaluation} fictional={false} />,
    );
    expect(html).toContain('You distinguished operations from the net result.');
    expect(html).toContain(evaluation.turns[1]?.text);
    expect(html).toContain('Limited session summary');
    expect(html).toContain('No financial blind spot was identified within');
    expect(html).not.toContain('Fictional demo');
    evaluation.report.coaching.strengths = [];
    expect(
      renderToStaticMarkup(<PitchPreparationReport evaluation={evaluation} fictional={false} />),
    ).toContain('did not establish a specific strength');
  });
  it('shows the analyst interpretation, diligence significance and actionable preparation without losing source access', () => {
    const { evaluation } = evidenceFixture();
    const item = evaluation.report?.coaching.items[0];
    if (!item || !evaluation.report) throw new Error('Missing fixture item');
    evaluation.report.coaching.strengths = [
      {
        statement: 'You identified the operating result.',
        significance:
          'This anchors the discussion in operating performance without proving cash generation.',
        claimIds: ['claim'],
        turnIds: [evaluation.turns[1]?.id ?? ''],
      },
    ];
    item.analysis = {
      financialInterpretation:
        'A credit affects net income without establishing profitable operations.',
      investorImplication:
        'The reconciliation helps distinguish operating performance from other income.',
      preparationSteps: [
        'Prepare the reconciliation using the saved source rows.',
        'Confirm the credit recognition basis and cash timing.',
      ],
    };
    const before = JSON.stringify(evaluation);
    const html = renderToStaticMarkup(<PitchPreparationReport evaluation={evaluation} fictional />);
    expect(html).toContain(item.analysis.financialInterpretation);
    expect(html).toContain(item.analysis.investorImplication);
    expect(html).toContain('Why it matters:');
    expect(html).toContain('<ol');
    expect(html).toContain(item.analysis.preparationSteps[0]);
    expect(html).toContain('Supporting answer and evidence');
    expect(html).toContain('without proving cash generation');
    expect(JSON.stringify(evaluation)).toBe(before);
  });
});
