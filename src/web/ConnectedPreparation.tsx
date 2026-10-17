import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ArrowRight, Check, Circle } from 'lucide-react';
import type { StateResponse } from '../contracts/Workspace.js';
import {
  connectedPreparationViewSchema,
  type ConnectedPreparationView,
  type ConnectedPreparationCommand,
} from '../contracts/ConnectedPreparation.js';
import {
  scenarioPreviewSchema,
  generationSchema,
  type ScenarioPreview,
} from '../contracts/Scenario.js';
import { request, command } from './ApiClient.js';
import { EvaluationPanel } from './EvaluationPanel.js';
import { ScenarioSourcesView } from './ScenarioSourcesView.js';
import './ConnectedPreparation.css';

type WithoutRequest<T> = T extends object ? Omit<T, 'version' | 'key'> : never;
type Panel = 'story' | 'investor' | 'brief' | 'practice' | 'feedback' | 'revision' | 'history';
const labels = {
  blocked: 'Blocked',
  ready: 'Ready',
  running: 'In progress',
  needs_review: 'Needs review',
  complete: 'Complete',
  failed: 'Needs retry',
  outdated: 'Sources changed',
};
export function InvestorPreparationRecommendations({
  view,
  onSelect,
  disabled = false,
}: {
  view: ConnectedPreparationView;
  onSelect?: (investorId: string) => void;
  disabled?: boolean;
}) {
  return (
    <section className="loop-recommendations" aria-label="Recommended investors">
      <div className="loop-section-heading">
        <h3>Investors to review for your next conversation</h3>
        <span className="muted">Saved research · no funding score</span>
      </div>
      {!view.recommendations.length ? (
        <p>
          No saved candidates yet. Add or discover investors in{' '}
          <a href="/?page=investors">Investor research</a>.
        </p>
      ) : (
        <div className="loop-comparison-scroll">
          <table className="loop-comparison">
            <thead>
              <tr>
                <th>Investor / recommendation</th>
                <th>Why review this investor?</th>
                <th>Tradeoffs & unknowns</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {view.recommendations.map((candidate) => (
                <tr key={candidate.investorId ?? candidate.suggestionId}>
                  <td>
                    <strong>{candidate.name}</strong>
                    <span
                      className={`loop-tag ${candidate.label === 'Recommended to review' ? 'is-recommended' : ''}`}
                    >
                      {candidate.label}
                    </span>
                    <small>
                      {candidate.stage ?? 'Stage unknown'} · {candidate.sector ?? 'Sector unknown'}{' '}
                      · {candidate.geography ?? 'Geography unknown'}
                    </small>
                  </td>
                  <td>
                    {candidate.reasons.length ? (
                      <ul>
                        {candidate.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      'No supported alignment has been established.'
                    )}
                    <details>
                      <summary>Sources ({candidate.sources.length})</summary>
                      {candidate.sources.map((source) => (
                        <blockquote key={source.id}>
                          <strong>
                            {source.fictional ? 'Fictional demo evidence · ' : ''}
                            {source.title}
                          </strong>
                          <p>{source.excerpt}</p>
                          <small>Recorded: {source.recordedAt ?? 'Unknown'}</small>
                          {source.url && (
                            <p>
                              <a href={source.url} target="_blank" rel="noreferrer">
                                Read original source
                              </a>
                            </p>
                          )}
                        </blockquote>
                      ))}
                    </details>
                  </td>
                  <td>
                    <ul>
                      {candidate.unknowns.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    {candidate.investorId && onSelect ? (
                      <button
                        className="button"
                        disabled={disabled}
                        onClick={() => {
                          if (candidate.investorId) onSelect(candidate.investorId);
                        }}
                      >
                        Prepare for this investor <ArrowRight size={14} />
                      </button>
                    ) : (
                      <a
                        href={`/?page=investors${candidate.investorId ? '&investor=' + encodeURIComponent(candidate.investorId) : ''}`}
                      >
                        {candidate.investorId
                          ? 'Inspect investor'
                          : 'Review suggestion & track explicitly'}{' '}
                        ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="loop-method">
        These compare saved observations, which may describe historical deals. Current mandate,
        individual check size and application routes need confirmation. Round totals are not
        investor checks.
      </p>
    </section>
  );
}
export function ConnectedPreparation({
  state,
  onChange,
}: {
  state: StateResponse;
  onChange: () => void;
}) {
  const [view, setView] = useState<ConnectedPreparationView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [preview, setPreview] = useState<ScenarioPreview | null>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const keys = useRef(new Map<string, string>());
  const deepLinkHandled = useRef(false);
  const keyFor = (value: unknown) => {
    const identity = JSON.stringify(value);
    let key = keys.current.get(identity);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(identity, key);
    }
    return key;
  };
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!document.hidden) {
        try {
          const result = await request(
            '/preparation-loop',
            connectedPreparationViewSchema,
            undefined,
            'GET',
          );
          if (!cancelled) setView(result);
        } catch (caught) {
          if (!cancelled)
            setError(
              caught instanceof Error ? caught.message : 'Cannot load preparation checklist.',
            );
        }
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void load();
        }, 3000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.workspace.revision, reload]);
  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
  }, [panel]);
  useEffect(() => {
    if (panel === 'revision') setText(view?.cycle?.proposal?.text ?? view?.pitch?.text ?? '');
  }, [panel, view?.cycle?.id, view?.cycle?.proposal?.evaluationId]);
  useEffect(() => {
    if (!view || deepLinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('preparationStep');
    const panels: Panel[] = [
      'story',
      'investor',
      'brief',
      'practice',
      'feedback',
      'revision',
      'history',
    ];
    const target = panels.find((value) => value === requested);
    if (!target) return;
    deepLinkHandled.current = true;
    const cycleId = params.get('preparationCycleId');
    const next = cycleId && cycleId !== view.cycle?.id ? 'history' : target;
    trigger.current = null;
    setText(
      next === 'revision'
        ? (view.cycle?.proposal?.text ?? view.pitch?.text ?? '')
        : (view.pitch?.text ?? ''),
    );
    setPanel(next);
  }, [view]);
  function close() {
    dialog.current?.close();
    setPanel(null);
    setPreview(null);
    trigger.current?.focus();
  }
  function open(next: Panel) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next);
    setPreview(null);
    setError('');
    setText(
      next === 'revision'
        ? (view?.cycle?.proposal?.text ?? view?.pitch?.text ?? '')
        : (view?.pitch?.text ?? ''),
    );
  }
  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await operation();
      const result = await request(
        '/preparation-loop',
        connectedPreparationViewSchema,
        undefined,
        'GET',
      );
      setView(result);
      setReload((n) => n + 1);
      onChange();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not continue preparation.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function act(input: WithoutRequest<ConnectedPreparationCommand>) {
    if (!view) return false;
    const body = { ...input, version: view.version };
    return run(() => command('/preparation-loop/commands', { ...body, key: keyFor(body) }));
  }
  async function action(next: Panel) {
    if (!view) return;
    if (!view.cycle) {
      if (await act({ action: 'start' })) setReload((n) => n + 1);
      return;
    }
    open(next);
  }
  if (!view) return <p role="status">{error || 'Loading connected preparation…'}</p>;
  const cycle = view.cycle;
  const currentScenario =
    view.generation?.scenarios.find((s) => s.id === scenarioId) ?? view.generation?.scenarios[0];
  const currentStep = view.steps.find((s) => s.status !== 'complete' && s.status !== 'blocked');
  const nextPanel: Panel = currentStep?.id ?? 'history';
  const changedText = text.trim() !== (view.pitch?.text ?? '');
  return (
    <section className="connected-preparation" aria-label="Six-step preparation loop">
      <div className="loop-section-heading">
        <div>
          <span className="eyebrow">One connected preparation loop</span>
          <h3>Review → prepare → practise → improve</h3>
        </div>
        <span className="loop-tag">
          {view.completedCycles} reviewed cycle{view.completedCycles === 1 ? '' : 's'}
        </span>
      </div>
      <p className="loop-method">
        Complete each saved step. The next workflow becomes available automatically; approvals and
        session starts stay in your control.
      </p>
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setReload((n) => n + 1)}>
            Refresh
          </button>
        </p>
      )}
      {!cycle ? (
        <div className="prep-next">
          <div>
            <h3>Start your six-step preparation checklist</h3>
            <p>
              Use the confirmed goal and selected statement to prepare a sourced financial story.
            </p>
          </div>
          <button
            className="button"
            disabled={busy || !view.goalId}
            onClick={() => void action('story')}
          >
            Prepare my checklist <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="loop-position">
            <span>
              <strong>Current story · v{view.pitch?.revision}</strong>{' '}
              {view.pitch?.createdAt ? new Date(view.pitch.createdAt).toLocaleString() : ''}
            </span>
            <span>
              {view.pitch?.fictional ? 'Fictional demo evidence · ' : ''}Cycle {view.cycleNumber} ·{' '}
              {view.steps.filter((s) => s.status === 'complete').length} / 6 steps
            </span>
          </div>
          {view.outdated && (
            <div className="loop-warning">
              <strong>Saved inputs changed.</strong> Previous drafts and sessions stay in history.
              Refresh before accepting or practising.
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act({ action: 'refresh' })}
              >
                Review current sources & refresh
              </button>
            </div>
          )}
          <ol className="loop-checklist">
            {view.steps.map((step, index) => (
              <li key={step.id} data-status={step.status}>
                <span className="loop-check">
                  {step.status === 'complete' ? <Check size={15} /> : <Circle size={15} />}
                </span>
                <div>
                  <button
                    className="loop-step-button"
                    disabled={busy || view.outdated || step.status === 'blocked'}
                    onClick={() => open(step.id)}
                  >
                    {index + 1}. {step.title}
                  </button>
                  <small>{step.detail}</small>
                  <small className="loop-handoff">Next workflow: {step.workflow}</small>
                </div>
                <span className="loop-tag">{labels[step.status]}</span>
              </li>
            ))}
          </ol>
          {!view.outdated && (
            <div className="prep-next">
              <div>
                <span className="eyebrow">Recommended next action</span>
                <h3>
                  {cycle.closedAt
                    ? 'Cycle reviewed. Watch for new evidence or practise again.'
                    : (currentStep?.title ?? 'Continue your saved preparation.')}
                </h3>
                <p className="loop-method">
                  {cycle.outcome === 'rejected'
                    ? 'You kept the previous pitch. The unresolved feedback remains in the saved report.'
                    : view.paused
                      ? 'Automatic proposal drafting is paused. Explicit review still prepares the next action.'
                      : 'June prepares revision proposals from completed saved feedback; unchanged inputs do not create more work.'}
                </p>
              </div>
              <div className="prep-buttons">
                {cycle.closedAt ? (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void act({ action: 'repeat' })}
                  >
                    Start next practice cycle
                  </button>
                ) : (
                  <button className="button" disabled={busy} onClick={() => open(nextPanel)}>
                    Continue <ArrowRight size={14} />
                  </button>
                )}
                <button className="text-button" onClick={() => open('history')}>
                  Cycle history ↗
                </button>
              </div>
            </div>
          )}
          {!cycle.investorId && (
            <InvestorPreparationRecommendations
              view={view}
              disabled={busy || !cycle.pitchApprovedAt || view.outdated}
              onSelect={(investorId) => {
                void act({ action: 'select_investor', investorId }).then((ok) => {
                  if (ok) open('brief');
                });
              }}
            />
          )}
        </>
      )}
      {panel && (
        <dialog
          ref={dialog}
          className="loop-dialog"
          aria-labelledby="loop-panel-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="loop-dialog-heading">
            <div>
              <div className="eyebrow">Preparation checklist · {panel}</div>
              <h2 id="loop-panel-title">
                {panel === 'history'
                  ? 'Saved preparation cycles'
                  : view.steps.find((step) => step.id === panel)?.title}
              </h2>
            </div>
            <button className="button secondary" onClick={close}>
              Close
            </button>
          </div>
          <div className="loop-dialog-body">
            {error && <p role="alert">{error}</p>}
            {view.outdated && (
              <p className="loop-warning">
                Sources changed. Close this panel and refresh the preparation checklist before
                saving.
              </p>
            )}
            {view.pitch?.fictional && <p className="loop-tag">Fictional demo evidence</p>}
            {panel === 'story' && (
              <>
                <label className="loop-label" htmlFor="loop-pitch">
                  Financial story · editable revision
                </label>
                <textarea
                  id="loop-pitch"
                  value={text}
                  maxLength={3000}
                  onChange={(event) => setText(event.target.value)}
                />
                <p>{view.pitch?.reason}</p>
                <p className="loop-method">
                  Save creates an immutable revision. Approval means founder review, not independent
                  verification of edited figures or claims.
                </p>
                <details>
                  <summary>Exact sources</summary>
                  {view.pitch?.sources.map((source) => (
                    <blockquote key={source.id}>
                      <strong>{source.title}</strong>
                      <pre>{source.excerpt}</pre>
                    </blockquote>
                  ))}
                </details>
                <div className="prep-buttons">
                  <button
                    className="button secondary"
                    disabled={busy || view.outdated || !text.trim() || !changedText}
                    onClick={() => void act({ action: 'save_pitch', text: text.trim() })}
                  >
                    Save revision
                  </button>
                  <button
                    className="button"
                    disabled={busy || view.outdated || changedText}
                    onClick={() =>
                      void act({ action: 'approve_pitch' }).then((ok) => {
                        if (ok) setPanel(cycle?.investorId ? 'brief' : 'investor');
                      })
                    }
                  >
                    Approve saved story & continue
                  </button>
                </div>
                {changedText && (
                  <p className="loop-method">Save your edited text before approving it.</p>
                )}
              </>
            )}
            {panel === 'investor' && (
              <InvestorPreparationRecommendations
                view={view}
                disabled={busy || view.outdated || !cycle?.pitchApprovedAt}
                onSelect={(investorId) => {
                  void act({ action: 'select_investor', investorId }).then((ok) => {
                    if (ok) setPanel('brief');
                  });
                }}
              />
            )}
            {panel === 'brief' && (
              <>
                <p className="loop-prose">
                  {cycle?.brief ?? 'Select a saved investor to prepare a tailored brief.'}
                </p>
                <p className="loop-method">
                  The brief preserves this exact story and investor source set. A new story or new
                  research requires a fresh review.
                </p>
                <div className="prep-buttons">
                  <button className="button secondary" onClick={() => setPanel('investor')}>
                    Compare alternatives
                  </button>
                  <button
                    className="button"
                    disabled={busy || view.outdated || !cycle?.brief || !cycle.pitchApprovedAt}
                    onClick={() =>
                      void act({ action: 'approve_brief' }).then((ok) => {
                        if (ok) setPanel('practice');
                      })
                    }
                  >
                    Approve brief & review scenario sources
                  </button>
                </div>
              </>
            )}
            {panel === 'practice' && (
              <>
                <p>
                  The saved scenario carries your approved story, investor brief and evidence into
                  both the interviewer and evaluator.
                </p>
                {!view.generation && (
                  <button
                    className="button"
                    disabled={busy || view.outdated || !cycle?.briefApprovedAt}
                    onClick={() =>
                      void run(async () => {
                        const result = await request(
                          '/preparation-loop/scenario-preview',
                          scenarioPreviewSchema,
                          { cycleId: cycle?.id },
                        );
                        setPreview(result);
                      })
                    }
                  >
                    Review generation sources
                  </button>
                )}
                {preview && (
                  <div className="loop-source-review">
                    <h3>Review exact input before generation</h3>
                    <p className="loop-method">
                      {preview.mode === 'demo'
                        ? 'Fictional template generator'
                        : 'Live model generation'}{' '}
                      · {preview.model}
                    </p>
                    <h4>Approved financial story</h4>
                    <p className="loop-prose">{preview.input.preparation?.pitch}</p>
                    <details>
                      <summary>Approved investor brief</summary>
                      <p className="loop-prose">{preview.input.preparation?.brief}</p>
                    </details>
                    <details>
                      <summary>Included evidence & missing inputs</summary>
                      <ScenarioSourcesView input={preview.input} />
                    </details>
                    <button
                      className="button"
                      disabled={busy || view.outdated}
                      onClick={() =>
                        void run(async () => {
                          await request('/preparation-loop/scenarios', generationSchema, {
                            cycleId: cycle?.id,
                            expectedInputHash: preview.inputHash,
                            key: keyFor({
                              cycleId: cycle?.id,
                              expectedInputHash: preview.inputHash,
                              generationVersion: view.version,
                            }),
                          });
                          setPreview(null);
                        })
                      }
                    >
                      Generate reviewed scenario
                    </button>
                  </div>
                )}
                {view.generation && (
                  <>
                    <p role="status">Scenario generation: {view.generation.status}</p>
                    {view.generation.error && <p role="alert">{view.generation.error}</p>}
                    {view.generation.status === 'failed' && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            command('/preparation-loop/scenario-retry', {
                              cycleId: cycle?.id,
                              generationId: view.generation?.id,
                            }),
                          )
                        }
                      >
                        Retry generation after source review
                      </button>
                    )}
                    {view.generation.status === 'succeeded' && (
                      <>
                        <label className="loop-label" htmlFor="loop-scenario">
                          Saved scenario
                        </label>
                        <select
                          id="loop-scenario"
                          value={currentScenario?.id ?? ''}
                          onChange={(event) => setScenarioId(event.target.value)}
                        >
                          {view.generation.scenarios.map((scenario) => (
                            <option key={scenario.id} value={scenario.id}>
                              {scenario.title}
                            </option>
                          ))}
                        </select>
                        <p>{currentScenario?.objective}</p>
                        <a
                          className="button secondary"
                          href={`/practice?generationId=${encodeURIComponent(view.generation.id)}&scenarioId=${encodeURIComponent(currentScenario?.id ?? '')}`}
                        >
                          Open voice / video practice room ↗
                        </a>
                        {(!view.latestSession || view.latestSession.status === 'unavailable') && (
                          <>
                            <label className="loop-label" htmlFor="loop-answer">
                              Or complete the same exercise in writing
                            </label>
                            <textarea
                              id="loop-answer"
                              value={answer}
                              maxLength={3000}
                              onChange={(event) => setAnswer(event.target.value)}
                            />
                            <button
                              className="button"
                              disabled={busy || view.outdated || !answer.trim() || !currentScenario}
                              onClick={() =>
                                void run(async () => {
                                  await request(
                                    '/preparation-loop/rehearsals',
                                    z.strictObject({ id: z.uuid() }),
                                    {
                                      cycleId: cycle?.id,
                                      scenarioId: currentScenario?.id,
                                      answer: answer.trim(),
                                      key: keyFor({
                                        cycleId: cycle?.id,
                                        scenarioId: currentScenario?.id,
                                        answer: answer.trim(),
                                      }),
                                    },
                                  );
                                  setAnswer('');
                                  setPanel('feedback');
                                })
                              }
                            >
                              Submit answer & queue review
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                {view.latestSession && (
                  <div className="prep-buttons">
                    <span>Saved practice: {view.latestSession.status.replaceAll('_', ' ')}</span>
                    <button className="button" onClick={() => setPanel('feedback')}>
                      Open assessment
                    </button>
                  </div>
                )}
              </>
            )}
            {panel === 'feedback' && (
              <>
                {view.latestSession ? (
                  <>
                    <p role="status">
                      {view.latestSession.summary ??
                        `Assessment status: ${view.latestSession.status.replaceAll('_', ' ')}`}
                    </p>
                    <EvaluationPanel sessionId={view.latestSession.id} receipt="written" />
                    <button
                      className="button"
                      disabled={
                        busy ||
                        view.outdated ||
                        view.latestSession.status !== 'ready' ||
                        !view.latestSession.evaluationId
                      }
                      onClick={() => {
                        const review = view.latestSession;
                        if (review?.evaluationId)
                          void act({
                            action: 'review_feedback',
                            sessionId: review.id,
                            evaluationId: review.evaluationId,
                          }).then((ok) => {
                            if (ok) {
                              setText(view.cycle?.proposal?.text ?? view.pitch?.text ?? '');
                              setPanel('revision');
                            }
                          });
                      }}
                    >
                      I reviewed this assessment · continue
                    </button>
                  </>
                ) : (
                  <p>Complete the scenario practice before reviewing an assessment.</p>
                )}
              </>
            )}
            {panel === 'revision' && (
              <>
                {cycle?.proposal ? (
                  <>
                    <h3>Proposed revision</h3>
                    <details>
                      <summary>Previous version</summary>
                      <p>{view.pitch?.text}</p>
                    </details>
                    <ul>
                      {cycle.proposal.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <label className="loop-label" htmlFor="loop-revision">
                      Proposed wording · founder review required
                    </label>
                    <textarea
                      id="loop-revision"
                      value={text}
                      maxLength={3000}
                      onChange={(event) => setText(event.target.value)}
                    />
                    <p className="loop-method">
                      This uses the saved coach’s example answer. It has not been independently
                      certified as financially correct. Inspect the linked report and sources; keep
                      unknowns explicit.
                    </p>
                    <div className="prep-buttons">
                      <button
                        className="button secondary"
                        disabled={busy || view.outdated}
                        onClick={() =>
                          void act({ action: 'reject_revision' }).then((ok) => {
                            if (ok) close();
                          })
                        }
                      >
                        Keep current pitch · record decision
                      </button>
                      <button
                        className="button"
                        disabled={busy || view.outdated || !text.trim() || !changedText}
                        onClick={() =>
                          void act({ action: 'accept_revision', text: text.trim() }).then((ok) => {
                            if (ok) {
                              setPanel('brief');
                              setText('');
                            }
                          })
                        }
                      >
                        Approve revision & prepare next brief
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>No new actionable wording was proposed.</h3>
                    <p>
                      Review the completed assessment before finishing. Preparation completion is
                      not financial health, mastery or funding readiness.
                    </p>
                    <button
                      className="button"
                      disabled={busy || view.outdated || !cycle?.feedback}
                      onClick={() =>
                        void act({ action: 'finish_cycle' }).then((ok) => {
                          if (ok) close();
                        })
                      }
                    >
                      Finish cycle · watch for new inputs
                    </button>
                  </>
                )}
              </>
            )}
            {panel === 'history' && (
              <>
                <p>
                  {view.completedCycles} reviewed cycle(s). Superseded cycles remain historical, not
                  completed preparation.
                </p>
                {view.history.map((item, index) => (
                  <article className="loop-history" key={item.id}>
                    <strong>
                      {index === 0 ? 'Current / latest cycle' : 'Earlier cycle'} ·{' '}
                      {item.outcome ?? 'In progress'}
                    </strong>
                    <p>
                      Started {new Date(item.createdAt).toLocaleString()} ·{' '}
                      {item.closedAt
                        ? 'ended ' + new Date(item.closedAt).toLocaleString()
                        : 'not yet closed'}
                    </p>
                    <p className="loop-method">
                      Pitch v
                      {view.historyPitches.find((pitch) => pitch.id === item.pitchId)?.revision ??
                        'unknown'}{' '}
                      ·{' '}
                      {item.investorId
                        ? (state.workspace.investors.find(
                            (investor) => investor.id === item.investorId,
                          )?.name ?? 'Earlier selected investor')
                        : 'general preparation'}
                    </p>
                    <details>
                      <summary>Saved pitch and brief</summary>
                      <p className="loop-prose">
                        {view.historyPitches.find((pitch) => pitch.id === item.pitchId)?.text ??
                          'Pitch unavailable in this history page.'}
                      </p>
                      <p className="loop-prose">{item.brief}</p>
                    </details>
                    {item.proposal && (
                      <details>
                        <summary>Saved proposal & reason</summary>
                        <p>{item.proposal.text}</p>
                        <ul>
                          {item.proposal.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {item.feedback && (
                      <EvaluationPanel sessionId={item.feedback.sessionId} receipt="written" />
                    )}
                  </article>
                ))}
              </>
            )}
          </div>
        </dialog>
      )}
    </section>
  );
}
