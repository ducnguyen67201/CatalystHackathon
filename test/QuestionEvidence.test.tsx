import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { evidenceFixture } from './EvidenceReviewFixtures.js';
import { evaluationWhySources, scenarioWhySources } from '../src/features/QuestionEvidence.js';
import { QuestionEvidenceSheet, formatEvidenceAmount } from '../src/web/QuestionEvidenceSheet.js';
import { QuestionExplanation } from '../src/web/QuestionExplanation.js';
import { scenarioInputSchema } from '../src/contracts/Scenario.js';
import { preparedPitchContextSchema } from '../src/contracts/ConnectedPreparation.js';
import { QuestionSourceCard } from '../src/web/QuestionSourceCard.js';
import { randomUUID } from 'node:crypto';

describe('question source evidence presentation', () => {
  it('presents a saved preparation as story and goal cards, keeping exact lineage and full text inside disclosures', () => {
    const { context } = evidenceFixture();
    const preparation = preparedPitchContextSchema.parse({
      cycleId: randomUUID(),
      pitchId: randomUUID(),
      goalId: randomUUID(),
      sourceHash: 'exact-source-hash',
      investorSourceHash: 'exact-investor-hash',
      pitch: 'Fictional operating income was -59797.0001 CAD. Cash receipt remains unknown.',
      brief:
        'Prepare for Fictional Fund for Pre-seed.\n\nCompany objective: Explain our fictional operating result. Desired individual check size is unconfirmed.\n\nPreparation hypotheses: explain use of funds. Questions to ask: confirm mandate and check range.',
      sources: [
        {
          id: 'fictional-original',
          title: 'Fictional statement',
          excerpt: 'Exact original passage 182300.0000',
          url: null,
          recordedAt: null,
          fictional: true,
        },
      ],
      fictional: false,
    });
    const raw = JSON.stringify(preparation);
    context.sources.push({
      id: 'approved-preparation',
      kind: 'company',
      title: 'Founder-reviewed pitch and investor brief',
      text: raw,
      url: null,
      recordedAt: null,
      origin: 'founder',
    });
    const before = JSON.stringify(context);
    const source = evaluationWhySources(context).find((item) => item.id === 'approved-preparation');
    const html = renderToStaticMarkup(<QuestionSourceCard source={source} />);
    const overview = html.split('<details')[0] ?? '';
    expect(overview).toContain('Your goal');
    expect(overview).toContain(preparation.pitch);
    expect(overview).toContain('Fictional demo evidence');
    expect(overview).not.toContain(preparation.cycleId);
    expect(overview).not.toContain(preparation.sourceHash);
    expect(html).toContain('Investor talking points');
    expect(html).toContain('Saved record &amp; technical details');
    expect(html).toContain(preparation.cycleId);
    expect(html).toContain('182300.0000');
    expect(html).not.toContain('<details open');
    expect(source?.originalText).toBe(raw);
    expect(JSON.stringify(context)).toBe(before);
  });

  it('does not label an unrecognized legacy company record as an approved story', () => {
    const { context } = evidenceFixture();
    context.sources.push({
      id: 'legacy-context',
      kind: 'company',
      title: 'Saved company context',
      text: '{"goal":"Fictional goal","pitch":"Unapproved draft"}',
      url: null,
      recordedAt: null,
      origin: 'founder',
    });
    const source = evaluationWhySources(context).find((item) => item.id === 'legacy-context');
    expect(source?.preparation).toBeUndefined();
    const html = renderToStaticMarkup(<QuestionSourceCard source={source} />);
    expect(html).toContain('Unapproved draft');
    expect(html).not.toContain('Approved company story');
    expect(html).not.toContain('Founder reviewed');
  });
  it('projects saved financial rows without changing evidence and renders readable amounts instead of JSON', () => {
    const { context } = evidenceFixture();
    const before = JSON.stringify(context);
    const sources = evaluationWhySources(context);
    const rows = sources.flatMap((source) => source.financialRows);
    expect(rows).toHaveLength(2);
    const selected = rows.find((row) => row.values.month === '2026-09');
    if (!selected) throw new Error('Missing financial fixture');
    const html = renderToStaticMarkup(
      <QuestionEvidenceSheet
        rows={rows}
        selectedKey={selected.key}
        facts={context.facts.filter((fact) => fact.id === '2026-09:operating_income')}
        onSelectPeriod={() => undefined}
      />,
    );
    expect(html).toContain('Saved financial source values');
    expect(html).toContain('-18,000');
    expect(html).toContain('CSV row 4');
    expect(html).toContain('operating_income');
    expect(html).toContain('cited-value');
    expect(html).not.toContain('&quot;operatingIncome&quot;');
    expect(JSON.stringify(context)).toBe(before);
  });
  it('renders the Why explanation next to directly inspectable source data', () => {
    const { context } = evidenceFixture();
    const sources = evaluationWhySources(context);
    const html = renderToStaticMarkup(
      <QuestionExplanation
        question="Explain operating performance."
        why={{
          brief: 'Explain the operating result.',
          explanation: 'The credit and operating result establish different things.',
          answerObjective: 'Distinguish known facts from assumptions.',
          sourceIds: sources.map((source) => source.id),
          missingInputs: ['Cash-flow evidence'],
        }}
        sources={sources}
      />,
    );
    expect(html).toContain('question-why-workspace');
    expect(html).toContain('question-evidence-pane');
    expect(html).toContain('Financial statement');
    expect(html).toContain('Source data');
    expect(html).toContain('-18,000');
    expect(html).not.toContain('{&quot;month&quot;');
  });
  it('keeps malformed legacy sources out of the worksheet and never infers a missing filename', () => {
    const { context } = evidenceFixture();
    const first = context.sources[0];
    if (!first) throw new Error('Missing source');
    first.text = '{"month":"bad", "operatingIncome":"wrong"}';
    let projected = evaluationWhySources(context);
    expect(projected[0]?.financialRows).toEqual([]);
    expect(projected[0]?.text).toContain('no readable financial rows');
    const second = context.sources[1];
    if (!second) throw new Error('Missing source');
    delete second.financialLocation;
    projected = evaluationWhySources(context);
    expect(projected[1]?.financialRows[0]?.fileName).toBeNull();
    first.financialLocation = {
      kind: 'csv',
      snapshotId: 'saved',
      fileName: 'Fictional.csv',
      sourceRow: 999,
    };
    first.text = second.text;
    expect(evaluationWhySources(context)[0]?.financialRows).toEqual([]);
  });
  it('keeps current and previous snapshots separate in the worksheet', () => {
    const { context } = evidenceFixture();
    const source = context.sources[0];
    if (!source) throw new Error('Missing source');
    const raw: unknown = JSON.parse(source.text);
    const input = scenarioInputSchema.parse({
      schemaVersion: 1,
      capturedAt: context.capturedAt,
      investor: {
        id: '90b0ebca-3a2b-40c7-9442-694d04999b60',
        name: 'Fictional investor',
        url: null,
        profileLinks: [],
      },
      objective: 'Explain the saved figures.',
      coverage: [],
      omittedEvidenceIds: [],
      sources: [
        {
          id: 'financials',
          schemaVersion: 1,
          capturedAt: context.capturedAt,
          kind: 'financials',
          provenance: 'fictional_demo',
          omittedSnapshots: 0,
          snapshots: ['current', 'previous'].map((role) => ({
            snapshotId: role,
            hash: role,
            fileName: role + '.csv',
            createdAt: context.capturedAt,
            currency: 'CAD',
            fictional: true,
            role,
            totalRows: 1,
            periods: [raw],
          })),
        },
      ],
    });
    const sources = scenarioWhySources(input);
    const rows = sources.flatMap((item) => item.financialRows);
    expect(rows.map((row) => row.snapshotId)).toEqual(['current', 'previous']);
    const previous = rows[1];
    if (!previous) throw new Error('Missing previous row');
    const html = renderToStaticMarkup(
      <QuestionEvidenceSheet
        rows={rows}
        selectedKey={previous.key}
        facts={[]}
        onSelectPeriod={() => undefined}
      />,
    );
    expect(html).toContain('Previous snapshot');
    expect(html).toContain('previous.csv');
    expect((html.match(/CSV row 3<\/small>/g) ?? []).length).toBe(1);
  });
  it('formats saved decimal strings without rounding or dropping precision', () => {
    expect(formatEvidenceAmount('-12345.6700')).toBe('-12,345.6700');
    expect(formatEvidenceAmount('0.00000001')).toBe('0.00000001');
    expect(formatEvidenceAmount('12345678901234567890.1234')).toBe(
      '12,345,678,901,234,567,890.1234',
    );
  });
});
