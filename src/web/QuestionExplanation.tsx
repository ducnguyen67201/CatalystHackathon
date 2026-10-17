import { useEffect, useId, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import type { QuestionWhy } from '../contracts/QuestionWhy.js';
import type { ScenarioInput } from '../contracts/Scenario.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';
import './GuidedPractice.css';

export interface WhySource {
  id: string;
  title: string;
  text: string;
  url: string | null;
  label: string;
  date: string | null;
}
export function scenarioWhySources(input: ScenarioInput): WhySource[] {
  return input.sources.map((source) => ({
    id: source.id,
    title:
      source.kind === 'investor_research'
        ? source.title
        : source.kind === 'founder_initial'
          ? source.company.name
          : source.kind === 'financials'
            ? source.snapshots.map((snapshot) => snapshot.fileName).join(', ')
            : 'Saved practice',
    text:
      source.kind === 'investor_research'
        ? source.excerpt
        : source.kind === 'founder_initial'
          ? source.company.goal
          : source.kind === 'financials'
            ? source.snapshots
                .map(
                  (snapshot) =>
                    `${snapshot.fileName} · ${snapshot.role} · ${snapshot.currency ?? 'Currency unknown'}\n` +
                    snapshot.periods
                      .map(
                        (period) =>
                          `${period.month} · CSV row ${period.sourceRow}: operating income ${period.operatingIncome}; net income ${period.netIncome}; credit ${period.credit}`,
                      )
                      .join('\n'),
                )
                .join('\n\n')
            : 'Prior practice is coaching context, not verified business evidence.',
    url: source.kind === 'investor_research' ? source.url : null,
    label:
      source.provenance === 'fictional_demo'
        ? 'Fictional demo'
        : source.provenance.replaceAll('_', ' '),
    date:
      source.kind === 'investor_research'
        ? `Published ${source.publishedAt ?? 'unknown'} · Retrieved ${source.retrievedAt}`
        : source.capturedAt,
  }));
}
export function evaluationWhySources(context: EvaluationContext): WhySource[] {
  return context.sources.map((source) => ({
    id: source.id,
    title: source.title,
    text: source.text,
    url: source.url,
    label: source.origin === 'fictional' ? 'Fictional demo' : source.origin.replaceAll('_', ' '),
    date: source.recordedAt,
  }));
}

/** Tooltip and evidence panel read only the explanation saved with this exact question. */
export function QuestionExplanation({
  question,
  why,
  sources,
  facts = [],
}: {
  question: string;
  why: QuestionWhy;
  sources: WhySource[];
  facts?: EvaluationContext['facts'];
}) {
  const tooltipId = useId();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  function close() {
    setOpen(false);
    setSuppressed(true);
    trigger.current?.focus();
  }
  const selected = sources.filter((source) => why.sourceIds.includes(source.id));
  return (
    <div
      className="question-why"
      onMouseEnter={() => setSuppressed(false)}
      onMouseLeave={() => setSuppressed(false)}
    >
      <button
        ref={trigger}
        type="button"
        className="question-why-trigger"
        aria-label="Why this question?"
        aria-describedby={suppressed || open ? undefined : tooltipId}
        onFocus={() => setSuppressed(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setSuppressed(true);
        }}
        onClick={() => setOpen(true)}
      >
        <Info size={14} aria-hidden="true" />
        <span>Why?</span>
      </button>
      {!suppressed && !open && (
        <span role="tooltip" id={tooltipId} className="question-why-tooltip">
          {why.brief}
        </span>
      )}
      <dialog
        ref={dialog}
        className="question-why-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              close();
          }
        }}
      >
        <div className="question-why-head">
          <h2 id={titleId}>Why this question?</h2>
          <button
            type="button"
            className="question-why-close"
            aria-label="Close explanation"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <div className="question-why-body">
          <blockquote>{question}</blockquote>
          <section>
            <h3>The connection</h3>
            <p>{why.explanation}</p>
            <small>Preparation explanation · Not a prediction of the investor’s questions</small>
          </section>
          <section>
            <h3>A strong answer covers</h3>
            <p>{why.answerObjective}</p>
          </section>
          {why.missingInputs.length > 0 && (
            <section>
              <h3>Still needed</h3>
              <ul>
                {why.missingInputs.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {facts.length > 0 && (
            <section>
              <h3>Saved financial facts</h3>
              <div className="guided-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Metric / period</th>
                      <th>Saved value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.map((fact) => (
                      <tr key={fact.id}>
                        <td>
                          {fact.metric.replaceAll('_', ' ')}
                          <small>{fact.period}</small>
                        </td>
                        <td>
                          {fact.value}
                          <small>
                            {fact.unit === 'unspecified' ? 'Currency unconfirmed' : fact.unit}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section>
            <h3>Source snapshot</h3>
            {selected.length ? (
              selected.map((source) => (
                <details key={source.id}>
                  <summary>
                    {source.title}
                    <small>{source.label}</small>
                  </summary>
                  <p className="question-source-text">{source.text}</p>
                  {source.date && <small>{source.date}</small>}
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      Read source ↗
                    </a>
                  )}
                </details>
              ))
            ) : (
              <p>General clarification. No investor-specific priority is claimed.</p>
            )}
          </section>
        </div>
      </dialog>
    </div>
  );
}
