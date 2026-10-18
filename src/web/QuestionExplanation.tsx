import { useEffect, useId, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  Info,
  X,
  MessageCircle,
  Lightbulb,
  Target,
  FileText,
  ArrowRight,
} from 'lucide-react';
import type { QuestionWhy } from '../contracts/QuestionWhy.js';
import type { EvaluationContext } from '../contracts/RehearsalEvaluation.js';
import type { WhySource } from '../features/QuestionEvidence.js';
import { QuestionEvidenceSheet, formatEvidenceAmount } from './QuestionEvidenceSheet.js';
import { QuestionSourceCard } from './QuestionSourceCard.js';
import './GuidedPractice.css';
import './QuestionExplanation.css';

export { scenarioWhySources, evaluationWhySources } from '../features/QuestionEvidence.js';

/** Saved explanations and their actual source data stay visible beside each other. */
export function QuestionExplanation({
  question,
  why,
  sources,
  facts = [],
  onOpenChange,
}: {
  question: string;
  why: QuestionWhy;
  sources: WhySource[];
  facts?: EvaluationContext['facts'];
  onOpenChange?: ((open: boolean) => void) | undefined;
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
    onOpenChange?.(false);
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
  const includesFictional = sources.some(
    (source) =>
      source.label === 'Fictional demo' ||
      source.preparation?.fictional ||
      source.preparation?.sources.some((item) => item.fictional),
  );
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
          onOpenChange?.(true);
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
        onClose={() => {
          if (open) close();
        }}
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
            <small>
              {onOpenChange
                ? 'Conversation paused while you read · Close to resume'
                : 'Explanation and saved evidence'}
            </small>
            {includesFictional && (
              <span className="why-fictional-notice">Includes fictional demo evidence</span>
            )}
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
            <div className="why-question-card">
              <span className="why-kicker">
                <MessageCircle size={15} aria-hidden="true" /> The question
              </span>
              <blockquote>{question}</blockquote>
            </div>
            <div className="why-connection-path" aria-hidden="true">
              <span /> <ArrowRight size={15} /> <span>Connect it to your story</span>
            </div>
            <section className="why-explanation-card">
              <h3>
                <Lightbulb size={17} aria-hidden="true" /> Why June is asking
              </h3>
              <strong>{why.brief}</strong>
              <p>{why.explanation}</p>
            </section>
            <section className="why-answer-card">
              <h3>
                <Target size={17} aria-hidden="true" /> What to cover
              </h3>
              <ol>
                {why.answerObjective
                  .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
                  .filter(Boolean)
                  .map((point, index) => (
                    <li key={index}>
                      <span aria-hidden="true">{index + 1}</span>
                      <p>{point}</p>
                    </li>
                  ))}
              </ol>
            </section>
            <section className="why-sources-section">
              <h3>
                <FileText size={16} aria-hidden="true" /> Supporting sources{' '}
                <span className="why-source-count">{selected.length}</span>
              </h3>
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
                    <FileText size={17} aria-hidden="true" />
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
            <p className="why-preparation-note">
              Preparation guidance · Investor questions may differ.
            </p>
          </div>
          <section className="question-evidence-pane" aria-label="Source data">
            <div className="question-evidence-heading">
              <h3>
                <FileText size={16} aria-hidden="true" />{' '}
                {financialSelected ? 'Financial evidence' : 'Behind your answer'}
              </h3>
              <small>{activeSource?.label ?? 'No source selected'}</small>
            </div>
            {financialSelected && activeRow ? (
              <>
                <div className="why-financial-overview">
                  <p>
                    {activeRow.values.month} ·{' '}
                    {activeRow.currency === 'unspecified'
                      ? 'Currency unconfirmed'
                      : activeRow.currency}
                  </p>
                  <dl>
                    {[
                      { label: 'Operating income', value: activeRow.values.operatingIncome },
                      { label: 'Other income / credit', value: activeRow.values.credit },
                      { label: 'Net income', value: activeRow.values.netIncome },
                    ].map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd className={item.value.startsWith('-') ? 'why-negative-value' : ''}>
                          {formatEvidenceAmount(item.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <details className="why-statement-disclosure">
                  <summary>Inspect statement & exact cells</summary>
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
                </details>
              </>
            ) : (
              <QuestionSourceCard source={activeSource} />
            )}
          </section>
        </div>
      </dialog>
    </div>
  );
}
