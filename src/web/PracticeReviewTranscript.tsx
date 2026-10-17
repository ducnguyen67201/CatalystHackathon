import { RecordingPlayback, playbackTime } from './RecordingPlayback.js';
import type { RecordingPlayback as Playback } from '../contracts/RecordingPlayback.js';
import { useRef, useState, type ReactNode } from 'react';
import type { EvaluationReport, EvaluationRecord } from '../contracts/RehearsalEvaluation.js';
import './PracticeReviewTranscript.css';

export interface ReviewFinding {
  id: string;
  kind: 'strength' | 'improvement';
  title: string;
  explanation: string;
  quote: string;
  turnId: string;
  assessment?: string;
  preparation?: string[];
}

export function transcriptFindings(report: EvaluationReport | null): ReviewFinding[] {
  if (!report) return [];
  return [
    ...(report.coaching.strengths ?? []).flatMap((strength, index) =>
      strength.claimIds.flatMap((claimId) => {
        const claim = report.extraction.claims.find(
          (item) => item.id === claimId && !item.supersededByTurnId,
        );
        return claim
          ? [
              {
                id: `strength:${index}:${claimId}`,
                kind: 'strength' as const,
                title: strength.statement,
                explanation: strength.significance ?? '',
                quote: claim.quote,
                turnId: claim.turnId,
              },
            ]
          : [];
      }),
    ),
    ...report.coaching.items.flatMap((item) => {
      const claim = report.extraction.claims.find(
        (claim) => claim.id === item.claimId && !claim.supersededByTurnId,
      );
      return claim
        ? [
            {
              id: `improvement:${item.id}`,
              kind: 'improvement' as const,
              title: item.gap,
              explanation: item.suggestion,
              quote: claim.quote,
              turnId: claim.turnId,
              assessment:
                report.checks.find((check) => check.claimId === claim.id)?.explanation ??
                'Review the cited evidence before drawing a conclusion.',
              preparation: item.analysis?.preparationSteps ?? [item.suggestion],
            },
          ]
        : [];
    }),
  ];
}

/** Repeated or overlapping quotations fall back to the whole turn instead of guessing a span. */
export function uniqueQuoteSpan(text: string, quote: string) {
  const start = text.indexOf(quote);
  return quote && start >= 0 && text.indexOf(quote, start + 1) === -1
    ? { start, end: start + quote.length }
    : null;
}

export function quoteHighlights(
  text: string,
  findings: ReviewFinding[],
  selectedId: string | null,
) {
  const highlights: { start: number; end: number; finding: ReviewFinding }[] = [];
  const ordered = [...findings].sort(
    (a, b) => Number(b.id === selectedId) - Number(a.id === selectedId),
  );
  for (const finding of ordered) {
    const span = uniqueQuoteSpan(text, finding.quote);
    if (span && !highlights.some((other) => span.start < other.end && span.end > other.start)) {
      highlights.push({ ...span, finding });
    }
  }
  return highlights.sort((a, b) => a.start - b.start);
}

