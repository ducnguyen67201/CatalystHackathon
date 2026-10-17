import { useEffect, useId, useRef, useState } from 'react';
import { FileSpreadsheet, Info, X } from 'lucide-react';
import type { QuestionWhy } from '../contracts/QuestionWhy.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';
import type { WhySource } from '../features/QuestionEvidence.js';
import { QuestionEvidenceSheet } from './QuestionEvidenceSheet.js';
import './GuidedPractice.css';

export { scenarioWhySources, evaluationWhySources } from '../features/QuestionEvidence.js';

/** Saved explanations and their actual source data stay visible beside each other. */
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
  const [sourceId, setSourceId] = useState('');
  const [rowKey, setRowKey] = useState('');
  const [pane, setPane] = useState<'explanation' | 'evidence'>('explanation');
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
  const rows = selected.flatMap((source) => source.financialRows);
  const preferred =
    rows.find((row) => facts.some((fact) => fact.sourceIds.includes(row.sourceId))) ??
    rows
      .filter((row) => row.role !== 'previous')
      .sort((a, b) => a.values.month.localeCompare(b.values.month))
      .at(-1) ??
    rows[0];
  const activeRow = rows.find((row) => row.key === rowKey) ?? preferred;
  const activeSource =
    selected.find((source) => source.id === sourceId) ??
    selected.find((source) => source.id === activeRow?.sourceId) ??
    selected[0];
  const nonfinancial = selected.filter(
    (source) => source.kind !== 'financial' || !source.financialRows.length,
  );
  const financialSelected = activeSource?.kind === 'financial' && !!rows.length;
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
        onClick={() => {
          setPane('explanation');
          setOpen(true);
        }}
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
          <div>
            <h2 id={titleId}>Why this question?</h2>
            <small>Explanation and saved evidence</small>
          </div>
          <button
            type="button"
            className="question-why-close"
            aria-label="Close explanation"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="question-why-mobile-switch" aria-label="Explanation view">
          <button
            type="button"
            aria-pressed={pane === 'explanation'}
            onClick={() => setPane('explanation')}
          >
            Explanation
          </button>
          <button
            type="button"
            aria-pressed={pane === 'evidence'}
            onClick={() => setPane('evidence')}
          >
            Source data
          </button>
        </nav>
        <div className="question-why-workspace" data-active-pane={pane}>
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
            <section>
              <h3>Supporting sources</h3>
              <p className="question-source-hint">Select a source to inspect its saved data.</p>
              <div className="question-source-list">
                {rows.length > 0 && (
                  <button
                    type="button"
                    className="question-source-button"
                    aria-pressed={financialSelected}
                    onClick={() => {
                      setSourceId(activeRow?.sourceId ?? rows[0]?.sourceId ?? '');
                      setPane('evidence');
                    }}
                  >
                    <FileSpreadsheet size={16} aria-hidden="true" />
                    <span>
                      Financial statement
                      <small>
                        {rows.length} saved {rows.length === 1 ? 'period' : 'periods'} ·{' '}
                        {selected.some(
                          (source) =>
                            source.kind === 'financial' && source.label === 'Fictional demo',
                        )
                          ? 'Fictional demo'
                          : 'Saved evidence'}
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                )}
                {nonfinancial.map((source) => (
                  <button
                    type="button"
                    key={source.id}
                    className="question-source-button"
                    aria-pressed={activeSource?.id === source.id}
                    onClick={() => {
                      setSourceId(source.id);
                      setPane('evidence');
                    }}
                  >
                    <span>
                      {source.title}
                      <small>{source.label}</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
                {!selected.length && (
                  <p>General clarification. No investor-specific priority is claimed.</p>
                )}
              </div>
            </section>
            {why.missingInputs.length > 0 && (
              <details className="question-missing-inputs">
                <summary>
                  Still needed · {why.missingInputs.length}{' '}
                  {why.missingInputs.length === 1 ? 'input' : 'inputs'}
                </summary>
                <ul>
                  {why.missingInputs.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <section className="question-evidence-pane" aria-label="Source data">
            <div className="question-evidence-heading">
              <h3>{financialSelected ? 'Financial evidence' : 'Source evidence'}</h3>
              <small>{activeSource?.label ?? 'No source selected'}</small>
            </div>
            {financialSelected && activeRow ? (
              <QuestionEvidenceSheet
                open={open}
                rows={rows}
                selectedKey={activeRow.key}
                facts={facts}
                onSelectPeriod={(key) => {
                  setRowKey(key);
                  const row = rows.find((item) => item.key === key);
                  if (row) setSourceId(row.sourceId);
                }}
              />
            ) : (
              <article className="question-readable-source">
                <h3>{activeSource?.title ?? 'No supporting source'}</h3>
                <p>
                  {activeSource?.text ??
                    'This is a general preparation question. No sourced investor priority is assumed.'}
                </p>
                {activeSource?.date && <small>{activeSource.date}</small>}
                {activeSource?.url && (
                  <a href={activeSource.url} target="_blank" rel="noreferrer">
                    Read original source ↗
                  </a>
                )}
              </article>
            )}
          </section>
        </div>
      </dialog>
    </div>
  );
}
