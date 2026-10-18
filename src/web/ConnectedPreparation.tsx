import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ArrowRight, Check, ChevronRight, Circle } from 'lucide-react';
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
import { StorySourceExcerpt } from './StorySourceExcerpt.js';
import { TailoredBriefReview } from './TailoredBriefReview.js';
import { PreparedPracticeCard } from './PreparedPracticeCard.js';

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
                    {candidate.match && (
                      <small>
                        {candidate.match.score
                          ? candidate.match.score + '/10 match'
                          : 'Insufficient evidence for a score'}
                        {' · '}
                        {candidate.match.supportedWeight}/{candidate.match.applicableWeight}{' '}
                        weighted evidence
                      </small>
                    )}
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
  compact = false,
}: {
  state: StateResponse;
  onChange: () => void;
  compact?: boolean;
}) {
  const [routeContext] = useState(() => {
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    const target = params.get('targetId');
    const historicalCycle = params.get('preparationCycleId');
    const parsed = z
      .strictObject({ targetId: z.uuid().optional(), cycleId: z.uuid().optional() })
      .safeParse({
        ...(target ? { targetId: target } : {}),
        ...(historicalCycle ? { cycleId: historicalCycle } : {}),
      });
    return parsed.success
      ? { ...parsed.data, invalid: false }
      : { targetId: undefined, cycleId: undefined, invalid: true };
  });
  const [targetId, setTargetId] = useState(routeContext.targetId);
  const readQuery = new URLSearchParams({
    ...(targetId ? { targetId } : {}),
    ...(routeContext.cycleId ? { cycleId: routeContext.cycleId } : {}),
  });
  const readPath = `/preparation-loop${readQuery.size ? `?${readQuery}` : ''}`;
  const [view, setView] = useState<ConnectedPreparationView | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [preview, setPreview] = useState<ScenarioPreview | null>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [revisionScope, setRevisionScope] = useState<'shared' | 'target'>('target');
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const keys = useRef(new Map<string, string>());
  const deepLinkHandled = useRef(false);
  const refreshedDraft = useRef<string | null>(null);
  const savingStory = useRef(false);
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
    if (routeContext.invalid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!document.hidden) {
        try {
          const result = await request(readPath, connectedPreparationViewSchema, undefined, 'GET');
          if (!cancelled) {
            setView(result);
            setConnectionError('');
            if (!targetId && result.cycle?.targetId) setTargetId(result.cycle.targetId);
          }
        } catch (caught) {
          if (!cancelled)
            setConnectionError(
              caught instanceof Error ? caught.message : 'Cannot load preparation checklist.',
            );
        }
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void load();
        }, 5000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reload, readPath, targetId, routeContext.invalid]);
  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal();
  }, [panel]);
  useEffect(() => {
    if (panel === 'revision') setText(view?.cycle?.proposal?.text ?? view?.pitch?.text ?? '');
  }, [panel, view?.cycle?.id, view?.cycle?.proposal?.evaluationId]);
  useEffect(() => {
    if (panel === 'story') {
      if (savingStory.current) return;
      setText(refreshedDraft.current ?? view?.pitch?.text ?? view?.storyDraft?.text ?? '');
      refreshedDraft.current = null;
    }
  }, [panel, view?.pitch?.id]);
  useEffect(() => {
    setRevisionScope(panel === 'story' && !view?.cycle?.pitchApprovedAt ? 'shared' : 'target');
  }, [panel, view?.cycle?.id, view?.cycle?.pitchApprovedAt]);
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
    const next =
      cycleId && cycleId !== view.cycle?.id
        ? 'history'
        : !view.cycle && target !== 'history'
          ? 'story'
          : target === 'brief' && !view.cycle?.pitchApprovedAt
            ? 'story'
            : target;
    trigger.current = null;
    setText(
      next === 'revision'
        ? (view.cycle?.proposal?.text ?? view.pitch?.text ?? '')
        : (view.pitch?.text ?? view.storyDraft?.text ?? ''),
    );
    setPanel(next);
  }, [view]);
  function close() {
    if (busy) return;
    if (
      panel === 'story' &&
      text.trim() !== (view?.pitch?.text ?? view?.storyDraft?.text ?? '') &&
      !window.confirm('Close without saving your company story edits?')
    )
      return;
    refreshedDraft.current = null;
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
    setRevisionScope(next === 'story' && !view?.cycle?.pitchApprovedAt ? 'shared' : 'target');
    setText(
      next === 'revision'
        ? (view?.cycle?.proposal?.text ?? view?.pitch?.text ?? '')
        : (view?.pitch?.text ?? view?.storyDraft?.text ?? ''),
    );
  }
  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await operation();
      const result = await request(readPath, connectedPreparationViewSchema, undefined, 'GET');
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
    if (view.historical) {
      setError(
        'This preparation belongs to an archived goal and is read-only. Open the current goal to continue.',
      );
      return false;
    }
    const selectedTargetId = targetId ?? view.cycle?.targetId;
    const body = {
      ...input,
      version: view.version,
      ...(view.journeyId ? { journeyId: view.journeyId } : {}),
      ...(selectedTargetId ? { targetId: selectedTargetId } : {}),
    };
    return run(() => command('/preparation-loop/commands', { ...body, key: keyFor(body) }));
  }
  async function approveStory() {
    if (!view || view.historical || view.outdated) return;
    const submitted = text.trim();
    savingStory.current = true;
    const ok = await run(async () => {
      let current = view;
      const context = {
        ...(view.journeyId ? { journeyId: view.journeyId } : {}),
        ...((targetId ?? view.cycle?.targetId)
          ? { targetId: targetId ?? view.cycle?.targetId }
          : {}),
      };
      if (!current.cycle) {
        const start = { action: 'start', version: current.version, ...context };
        await command('/preparation-loop/commands', { ...start, key: keyFor(start) });
        current = await request(readPath, connectedPreparationViewSchema, undefined, 'GET');
        if (
          current.outdated ||
          !current.pitch ||
          current.pitch.sourceHash !== view.storyDraft?.sourceHash
        )
          throw new Error(
            'Sources changed. Refresh and review the company story before approving.',
          );
      }
      if (submitted !== current.pitch?.text) {
        const save = {
          action: 'save_pitch',
          version: current.version,
          text: submitted,
          ...context,
          ...(context.targetId ? { scope: revisionScope } : {}),
        };
        await command('/preparation-loop/commands', { ...save, key: keyFor(save) });
        current = await request(readPath, connectedPreparationViewSchema, undefined, 'GET');
        if (current.outdated || current.pitch?.text !== submitted)
          throw new Error(
            'The story changed while saving. Review the latest version before approving.',
          );
      }
      const approval = { action: 'approve_pitch', version: current.version, ...context };
      await command('/preparation-loop/commands', { ...approval, key: keyFor(approval) });
    });
    savingStory.current = false;
    if (ok) setPanel(targetId || view.cycle?.investorId ? 'brief' : 'investor');
  }
  async function action(next: Panel) {
    if (!view) return;
    if (!view.cycle) {
      if (await act({ action: 'start' })) {
        setPanel('story');
        setReload((n) => n + 1);
      }
      return;
    }
    open(next);
  }
  if (routeContext.invalid)
    return (
      <p role="alert">
        This preparation link has an invalid target or cycle. <a href="/">Open the current goal</a>{' '}
        to choose a saved investor track.
      </p>
    );
  if (!view)
    return <p role="status">{connectionError || error || 'Loading connected preparation…'}</p>;
  const cycle = view.cycle;
  const currentScenario =
    view.generation?.scenarios.find((s) => s.id === scenarioId) ?? view.generation?.scenarios[0];
  const currentStep = view.steps.find((s) => s.status !== 'complete' && s.status !== 'blocked');
  const nextPanel: Panel = currentStep?.id ?? 'history';
  const story = view.pitch ?? view.storyDraft;
  const briefVersion = view.briefVersions.find((brief) => brief.id === cycle?.briefVersionId);
  const changedText = text.trim() !== (story?.text ?? '');
  const visibleError = error || connectionError;
  return (
    <section className="connected-preparation" aria-label="Six-step preparation loop">
      <details className="journey-details" open={!compact}>
        <summary>All preparation steps & saved cycles</summary>
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
        {view.historical && (
          <p role="status" className="loop-warning">
            This is a read-only preparation track from an archived goal. Its briefs, sources and
            assessments remain available. <a href="/">Open the current goal</a> to continue
            preparing.
          </p>
        )}
        {targetId && (
          <p className="loop-method">
            Preparing for{' '}
            {state.workspace.investors.find((investor) => investor.id === view.cycle?.investorId)
              ?.name ?? 'this target investor'}{' '}
            under your saved goal. <a href="/?page=radar">Choose another target in Radar</a>; each
            target retains its own brief and practice history.
          </p>
        )}
        {visibleError && (
          <p role="alert">
            {visibleError}{' '}
            <button className="text-button" onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </p>
        )}
        {!cycle ? (
          <div className="prep-next">
            <div>
              <h3>
                {view.historical
                  ? 'Saved preparation history'
                  : 'Start your six-step preparation checklist'}
              </h3>
              <p>
                {view.historical
                  ? 'Inspect the exact earlier cycle without changing the current goal or investor focus.'
                  : 'Use the confirmed goal and selected statement to prepare a sourced financial story.'}
              </p>
            </div>
            {view.historical ? (
              <button className="button secondary" onClick={() => open('history')}>
                Inspect saved history
              </button>
            ) : (
              <button
                className="button"
                disabled={busy || !view.goalId}
                onClick={() => void action('story')}
              >
                Prepare my checklist <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="loop-position">
              <span>
                <strong>Current story · v{view.pitch?.revision}</strong>{' '}
                {view.pitch?.createdAt ? new Date(view.pitch.createdAt).toLocaleString() : ''}
              </span>
              <span>
                {view.pitch?.fictional ? 'Fictional demo evidence · ' : ''}Cycle {view.cycleNumber}{' '}
                · {view.steps.filter((s) => s.status === 'complete').length} / 6 steps
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
      </details>
      {panel && (
        <dialog
          ref={dialog}
          className={`loop-dialog${panel === 'story' || panel === 'brief' || panel === 'practice' ? ' loop-compact-modal' : ''}${panel === 'story' ? ' loop-story-modal' : ''}`}
          aria-labelledby="loop-panel-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="loop-dialog-heading">
            <div>
              <div className="eyebrow">
                {view.historical ? 'Saved preparation' : 'Your next step'}
              </div>
              <h2 id="loop-panel-title">
                {panel === 'story'
                  ? 'Review company story'
                  : panel === 'practice'
                    ? 'Practise with an AI investor'
                    : panel === 'history'
                      ? 'Saved preparation cycles'
                      : view.steps.find((step) => step.id === panel)?.title}
              </h2>
            </div>
            <button className="button secondary" disabled={busy} onClick={close}>
              Close
            </button>
          </div>
          <div className="loop-dialog-body">
            {visibleError && <p role="alert">{visibleError}</p>}
            {!cycle && panel !== 'history' && !view.storyDraft && (
              <section>
                <p>
                  Your target investor is saved. Review your company story before June prepares its
                  tailored brief.
                </p>
                {state.workspace.snapshots.length ? (
                  <button className="button" disabled={busy} onClick={() => void action('story')}>
                    Prepare company story
                  </button>
                ) : (
                  <a className="button" href="/?page=financials">
                    Add company evidence
                  </a>
                )}
              </section>
            )}
            {view.outdated && (
              <div className="loop-warning" role="status">
                <strong>New sources need review.</strong>
                <p>
                  Refresh this step to use the latest saved evidence. Earlier versions remain in
                  history.
                </p>
                {changedText && <p>Your unsaved story edits will be kept for review.</p>}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    refreshedDraft.current = changedText && panel === 'story' ? text : null;
                    void act({ action: 'refresh' }).then((ok) => {
                      if (ok) {
                        setPreview(null);
                        setPanel('story');
                      } else refreshedDraft.current = null;
                    });
                  }}
                >
                  Refresh this step
                </button>
                <a
                  className="text-button"
                  href={`/?page=radar${targetId ? `&targetId=${encodeURIComponent(targetId)}` : ''}`}
                >
                  Review investor match
                </a>
              </div>
            )}
            {story?.fictional && <p className="loop-tag">Fictional demo evidence</p>}
            {panel === 'story' && story && (
              <>
                <p>
                  Review the draft. Saving confirms your review and prepares your investor brief.
                </p>
                <label className="loop-label" htmlFor="loop-pitch">
                  Company story
                </label>
                <textarea
                  id="loop-pitch"
                  value={text}
                  maxLength={3000}
                  rows={8}
                  onChange={(event) => setText(event.target.value)}
                />
                <details className="journey-details story-support">
                  <summary>Sources & editing options</summary>
                  <div className="story-support-content">
                    {targetId && (
                      <fieldset
                        className="story-edit-scope"
                        disabled={busy || view.outdated || view.historical}
                      >
                        <legend>Apply edits to</legend>
                        <div className="story-scope-choices">
                          <label>
                            <input
                              type="radio"
                              name="story-edit-scope"
                              value="target"
                              checked={revisionScope === 'target'}
                              onChange={() => setRevisionScope('target')}
                            />
                            This investor
                          </label>
                          <label>
                            <input
                              type="radio"
                              name="story-edit-scope"
                              value="shared"
                              checked={revisionScope === 'shared'}
                              onChange={() => setRevisionScope('shared')}
                            />
                            Whole goal
                          </label>
                        </div>
                        <p className="story-support-hint">
                          {revisionScope === 'shared'
                            ? 'Updates affected investor briefs. Previous versions stay saved.'
                            : 'Keeps other investor stories and approvals unchanged.'}
                        </p>
                      </fieldset>
                    )}
                    <section className="story-source-list" aria-label="Company story sources">
                      <div className="story-source-heading">
                        <h3>
                          Sources <span>{story.sources.length}</span>
                        </h3>
                        <a href="/?preparationTools=claims#deck-claims">Check calculations →</a>
                      </div>
                      {story.sources.map((source) => (
                        <details className="story-source-card" key={source.id}>
                          <summary>
                            <ChevronRight
                              size={16}
                              className="story-source-chevron"
                              aria-hidden="true"
                            />
                            <span>{source.title}</span>
                            {source.fictional && <small>Fictional</small>}
                          </summary>
                          <div className="story-source-content">
                            {source.recordedAt && (
                              <p className="story-support-hint">Recorded {source.recordedAt}</p>
                            )}
                            <StorySourceExcerpt excerpt={source.excerpt} />
                            {source.url?.startsWith('https://') && (
                              <a href={source.url} target="_blank" rel="noreferrer">
                                Open original source ↗
                              </a>
                            )}
                          </div>
                        </details>
                      ))}
                      {!story.sources.length && (
                        <p className="story-support-hint">No sources saved for this story.</p>
                      )}
                    </section>
                    <details className="story-review-notes">
                      <summary>Review notes</summary>
                      <p>{story.reason}</p>
                      <p>
                        Saving keeps prior versions. Your review does not independently verify
                        edited claims.
                      </p>
                    </details>
                  </div>
                </details>
                <button
                  className="button"
                  disabled={busy || view.outdated || !text.trim()}
                  onClick={() => void approveStory()}
                >
                  {busy ? 'Saving…' : 'Save & continue →'}
                </button>
              </>
            )}
            {panel === 'investor' &&
              (targetId ? (
                <div>
                  <p>
                    This investor was selected for this goal in Radar. Review the saved match, or
                    choose a separate target to prepare for another investor.
                  </p>
                  <a className="button secondary" href="/?page=radar">
                    Review target investors
                  </a>
                  <button
                    className="button"
                    disabled={busy || !cycle?.brief}
                    onClick={() => setPanel('brief')}
                  >
                    Continue to tailored brief
                  </button>
                </div>
              ) : (
                <InvestorPreparationRecommendations
                  view={view}
                  disabled={busy || view.outdated || !cycle?.pitchApprovedAt}
                  onSelect={(investorId) => {
                    void act({ action: 'select_investor', investorId }).then((ok) => {
                      if (ok) setPanel('brief');
                    });
                  }}
                />
              ))}
            {panel === 'brief' && (
              <>
                {cycle && !cycle.pitchApprovedAt && (
                  <button className="button secondary" onClick={() => open('story')}>
                    Review company story first
                  </button>
                )}
                {cycle?.brief ? (
                  <TailoredBriefReview
                    brief={cycle.brief}
                    sources={briefVersion?.sources ?? story?.sources ?? []}
                    fictional={briefVersion?.fictional ?? story?.fictional ?? false}
                  />
                ) : (
                  <p>Select a saved investor to prepare a tailored brief.</p>
                )}
                <div className="prep-buttons">
                  <button
                    className="button"
                    disabled={busy || view.outdated || !cycle?.brief || !cycle.pitchApprovedAt}
                    onClick={() =>
                      void act({ action: 'approve_brief' }).then((ok) => {
                        if (ok) setPanel('practice');
                      })
                    }
                  >
                    {busy ? 'Approving…' : 'Approve & continue →'}
                  </button>
                </div>
              </>
            )}
            {panel === 'practice' && (
              <>
                {!view.generation && !preview && (
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
                    Review practice inputs →
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
                      Create practice →
                    </button>
                  </div>
                )}
                {view.generation && (
                  <>
                    {view.generation.status !== 'succeeded' && (
                      <p role="status">Preparing your practice: {view.generation.status}</p>
                    )}
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
                        {currentScenario && (
                          <PreparedPracticeCard
                            generationId={view.generation.id}
                            mode={view.generation.mode}
                            scenario={currentScenario}
                            targetId={targetId ?? null}
                            disabled={busy || view.outdated || !cycle?.briefApprovedAt}
                          />
                        )}
                        {view.generation.scenarios.length > 1 && (
                          <details className="journey-details">
                            <summary>Change practice scenario</summary>
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
                          </details>
                        )}
                        {(!view.latestSession || view.latestSession.status === 'unavailable') && (
                          <details className="journey-details">
                            <summary>Write an answer instead · optional</summary>
                            <label className="loop-label" htmlFor="loop-answer">
                              Your practice answer
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
                              Save answer & review →
                            </button>
                          </details>
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
                    <details className="journey-details">
                      <summary>Full assessment, evidence & retries</summary>
                      <EvaluationPanel sessionId={view.latestSession.id} receipt="written" />
                    </details>
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
                      Reviewed · continue →
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
                    {targetId && (
                      <label className="loop-label">
                        Apply the accepted revision to
                        <select
                          value={revisionScope}
                          onChange={(event) =>
                            setRevisionScope(z.enum(['shared', 'target']).parse(event.target.value))
                          }
                        >
                          <option value="target">This investor’s preparation only</option>
                          <option value="shared">Shared company story for the whole goal</option>
                        </select>
                        <small>
                          {revisionScope === 'shared'
                            ? 'Shared changes reopen affected reviews for other target investors.'
                            : 'This revision stays within the selected investor track.'}
                        </small>
                      </label>
                    )}
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
                          void act({
                            action: 'accept_revision',
                            text: text.trim(),
                            ...(targetId ? { scope: revisionScope } : {}),
                          }).then((ok) => {
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
                {view.history.map((item) => (
                  <article
                    className="loop-history"
                    key={item.id}
                    id={`preparation-cycle-${item.id}`}
                  >
                    <strong>
                      {item.id === view.cycle?.id ? 'Current / latest cycle' : 'Earlier cycle'} ·{' '}
                      {item.outcome ?? 'In progress'}
                    </strong>
                    {routeContext.cycleId === item.id && (
                      <p className="loop-tag">Exact cycle selected from saved history</p>
                    )}
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
                      <p className="loop-method">
                        Cycle {item.id} · Company story {item.pitchId} · Brief version{' '}
                        {item.briefVersionId ?? 'Legacy brief without a version ID'}
                      </p>
                    </details>
                    <details>
                      <summary>Exact saved evidence and sources</summary>
                      {(() => {
                        const brief = view.briefVersions.find(
                          (entry) => entry.id === item.briefVersionId,
                        );
                        const pitch = view.historyPitches.find(
                          (entry) => entry.id === item.pitchId,
                        );
                        const sources = brief?.sources ?? pitch?.sources ?? [];
                        return (
                          <>
                            <p className="loop-method">
                              {brief
                                ? `Frozen brief source manifest · financial snapshot ${brief.snapshotId ?? 'not recorded'} · goal ${brief.goalId}`
                                : 'Legacy history contains only the source snapshots saved with the story. Missing original investor passages are not reconstructed.'}
                            </p>
                            {sources.map((source) => (
                              <blockquote key={source.id}>
                                <strong>
                                  {source.title}
                                  {source.fictional ? ' · Fictional evidence' : ''}
                                </strong>
                                <pre>{source.excerpt}</pre>
                                <small>Recorded {source.recordedAt ?? 'Unknown'}</small>
                                {source.url && (
                                  <p>
                                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                                      Open original source
                                    </a>
                                  </p>
                                )}
                              </blockquote>
                            ))}
                            {!sources.length && (
                              <p>
                                No original source passages are available for this saved version.
                              </p>
                            )}
                          </>
                        );
                      })()}
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
