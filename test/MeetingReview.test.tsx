import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeetingBriefs, linkedBriefPractices, practiceInvestor } from '../src/web/MeetingBriefs.js';
import {
  PracticeReviewTranscript,
  transcriptFindings,
  uniqueQuoteSpan,
  quoteHighlights,
} from '../src/web/PracticeReviewTranscript.js';
import { meetingReviewFixture } from './MeetingReviewFixtures.js';

describe('meeting brief archive and transcript review', () => {
  it('retains record views, source question, sorting and keyboard-accessible drawer triggers in cards', () => {
    const state = meetingReviewFixture();
    const html = renderToStaticMarkup(
      <MeetingBriefs
        state={state}
        initialBriefId={null}
        busy={false}
        onCloseSelection={() => {}}
        onRefreshBrief={() => {}}
        onPractice={() => {}}
        onFollowup={() => {}}
      />,
    );
    expect(html).toContain('meeting-record-card');
    expect(html).toContain(state.workspace.briefs[0]?.finding.question);
    expect(html).toContain('Practice reviews');
    expect(html).toContain('Fictional Seed Fund');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Sort records: newest first');
    expect(html).toContain('Search meeting records');
    expect(html).not.toContain('<dialog');
  });
  it('links reviewed brief revisions but does not attach a different brief or an open practice', () => {
    const state = meetingReviewFixture();
    const brief = state.workspace.briefs[0];
    const session = state.workspace.rehearsals[0];
    if (!brief || !session) throw new Error('Missing fixture');
    const reviewed = {
      ...brief,
      id: 'reviewed',
      previousBriefId: brief.id,
      review: { answer: 'Fictional answer', covered: [], missing: [], note: '' },
    };
    state.workspace.briefs.push(reviewed);
    state.workspace.rehearsals.push({ ...session, id: 'unrelated', briefId: null });
    expect(linkedBriefPractices(reviewed, state.workspace).map((item) => item.id)).toEqual([
      session.id,
    ]);
    expect(linkedBriefPractices({ ...reviewed, review: null }, state.workspace)).toEqual([]);
    expect(
      linkedBriefPractices({ ...reviewed, investor: 'Another investor' }, state.workspace),
    ).toEqual([]);
    expect(practiceInvestor({ ...session, briefId: null }, state.workspace)).toBe('Open practice');
  });
  it('builds strength and improvement links to the exact cited transcript turn', () => {
    const evaluation = meetingReviewFixture().workspace.rehearsals[0]?.evaluations[0];
    if (!evaluation?.report) throw new Error('Missing report');
    const findings = transcriptFindings(evaluation.report);
    expect(findings.map((finding) => [finding.kind, finding.turnId])).toEqual([
      ['strength', 'answer'],
      ['improvement', 'answer'],
    ]);
    const html = renderToStaticMarkup(
      <PracticeReviewTranscript turns={evaluation.turns} report={evaluation.report} />,
    );
    expect(html).toContain('What went well');
    expect(html).toContain('What to improve');
    expect(html).toContain('We have eighteen months of runway.');
    expect(html).toContain(
      '<mark class="improvement">We made CAD 12000 in operating profit.</mark>',
    );
    expect(html).toContain('<mark class="strength">September revenue was CAD 92000.</mark>');
    expect(html).toContain('Load a recording');
    expect(html).toContain('actual audio samples');
    expect(html).not.toContain('00:00');
  });
  it('does not invent a location for missing or repeated quotations', () => {
    expect(uniqueQuoteSpan('😀 revenue is up.', 'revenue')).toEqual({ start: 3, end: 10 });
    expect(uniqueQuoteSpan('same same', 'same')).toBeNull();
    expect(uniqueQuoteSpan('saved passage', 'missing')).toBeNull();
    expect(uniqueQuoteSpan('saved passage', '')).toBeNull();
  });
  it('highlights separate passages together and gives a selected overlap precedence', () => {
    const base = { kind: 'strength' as const, title: 'Finding', explanation: '', turnId: 'turn' };
    const findings = [
      { ...base, id: 'short', quote: 'revenue' },
      { ...base, id: 'long', quote: 'revenue is up' },
    ];
    expect(
      quoteHighlights('revenue is up', findings, 'long').map((span) => span.finding.id),
    ).toEqual(['long']);
  });
  it('does not highlight superseded claims as current feedback', () => {
    const evaluation = meetingReviewFixture().workspace.rehearsals[0]?.evaluations[0];
    const report = evaluation?.report;
    if (!report) throw new Error('Missing report');
    for (const claim of report.extraction.claims) claim.supersededByTurnId = 'later';
    expect(transcriptFindings(report)).toEqual([]);
  });
  it('keeps unreviewed transcripts readable without inventing strengths', () => {
    const html = renderToStaticMarkup(
      <PracticeReviewTranscript
        turns={[{ id: 'one', role: 'user', text: '<script>unsafe</script>' }]}
        report={null}
      />,
    );
    expect(html).toContain('No saved evaluation');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe');
    expect(transcriptFindings(null)).toEqual([]);
  });
});