export function PracticeReviewTranscript({
  turns,
  report,
  sessionId,
}: {
  turns: EvaluationRecord['turns'];
  report: EvaluationReport | null;
  sessionId?: string;
}) {
  const findings = transcriptFindings(report);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seekRequest, setSeekRequest] = useState<{ turnIndex: number; requestId: number } | null>(
    null,
  );
  const [timings, setTimings] = useState<Playback['segments']>([]);
  const [playingTurn, setPlayingTurn] = useState<number | null>(null);
  const seekNumber = useRef(0);
  const nodes = useRef(new Map<string, HTMLElement>());
  const selected = findings.find((finding) => finding.id === selectedId);
  const jump = (finding: ReviewFinding) => {
    setSelectedId(finding.id);
    setSeekRequest({
      turnIndex: turns.findIndex((turn) => turn.id === finding.turnId),
      requestId: ++seekNumber.current,
    });
    const node = nodes.current.get(finding.turnId);
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  };
  return (
    <section className="practice-review" aria-label="Feedback and full transcript">
      <div className="practice-review-heading">
        <h3>Replay the conversation in context</h3>
        <p className="muted">
          Select an assessment to inspect its assertion, evidence and preparation advice. Load a
          recording to seek matching provider timestamps when available.
        </p>
        <div className="practice-review-legend">
          <span>✓ What went well</span>
          <span>↗ What to improve</span>
        </div>
      </div>
      <div className="practice-review-grid">
        <aside className="practice-findings" aria-label="Conversation feedback">
          {(['strength', 'improvement'] as const).map((kind) => (
            <section key={kind}>
              <h4>{kind === 'strength' ? 'What went well' : 'What to improve'}</h4>
              {findings.filter((finding) => finding.kind === kind).length ? (
                findings
                  .filter((finding) => finding.kind === kind)
                  .map((finding) => {
                    const turnIndex = turns.findIndex((turn) => turn.id === finding.turnId);
                    return (
                      <button
                        key={finding.id}
                        className={`practice-finding ${kind}`}
                        aria-pressed={selectedId === finding.id}
                        aria-expanded={selectedId === finding.id}
                        onClick={() => jump(finding)}
                      >
                        <span>
                          {kind === 'strength' ? '✓' : '↗'} ·{' '}
                          {turnIndex >= 0 ? `Turn ${turnIndex + 1}` : 'Passage unavailable'}
                          {timings.find((segment) => segment.turnIndex === turnIndex) &&
                            ` · starts at ${playbackTime(timings.find((segment) => segment.turnIndex === turnIndex)?.startSeconds ?? 0)}`}
                        </span>
                        <strong>{finding.title}</strong>
                        <small>
                          {selectedId === finding.id
                            ? 'Assessment selected'
                            : 'Inspect assessment →'}
                        </small>
                      </button>
                    );
                  })
              ) : (
                <p className="muted">
                  {!report
                    ? 'No saved evaluation is available yet.'
                    : kind === 'strength'
                      ? 'No specific strength was established in this review.'
                      : 'No answer-linked improvement was identified within this review’s coverage.'}
                </p>
              )}
            </section>
          ))}
          {selected && (
            <section className="assertion-inspector" aria-label="Selected assessment details">
              <h4>{selected.kind === 'strength' ? 'Strength observed' : 'Needs preparation'}</h4>
              <h5>Assertion</h5>
              <blockquote>{selected.quote}</blockquote>
              <h5>Assessment</h5>
              <p>{selected.title}</p>
              <h5>Why it matters</h5>
              <p>{selected.explanation}</p>
              {selected.assessment && (
                <>
                  <h5>Evidence check</h5>
                  <p>{selected.assessment}</p>
                </>
              )}
              {selected.preparation && (
                <>
                  <h5>Prepare next</h5>
                  <ul>
                    {selected.preparation.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </aside>
        <div className="practice-review-main">
          <RecordingPlayback
            sessionId={sessionId}
            findings={findings}
            turns={turns}
            selection={seekRequest}
            onSeek={(index) => {
              setPlayingTurn(index);
              const node = nodes.current.get(turns[index]?.id ?? '');
              node?.focus({ preventScroll: true });
              node?.scrollIntoView({ block: 'nearest' });
            }}
            onActiveTurn={setPlayingTurn}
            onTiming={setTimings}
            onFindingSelect={(id) => {
              const finding = findings.find((item) => item.id === id);
              if (finding) jump(finding);
            }}
          />
          <div className="practice-transcript" aria-label="Full saved transcript">
            <h4>
              Full transcript <span>{turns.length} turns</span>
            </h4>
            {!turns.length && <p>No transcript has arrived for this session.</p>}
            {turns.map((turn, index) => {
              const related = findings.filter((finding) => finding.turnId === turn.id);
              const active =
                selected?.turnId === turn.id
                  ? selected
                  : (related.find((finding) => finding.kind === 'improvement') ?? related[0]);
              const span = active ? uniqueQuoteSpan(turn.text, active.quote) : null;
              const content: ReactNode[] = [];
              let offset = 0;
              for (const highlight of quoteHighlights(turn.text, related, selectedId)) {
                content.push(turn.text.slice(offset, highlight.start));
                content.push(
                  <mark key={highlight.finding.id} className={highlight.finding.kind}>
                    {turn.text.slice(highlight.start, highlight.end)}
                  </mark>,
                );
                offset = highlight.end;
              }
              content.push(turn.text.slice(offset));
              return (
                <article
                  key={turn.id}
                  ref={(node) => {
                    if (node) nodes.current.set(turn.id, node);
                    else nodes.current.delete(turn.id);
                  }}
                  tabIndex={-1}
                  className={`practice-bubble ${turn.role} ${active?.kind ?? ''} ${selected?.turnId === turn.id ? 'selected' : ''} ${playingTurn === index ? 'playing' : ''}`}
                  aria-label={`${turn.role === 'user' ? 'Founder' : 'June'}, turn ${index + 1}`}
                >
                  <header>
                    <strong>{turn.role === 'user' ? 'You' : 'June · AI interviewer'}</strong>
                    <span>
                      Turn {index + 1}
                      {timings.find((segment) => segment.turnIndex === index) &&
                        ` · starts at ${playbackTime(timings.find((segment) => segment.turnIndex === index)?.startSeconds ?? 0)}`}
                    </span>
                  </header>
                  <p>{content}</p>
                  {related.length > 0 && (
                    <div className="practice-turn-findings">
                      {related.map((finding) => (
                        <button
                          key={finding.id}
                          className={finding.kind}
                          aria-pressed={selectedId === finding.id}
                          onClick={() => jump(finding)}
                        >
                          {finding.kind === 'strength'
                            ? '✓ What went well'
                            : '↗ Improve this answer'}
                        </button>
                      ))}
                    </div>
                  )}
                  {selected?.turnId === turn.id && (
                    <div className="practice-passage-feedback" role="status">
                      <strong>{selected.title}</strong>
                      <p>{selected.explanation}</p>
                      {!span && (
                        <small>
                          Exact quote cannot be highlighted uniquely; the full turn is selected.
                        </small>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
