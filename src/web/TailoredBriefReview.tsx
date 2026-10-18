import { ChevronRight } from 'lucide-react';
import type { z } from 'zod';
import type { preparationSourceSchema } from '../contracts/ConnectedPreparation.js';
import { StorySourceExcerpt } from './StorySourceExcerpt.js';

/** Display-only extraction from the saved brief. The complete approval text is always retained. */
export function summarizeTailoredBrief(brief: string) {
  const blocks = brief
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const objectiveBlock = blocks.find((block) => block.startsWith('Company objective: '));
  const objectiveText = objectiveBlock?.slice('Company objective: '.length);
  const checkIndex = objectiveText?.indexOf('Desired individual check');
  const objective =
    objectiveText && checkIndex !== undefined && checkIndex >= 0
      ? objectiveText.slice(0, checkIndex).trim()
      : objectiveText;
  const check =
    objectiveText && checkIndex !== undefined && checkIndex >= 0
      ? objectiveText.slice(checkIndex).trim()
      : null;
  const preparation = blocks.findLast((block) => block.startsWith('Preparation hypotheses: '));
  const questionBlock = preparation?.split('Questions to ask: ')[1];
  const questionSentence = questionBlock?.match(/^[^.!?]+[.!?]?/)?.[0];
  const focus = preparation
    ?.slice('Preparation hypotheses: '.length)
    .split('Questions to ask: ')[0]
    ?.trim();
  const questions =
    questionSentence
      ?.replace(/[.!?]$/, '')
      .split(/,\s*|\s+and\s+/)
      .map((value) => value.trim().replace(/^and\s+/, ''))
      .filter(Boolean) ?? [];
  const audience = blocks.findLast((block) => block.startsWith('Why this audience: '));
  return {
    heading: blocks[0]?.startsWith('Prepare for ') ? blocks[0] : 'Saved investor brief',
    objective: objective || null,
    check,
    focus: focus || null,
    questions,
    needsVerification:
      !!audience &&
      (audience.includes('Eligibility needs verification') ||
        audience.includes('No reviewed match assessment')),
  };
}

export function TailoredBriefReview({
  brief,
  sources,
  fictional,
}: {
  brief: string;
  sources: z.infer<typeof preparationSourceSchema>[];
  fictional: boolean;
}) {
  const summary = summarizeTailoredBrief(brief);
  return (
    <div className="brief-review">
      <div className="brief-review-overview">
        <p className="brief-review-audience">{summary.heading}</p>
        {fictional && <span className="loop-tag">Fictional demo evidence</span>}
        {summary.objective && (
          <div>
            <span className="brief-review-label">Your goal</span>
            <p>{summary.objective}</p>
          </div>
        )}
        {summary.check && <p className="story-support-hint">{summary.check}</p>}
      </div>
      {summary.needsVerification && (
        <p className="brief-review-gap">Investor eligibility still needs verification.</p>
      )}
      {(summary.focus || summary.questions.length > 0) && (
        <section className="brief-review-focus" aria-label="Conversation focus">
          <h3>Conversation focus</h3>
          {summary.focus && <p>{summary.focus}</p>}
          {summary.questions.length > 0 && (
            <>
              <span className="brief-review-label">Ask about</span>
              <ul>
                {summary.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <details className="brief-review-details">
        <summary>Full saved brief</summary>
        <p className="loop-prose brief-review-full">{brief}</p>
      </details>
      <details className="brief-review-details">
        <summary>Sources · {sources.length}</summary>
        {sources.map((source) => (
          <details className="story-source-card" key={source.id}>
            <summary>
              <ChevronRight size={16} className="story-source-chevron" aria-hidden="true" />
              <span>{source.title}</span>
              {source.fictional && <small>Fictional</small>}
            </summary>
            <div className="story-source-content">
              <StorySourceExcerpt excerpt={source.excerpt} />
              {source.url?.startsWith('https://') && (
                <a href={source.url} target="_blank" rel="noreferrer">
                  Open original source ↗
                </a>
              )}
            </div>
          </details>
        ))}
        {!sources.length && (
          <p className="story-support-hint">Source context is retained in the full saved brief.</p>
        )}
      </details>
      <p className="story-support-hint">Approval keeps this saved brief and opens practice.</p>
    </div>
  );
}
