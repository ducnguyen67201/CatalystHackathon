import {
  preparedPitchContextSchema,
  type PreparedPitchContext,
} from '../contracts/ConnectedPreparation.js';
import { PracticeReviewTranscript } from './PracticeReviewTranscript.js';
import type { TranscriptTurn } from '../contracts/Workspace.js';
import './EvaluationPanel.css';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  evaluationResponseSchema,
  type EvaluationResponse,
} from '../contracts/RehearsalEvaluation.js';
import { command, request } from './ApiClient.js';
import { EvidenceReview } from './EvidenceReview.js';
import { PitchPreparationReport } from './PitchPreparationReport.js';
import type { EvidenceReview as EvidenceReviewData } from '../contracts/EvidenceReview.js';

/** Shared voice/video review. Child written attempts reuse this panel and the same evaluator. */
interface EvaluationPanelProps {
  sessionId: string;
  receipt: string | null;
  fallbackTurns?: TranscriptTurn[];
  transcriptFirst?: boolean;
}
export function EvaluationPanel(props: EvaluationPanelProps) {
  return <SelectedEvaluationPanel key={props.sessionId} {...props} />;
}

function SelectedEvaluationPanel({
  sessionId,
  receipt,
  fallbackTurns = [],
  transcriptFirst = false,
}: EvaluationPanelProps) {
  const [selectedEvaluationId, setSelectedEvaluationId] = useState<string | null>(null);
  const evidenceCache = useRef(new Map<string, EvidenceReviewData>());
  const [data, setData] = useState<EvaluationResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [childId, setChildId] = useState<string | null>(null);
  const requestKeys = useRef(new Map<string, string>());
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.hidden) {
        timer = setTimeout(() => {
          void load();
        }, 4000);
        return;
      }
      try {
        const result = await request(
          `/rehearsals/${encodeURIComponent(sessionId)}/evaluations`,
          evaluationResponseSchema,
          undefined,
          'GET',
        );
        if (cancelled) return;
        setData(result);
        setError('');
        const pending = result.evaluations.some(
          (e) =>
            e.status === 'queued' &&
            !result.jobs.some((j) => j.kind.endsWith(`:${e.id}`) && j.status === 'failed'),
        );
        if (pending || (!receipt && !result.evaluations.length))
          timer = setTimeout(() => {
            void load();
          }, 4000);
      } catch {
        if (!cancelled) setError('Could not load the coaching review. Retry loading.');
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, receipt, revision]);
  const evaluation =
    data?.evaluations.find((item) => item.id === selectedEvaluationId) ?? data?.evaluations.at(-1);
  const job = data?.jobs.find((j) => j.kind.endsWith(`:${evaluation?.id}`));
  let preparation: PreparedPitchContext | null = null;
  const preparationSource = data?.context?.sources.find(
    (source) => source.id === 'approved-preparation',
  );
  if (preparationSource) {
    try {
      const raw: unknown = JSON.parse(preparationSource.text);
      const parsed = preparedPitchContextSchema.safeParse(raw);
      if (parsed.success) preparation = parsed.data;
    } catch {
      /* Historical source text is not trusted as navigation metadata. */
    }
  }

  async function respond(itemId: string, kind: 'clarification' | 'practice' | 'dismissed') {
    if (!evaluation) return;
    setBusy(true);
    setError('');
    const actionKey = JSON.stringify([
      evaluation.id,
      itemId,
      kind,
      drafts[`${evaluation.id}:${itemId}`] ?? '',
    ]);
    const requestKey = requestKeys.current.get(actionKey) ?? crypto.randomUUID();
    requestKeys.current.set(actionKey, requestKey);
    try {
      const result = await request(
        `/rehearsals/${sessionId}/evaluations/${evaluation.id}/responses`,
        z.object({ id: z.string() }),
        { itemId, kind, text: drafts[`${evaluation.id}:${itemId}`] ?? '', requestKey },
      );
      if (kind === 'practice') setChildId(result.id);
      if (kind === 'clarification') setSelectedEvaluationId(null);
      refresh();
    } catch {
      setError('Could not save your response. Your draft is still here.');
    } finally {
      setBusy(false);
    }
  }
  const renderCoaching = (claimId: string) =>
    evaluation?.report?.coaching.items
      .filter(
        (item) =>
          item.claimId === claimId &&
          !data?.responses.some(
            (r) =>
              r.evaluationId === evaluation.id && r.itemId === item.id && r.kind === 'dismissed',
          ),
      )
      .map((item) => {
        const claim = evaluation.report?.extraction.claims.find((c) => c.id === item.claimId);
        const check = evaluation.report?.checks.find((c) => c.claimId === item.claimId);
        return (
          <article className="evaluation-card" key={item.id}>
            <h4>Strengthen this answer</h4>
            <p className="muted">
              {check?.support === 'contradicted'
                ? 'Conflicts with selected evidence'
                : check?.support.replaceAll('_', ' ')}{' '}
              · {item.relevance.replaceAll('_', ' ')}
            </p>
            <h4>What it establishes</h4>
            <p>{item.establishes}</p>
            <h4>What would strengthen your answer</h4>
            <p>{item.gap}</p>
            <p>{item.suggestion}</p>
            {item.missingInputs.length > 0 && (
              <p>Missing evidence: {item.missingInputs.join('; ')}</p>
            )}
            <blockquote>{item.exampleAnswer}</blockquote>
            <details>
              <summary>View supporting evidence</summary>
              {evaluation.turns
                .filter((t) => t.id === claim?.turnId || t.id === claim?.questionTurnId)
                .map((t) => (
                  <p key={t.id}>
                    <strong>{t.role === 'user' ? 'Founder' : 'Interviewer'}:</strong> {t.text}
                  </p>
                ))}
              {data?.context?.facts
                .filter((f) => item.factIds.includes(f.id))
                .map((f) => (
                  <p key={f.id}>
                    {f.metric}: {f.value} {f.unit}, {f.period}. {f.calculation}
                  </p>
                ))}
              {data?.context?.sources
                .filter((s) => item.sourceIds.includes(s.id))
                .map((s) => (
                  <div key={s.id}>
                    <p>
                      <strong>{s.title}</strong> ({s.origin})
                    </p>
                    <p>{s.text}</p>
                    {s.url && /^https?:/.test(s.url) && (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        Open source
                      </a>
                    )}
                  </div>
                ))}
            </details>
            <p>{item.clarificationQuestion}</p>
            <p>
              <strong>Practise:</strong> {item.practiceQuestion}
            </p>
            <ul>
              {item.successCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
            <label>
              Your explanation or new answer
              <textarea
                maxLength={3000}
                value={drafts[`${evaluation.id}:${item.id}`] ?? ''}
                onChange={(event) =>
                  setDrafts((values) => ({
                    ...values,
                    [`${evaluation.id}:${item.id}`]: event.target.value,
                  }))
                }
              />
            </label>
            <div className="actions">
              <button
                className="button secondary"
                disabled={busy || !(drafts[`${evaluation.id}:${item.id}`] ?? '').trim()}
                onClick={() => void respond(item.id, 'clarification')}
              >
                Explain my reasoning
              </button>
              <button
                className="button"
                disabled={busy || !(drafts[`${evaluation.id}:${item.id}`] ?? '').trim()}
                onClick={() => void respond(item.id, 'practice')}
              >
                Evaluate this practice answer
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void respond(item.id, 'dismissed')}
              >
                Dismiss suggestion
              </button>
            </div>
          </article>
        );
      });
  return (
    <section className="panel evaluation-panel" aria-label="Post-practice coaching">
      {!evaluation?.report && <h3>Post-practice coaching</h3>}
      {data && data.evaluations.length > 1 && (
        <label>
          Review version
          <select
            disabled={busy}
            value={evaluation?.id ?? ''}
            onChange={(event) => setSelectedEvaluationId(event.target.value)}
          >
            {data.evaluations.map((item, index) => (
              <option key={item.id} value={item.id}>
                Review {index + 1} · {item.status} · {new Date(item.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="button secondary" onClick={refresh}>
            Reload review
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Loading review…</p>}
      {data && !evaluation && (
        <p>
          No evaluation yet. New sessions are reviewed after their final transcript arrives; older
          sessions are not assessed against today's data.
        </p>
      )}
      {transcriptFirst && !evaluation?.report && (
        <PracticeReviewTranscript
          sessionId={sessionId}
          turns={fallbackTurns.map((turn, index) => ({
            ...turn,
            id: `${sessionId}:saved:${index}`,
          }))}
          report={null}
        />
      )}
      {evaluation && (
        <>
          <p className="muted">
            {evaluation.legacyDemo
              ? 'Historical fictional report'
              : 'AI coaching • check the supporting evidence'}{' '}
            · {evaluation.scope.replaceAll('_', ' ')}
          </p>
          {evaluation.status === 'queued' && (
            <p role="status">
              {job?.status === 'failed'
                ? 'Review could not finish. Your transcript is saved.'
                : job?.status === 'running'
                  ? 'Reviewing your answer and evidence…'
                  : 'Review queued…'}
            </p>
          )}
          {job?.status === 'failed' && evaluation.status === 'queued' && (
            <button
              disabled={busy}
              className="button secondary"
              onClick={() => {
                setBusy(true);
                void command(`/rehearsals/${sessionId}/evaluations/${evaluation.id}/retry`, {
                  generation: evaluation.generation,
                })
                  .then(refresh)
                  .catch(() => setError('Could not retry the review.'))
                  .finally(() => setBusy(false));
              }}
            >
              Retry review
            </button>
          )}
          {evaluation.reason && <p>{evaluation.reason}</p>}
          {evaluation.report && (
            <>
              {transcriptFirst && (
                <PracticeReviewTranscript
                  sessionId={sessionId}
                  key={evaluation.id}
                  turns={evaluation.turns}
                  report={evaluation.report}
                />
              )}
              <PitchPreparationReport
                evaluation={evaluation}
                fictional={
                  evaluation.legacyDemo ||
                  (data?.context?.sources.some((source) => source.origin === 'fictional') ?? false)
                }
              />
              {preparation && (
                <a
                  className="button"
                  href={`/?preparationStep=feedback&preparationCycleId=${encodeURIComponent(preparation.cycleId)}`}
                >
                  Continue this preparation cycle →
                </a>
              )}
              <a className="button secondary" href="/?followups">
                View your follow-ups
              </a>
              {evaluation.report.coaching.comparison && (
                <p>
                  <strong>
                    {evaluation.report.coaching.comparison.outcome === 'not_comparable'
                      ? 'Comparison unavailable'
                      : evaluation.report.coaching.comparison.outcome.replaceAll('_', ' ')}
                    :
                  </strong>{' '}
                  {evaluation.report.coaching.comparison.explanation}
                </p>
              )}
              <details className="report-detailed-review">
                <summary>Explore answers, evidence and practice suggestions</summary>
                <EvidenceReview
                  key={`${sessionId}:${evaluation.id}`}
                  sessionId={sessionId}
                  evaluation={evaluation}
                  context={data?.context ?? null}
                  cache={evidenceCache.current}
                  renderCoaching={renderCoaching}
                />
              </details>
            </>
          )}
        </>
      )}
      {data && (
        <details>
          <summary>Review context and history</summary>
          <p>{data.context?.scenario}</p>
          {data.context?.limitations.map((limit) => (
            <p key={limit}>{limit}</p>
          ))}
          <p>{data.evaluations.length} saved review version(s).</p>
          {data.evaluations
            .filter((item) => item.id !== evaluation?.id)
            .map((old) => (
              <details key={old.id}>
                <summary>Earlier review · {old.createdAt}</summary>
                <p>{old.report?.coaching.summary ?? old.reason ?? old.status}</p>
                {old.report?.coaching.items.map((item) => (
                  <p key={item.id}>
                    {item.gap} {item.suggestion}
                  </p>
                ))}
              </details>
            ))}
          {data.responses.map((response) => (
            <p key={response.id}>
              {response.kind}: {response.text}
              {response.kind === 'practice' && (
                <button className="button secondary" onClick={() => setChildId(response.id)}>
                  Open written retry
                </button>
              )}
            </p>
          ))}
        </details>
      )}
      {childId && <EvaluationPanel key={childId} sessionId={childId} receipt="written" />}
    </section>
  );
}
