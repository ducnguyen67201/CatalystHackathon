import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TailoredBriefReview, summarizeTailoredBrief } from '../src/web/TailoredBriefReview.js';

const brief = `Prepare for Fictional VC for Seed.

Company objective: Raise our seed round. Desired individual check: CAD 100000–250000.

Approved company story (revision 1; full text retained with the brief):
Fictional source values remain unverified.

Why this audience: Eligibility needs verification; selection is a founder decision. stage: No mandate.

Preparation hypotheses: explain use of funds, individual participation, and financial evidence. Questions to ask: confirm current mandate, check range, and decision process. Additional unknown eligibility details.`;

describe('tailored brief review presentation', () => {
  it('extracts saved discussion points without mixing unknown eligibility explanations into questions', () => {
    const summary = summarizeTailoredBrief(brief);
    expect(summary.objective).toBe('Raise our seed round.');
    expect(summary.check).toBe('Desired individual check: CAD 100000–250000.');
    expect(summary.questions).toEqual([
      'confirm current mandate',
      'check range',
      'decision process',
    ]);
    expect(summary.needsVerification).toBe(true);
  });

  it('retains the exact approval text and source snapshots behind optional details', () => {
    const html = renderToStaticMarkup(
      <TailoredBriefReview
        brief={brief}
        sources={[
          {
            id: 'source',
            title: 'Fictional statement',
            excerpt: 'Exact saved passage.',
            url: null,
            recordedAt: null,
            fictional: true,
          },
        ]}
        fictional
      />,
    );
    expect(html).toContain(brief);
    expect(html).toContain('Exact saved passage.');
    expect(html).toContain('Fictional demo evidence');
    expect(html).toContain('<summary>Full saved brief</summary>');
  });

  it('keeps legacy briefs available without inventing a goal or investment criteria', () => {
    const legacy = 'An older saved preparation note without structured headings.';
    const summary = summarizeTailoredBrief(legacy);
    expect(summary.objective).toBeNull();
    expect(summary.questions).toEqual([]);
    expect(summary.check).toBeNull();
    expect(
      renderToStaticMarkup(<TailoredBriefReview brief={legacy} sources={[]} fictional={false} />),
    ).toContain(legacy);
  });
});
