import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { preparedPitchContextSchema } from '../src/contracts/ConnectedPreparation.js';
import { buildPracticeAnswerGuide } from '../src/features/PreparedPracticeGuide.js';
import { PreparedPracticeCard } from '../src/web/PreparedPracticeCard.js';

function fixture() {
  const input = {
    preparation: preparedPitchContextSchema.parse({
      cycleId: randomUUID(),
      pitchId: randomUUID(),
      goalId: randomUUID(),
      sourceHash: 'frozen-source',
      investorSourceHash: 'frozen-investor',
      pitch:
        'Fictional report: operating income was -59797.0001 CAD. A credit does not establish cash runway.',
      brief: 'Fictional investor brief; current mandate remains unknown.',
      fictional: true,
      sources: [
        {
          id: 'fictional-financials',
          title: 'Fictional saved statement',
          excerpt: 'Exact saved statement excerpt.',
          url: null,
          recordedAt: null,
          fictional: true,
        },
      ],
    }),
  };
  const scenario = {
    id: 'financial-story',
    title: 'Explain the financial story',
    objective: 'Practise the approved explanation.',
    openingQuestion: 'How do the operating result and credit differ?',
    successCriteria: ['Use the saved figures exactly.', 'Keep unknown cash evidence explicit.'],
  };
  const guide = buildPracticeAnswerGuide(input, scenario);
  return { input, scenario: { ...scenario, answerGuide: guide }, guide };
}

describe('automatically prepared practice answers', () => {
  it('prepares an answer from the frozen approved story and scenario without rewriting financial values or recording a response', () => {
    const f = fixture();
    const before = structuredClone(f.input);
    expect(buildPracticeAnswerGuide(f.input, f.scenario)).toMatchObject({
      text: f.input.preparation.pitch,
      basis: 'approved_story',
      pitchId: f.input.preparation.pitchId,
      sourceIds: ['fictional-financials'],
      fictional: true,
      checkpoints: f.scenario.successCriteria,
    });
    expect(f.input).toEqual(before);
    expect(f.guide?.text).toContain('-59797.0001');
    expect(f.guide).not.toHaveProperty('turns');
    expect(f.guide).not.toHaveProperty('assessment');
  });

  it('does not invent a starting answer when a historical scenario has no approved story', () => {
    const f = fixture();
    expect(buildPracticeAnswerGuide({}, f.scenario)).toBeNull();
  });

  it('preserves fictional source labeling even when only the source snapshot carries it', () => {
    const f = fixture();
    f.input.preparation.fictional = false;
    expect(buildPracticeAnswerGuide(f.input, f.scenario)?.fictional).toBe(true);
  });

  it('offers the AI interview directly with exact scenario and target lineage and no required text input', () => {
    const f = fixture();
    const generationId = randomUUID();
    const targetId = randomUUID();
    const html = renderToStaticMarkup(
      <PreparedPracticeCard
        generationId={generationId}
        scenario={f.scenario}
        targetId={targetId}
        disabled={false}
      />,
    );
    expect(html).toContain('Start AI interview');
    expect(html).toContain(
      `generationId=${generationId}&amp;scenarioId=financial-story&amp;targetId=${targetId}`,
    );
    expect(html).toContain('Suggested starting answer');
    expect(html).toContain(f.input.preparation.pitch);
    expect(html).toContain('Fictional demo evidence');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Save answer');
  });

  it('keeps changed or unapproved preparation from launching the interview', () => {
    const f = fixture();
    const html = renderToStaticMarkup(
      <PreparedPracticeCard
        generationId={randomUUID()}
        scenario={f.scenario}
        targetId={null}
        disabled
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('href=');
  });
});
