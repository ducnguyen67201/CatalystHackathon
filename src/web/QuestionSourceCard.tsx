import { BookOpen, FileText, Target, ArrowUpRight } from 'lucide-react';
import type { WhySource } from '../features/QuestionEvidence.js';
import { summarizeTailoredBrief } from './TailoredBriefReview.js';

/** A display of the saved record, with full provenance kept behind disclosure controls. */
export function QuestionSourceCard({ source }: { source: WhySource | undefined }) {
  if (!source)
    return <p className="why-empty-source">No source is needed for this general clarification.</p>;
  const prepared = source.preparation;
  const brief = prepared ? summarizeTailoredBrief(prepared.brief) : null;
  const fictional =
    source.label === 'Fictional demo' ||
    prepared?.fictional ||
    prepared?.sources.some((item) => item.fictional);
  return (
    <article className="why-source-card">
      <header className="why-source-card-head">
        <span className="why-icon">
          <FileText size={19} aria-hidden="true" />
        </span>
        <div>
          <span className="why-kicker">{prepared ? 'Your preparation' : 'Saved source'}</span>
          <h3>{prepared ? 'Approved company story' : source.title}</h3>
        </div>
      </header>
      <div className="why-source-tags">
        <span>{prepared ? 'Founder reviewed' : fictional ? 'Saved source' : source.label}</span>
        {fictional && <span className="why-fictional">Fictional demo evidence</span>}
      </div>
      {prepared && brief ? (
        <>
          <div className="why-audience">
            <Target size={16} aria-hidden="true" />
            <span>{brief.heading}</span>
          </div>
          {brief.objective && (
            <section className="why-source-section">
              <h4>Your goal</h4>
              <p>{brief.objective}</p>
            </section>
          )}
          <section className="why-story-quote">
            <span className="why-kicker">
              <BookOpen size={14} aria-hidden="true" /> Your approved story
            </span>
            <p>{prepared.pitch}</p>
          </section>
          <details className="why-source-disclosure">
            <summary>Investor talking points</summary>
            {brief.focus && <p>{brief.focus}</p>}
            {brief.questions.length > 0 && (
              <ul>
                {brief.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            )}
            {brief.needsVerification && <p>Investor eligibility still needs verification.</p>}
            <details>
              <summary>Full saved brief</summary>
              <p className="why-saved-prose">{prepared.brief}</p>
            </details>
          </details>
          <details className="why-source-disclosure">
            <summary>Original supporting sources · {prepared.sources.length}</summary>
            {prepared.sources.map((item) => (
              <details className="why-nested-source" key={item.id}>
                <summary>
                  {item.title}
                  {item.fictional ? ' · Fictional demo' : ''}
                </summary>
                <pre>{item.excerpt}</pre>
                {item.url && /^https?:\/\//.test(item.url) && (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Read original source <ArrowUpRight size={13} aria-hidden="true" />
                  </a>
                )}
              </details>
            ))}
            {!prepared.sources.length && (
              <p>No original supporting sources were saved with this story.</p>
            )}
          </details>
        </>
      ) : (
        <blockquote className="why-story-quote why-saved-prose">{source.text}</blockquote>
      )}
      {source.date && <p className="why-source-date">Saved: {source.date}</p>}
      {source.url && /^https?:\/\//.test(source.url) && (
        <a className="why-source-link" href={source.url} target="_blank" rel="noreferrer">
          Read original source <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      )}
      <details className="why-source-disclosure why-technical-details">
        <summary>Saved record & technical details</summary>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>{source.title}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{source.id}</dd>
          </div>
        </dl>
        <pre>{source.originalText ?? source.text}</pre>
      </details>
    </article>
  );
}
