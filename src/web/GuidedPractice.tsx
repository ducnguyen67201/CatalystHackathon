import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, LoaderCircle, RotateCcw } from 'lucide-react';
import {
  guidedHistorySchema,
  guidedViewSchema,
  type GuidedView,
} from '../contracts/GuidedPractice.js';
import type { ScenarioSelection } from '../contracts/Scenario.js';
import { request } from './ApiClient.js';
import { QuestionExplanation, evaluationWhySources } from './QuestionExplanation.js';
import { EvaluationPanel } from './EvaluationPanel.js';
import { practiceAnswerFits } from '../features/PracticeInputBudget.js';
import type { TranscriptTurn } from '../contracts/Workspace.js';
import './GuidedPractice.css';

export function GuidedPractice({
  selection,
  ready,
  onLockChange,
}: {
  selection: ScenarioSelection;
  ready: boolean;
  onLockChange: (locked: boolean) => void;
}) {
  const [data, setData] = useState<GuidedView | null>(null);
  const [history, setHistory] = useState<{ id: string; status: string; createdAt: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [historyReload, setHistoryReload] = useState(0);
  const epoch = useRef(0);
  const startKey = useRef(crypto.randomUUID());
  const answerRequest = useRef<{
    questionId: string;
    text: string;
    expectedRevision: number;
    requestKey: string;
  } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const active = data?.status === 'active';
  const pending = !!data?.guided.pending;
  useEffect(() => {
    onLockChange(busy || active);
    return () => onLockChange(false);
  }, [busy, active, onLockChange]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void request(
      '/guided-practice/sessions?' + new URLSearchParams(selection).toString(),
      guidedHistorySchema,
      undefined,
      'GET',
    )
      .then((items) => {
        if (!alive) return;
        setHistory(items);
        setSelected((current) => current || items[0]?.id || '');
        setError('');
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setError('Could not load saved guided practice.');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [selection, historyReload]);
  useEffect(() => {
    const current = ++epoch.current;
    if (!selected) {
      setData(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.hidden) {
        timer = setTimeout(() => {
          void load();
        }, 3000);
        return;
      }
      try {
        const result = await request(
          '/guided-practice/sessions/' + encodeURIComponent(selected),
          guidedViewSchema,
          undefined,
          'GET',
        );
        if (epoch.current !== current) return;
        setData((previous) =>
          previous?.id === result.id && previous.guided.revision > result.guided.revision
            ? previous
            : result,
        );
        setError('');
        if (result.guided.pending && result.pendingStatus !== 'failed')
          timer = setTimeout(() => {
            void load();
          }, 1800);
      } catch {
        if (epoch.current === current) setError('Could not load this practice. Retry loading.');
      }
    };
    void load();
    return () => {
      epoch.current += 1;
      if (timer) clearTimeout(timer);
    };
  }, [selected, reload]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [data?.guided.revision]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const result = await request('/guided-practice/sessions', guidedViewSchema, {
        ...selection,
        requestKey: startKey.current,
      });
      setData(result);
      setSelected(result.id);
      setHistory((items) =>
        [
          { id: result.id, status: result.status, createdAt: result.createdAt },
          ...items.filter((item) => item.id !== result.id),
        ].slice(0, 20),
      );
      startKey.current = crypto.randomUUID();
      setDraft('');
      answerRequest.current = null;
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not start practice.');
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    const turn = data?.guided.turns.at(-1);
    if (!data || !turn || !draft.trim() || pending || busy) return;
    if (
      !answerRequest.current ||
      answerRequest.current.text !== draft.trim() ||
      answerRequest.current.questionId !== turn.id
    )
      answerRequest.current = {
        questionId: turn.id,
        text: draft.trim(),
        expectedRevision: data.guided.revision,
        requestKey: crypto.randomUUID(),
      };
    setBusy(true);
    setError('');
    const current = epoch.current;
    try {
      const result = await request(
        `/guided-practice/sessions/${data.id}/answers`,
        guidedViewSchema,
        answerRequest.current,
      );
      if (current !== epoch.current) return;
      setData(result);
      setDraft('');
      answerRequest.current = null;
      setReload((value) => value + 1);
    } catch (caught: unknown) {
      if (current === epoch.current)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not submit the answer. Retry to safely resubmit.',
        );
    } finally {
      setBusy(false);
    }
  }
  async function operate(action: 'retry' | 'finish') {
    if (!data) return;
    setBusy(true);
    setError('');
    const current = epoch.current;
    try {
      const result = await request(
        `/guided-practice/sessions/${data.id}/${action}`,
        guidedViewSchema,
        { expectedRevision: data.guided.revision },
      );
      if (current !== epoch.current) return;
      setData(result);
      setReload((value) => value + 1);
      setHistory((items) =>
        items.map((item) => (item.id === result.id ? { ...item, status: result.status } : item)),
      );
    } catch (caught: unknown) {
      if (current === epoch.current)
        setError(caught instanceof Error ? caught.message : 'Could not update this practice.');
    } finally {
      setBusy(false);
    }
  }
  const sources = data ? evaluationWhySources(data.context) : [];
  const savedTranscript: TranscriptTurn[] =
    data?.guided.turns.flatMap((turn) => {
      const answer = data.guided.answers.find((item) => item.questionId === turn.id);
      return [
        { role: 'agent' as const, text: `${turn.reply}\n\n${turn.question}` },
        ...(answer ? [{ role: 'user' as const, text: answer.text }] : []),
      ];
    }) ?? [];
  const fitsBudget =
    !data || practiceAnswerFits(data.id, data.context, savedTranscript, draft.trim());
  return (
    <section className="guided-practice" aria-label="Guided text practice">
      <header className="guided-toolbar">
        <div>
          <strong>Vicky · Guided practice</strong>
          <small>Questions adapt to your answers. Hover Why? for context.</small>
        </div>
        <div className="guided-toolbar-actions">
          {history.length > 0 && (
            <label>
              <span className="guided-sr-only">Saved guided sessions</span>
              <select
                value={selected}
                disabled={busy || active}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setDraft('');
                  answerRequest.current = null;
                }}
              >
                {history.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.createdAt).toLocaleString()} · {item.status}
                  </option>
                ))}
              </select>
            </label>
          )}
          {active && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                void operate('finish');
              }}
            >
              Finish & review
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="guided-error" role="alert">
          <p>{error}</p>
          <button
            className="text-button"
            onClick={() => {
              if (selected) setReload((value) => value + 1);
              else setHistoryReload((value) => value + 1);
            }}
          >
            Retry loading
          </button>
        </div>
      )}
      {!data && (
        <div className="guided-start">
          <div>
            <h3>Explain your business, one question at a time.</h3>
            <p>
              {ready
                ? 'Use your saved scenario and sources. Each new question comes with its own explanation.'
                : 'Guided practice needs the server’s OpenAI key. Saved sessions remain available.'}
            </p>
          </div>
          <button
            className="button"
            disabled={!ready || busy || loading}
            onClick={() => {
              void start();
            }}
          >
            {busy ? 'Starting…' : 'Start guided practice'}
          </button>
        </div>
      )}
      {data && (
        <>
          <div className="guided-context-line">
            <span>{data.context.investorName ?? 'General preparation'}</span>
            <span>
              {data.context.sources.some((source) => source.origin === 'fictional')
                ? 'Includes fictional demo evidence'
                : 'Saved evidence · Not independently verified'}
            </span>
            <span>Currency and unavailable metrics remain explicit.</span>
          </div>
          <div className="guided-conversation" aria-label="Practice conversation">
            {data.guided.turns.map((turn) => {
              const answer = data.guided.answers.find((item) => item.questionId === turn.id);
              return (
                <div className="guided-exchange" key={turn.id}>
                  <article className="guided-agent">
                    <div className="guided-speaker">
                      Vicky{' '}
                      {turn.sequence > 0 && (
                        <span className={'guided-decision ' + turn.decision}>
                          {turn.decision.replaceAll('_', ' ')}
                        </span>
                      )}
                    </div>
                    <p>{turn.reply}</p>
                    <div className="guided-question">
                      <h3>{turn.question}</h3>
                      <QuestionExplanation
                        key={turn.id}
                        question={turn.question}
                        why={turn.why}
                        sources={sources}
                        facts={data.context.facts.filter((fact) => turn.factIds.includes(fact.id))}
                      />
                    </div>
                  </article>
                  {answer && (
                    <article className="guided-founder">
                      <div className="guided-speaker">You</div>
                      <p>{answer.text}</p>
                    </article>
                  )}
                </div>
              );
            })}
            {pending && (
              <div className="guided-pending" role="status">
                {data.pendingStatus === 'failed' ? (
                  <>
                    <p>The next question could not be prepared. Your answer is saved.</p>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        void operate('retry');
                      }}
                    >
                      <RotateCcw size={14} /> Retry question
                    </button>
                  </>
                ) : (
                  <>
                    <LoaderCircle size={15} className="guided-spinner" /> Vicky is checking the
                    evidence and preparing the next question…
                  </>
                )}
              </div>
            )}
            <div ref={end} />
          </div>
          {active && !pending && (
            <form
              className="guided-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label htmlFor="guided-answer">Your answer</label>
              <div>
                <textarea
                  id="guided-answer"
                  ref={textarea}
                  value={draft}
                  maxLength={3000}
                  rows={2}
                  disabled={busy}
                  placeholder="Explain your thinking. It’s okay to say what you don’t know."
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="submit"
                  className="button"
                  disabled={
                    !draft.trim() || busy || !fitsBudget || data.guided.answers.length >= 24
                  }
                  aria-label="Send answer"
                >
                  <ArrowUp size={17} />
                </button>
              </div>
              <small>
                {data.guided.answers.length >= 24
                  ? 'Session limit reached. Finish to see your review.'
                  : !fitsBudget
                    ? 'This answer would exceed the session size limit. Shorten it or finish for review.'
                    : 'Your answer is checked against the same saved evidence. No new research runs.'}
              </small>
            </form>
          )}
          {!active && (
            <div className="guided-completed">
              <span>
                <Check size={15} /> Practice saved · Review below
              </span>
              <button
                className="button secondary"
                disabled={!ready || busy}
                onClick={() => {
                  void start();
                }}
              >
                Practise again
              </button>
            </div>
          )}
          {!active && (
            <EvaluationPanel
              key={data.id}
              sessionId={data.id}
              receipt={data.transcriptReceivedAt}
            />
          )}
        </>
      )}
    </section>
  );
}
