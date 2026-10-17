import { ConnectedPreparation } from './ConnectedPreparation.js';
import { DeckClaims } from './DeckClaims.js';
import { PreparationPosition } from './PreparationPosition.js';
import { FinancialSourceEvidence, InvestorSourceEvidence } from './PreparationSourceEvidence.js';
import { PreparationRecommendationBasis } from './PreparationRecommendationBasis.js';
import { PreparationIntentForm } from './PreparationIntentForm.js';
import { FinancialPerformanceStatement } from './FinancialPerformanceStatement.js';
import { PreparationSchedule } from './PreparationSchedule.js';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ArrowRight, RefreshCw } from 'lucide-react';
import type { StateResponse } from '../contracts/Workspace.js';
import {
  preparationGoalInputSchema,
  preparationViewSchema,
  type PreparationView,
  type PreparationArtifact,
} from '../contracts/FundraisingPreparation.js';
import { request, command } from './ApiClient.js';
import { EvaluationPanel } from './EvaluationPanel.js';
import { preparationScenarioHref } from '../contracts/PreparationNavigation.js';
import './PreparationPlan.css';

export function PreparationComparisonChart({ artifact }: { artifact: PreparationArtifact }) {
  const chart = artifact.chart;
  if (!chart) return null;
  const entries = [
    { title: 'Operating income', value: chart.operatingIncome, color: '#a55038' },
    { title: 'Credit', value: chart.credit, color: '#b79036' },
    { title: 'Net income', value: chart.netIncome, color: '#58774b' },
  ];
  const max = Math.max(...entries.map((entry) => Math.abs(Number(entry.value))), 1);
  return (
    <figure className="prep-chart">
      <figcaption>
        {chart.period} · {chart.currency}
      </figcaption>
      <svg
        viewBox="0 0 600 150"
        role="img"
        aria-label={`Operating income ${chart.operatingIncome}, credit ${chart.credit}, net income ${chart.netIncome}. ${chart.currency}.`}
      >
        <line x1="365" y1="0" x2="365" y2="145" stroke="#cbd1c5" />
        {entries.map((entry, index) => {
          const value = Number(entry.value);
          const width = (Math.abs(value) / max) * 160;
          return (
            <g key={entry.title}>
              <text x="0" y={index * 48 + 24} fontSize="14" fill="currentColor">
                {entry.title}
              </text>
              <rect
                x={value < 0 ? 365 - width : 365}
                y={index * 48 + 7}
                width={width}
                height="25"
                rx="3"
                fill={entry.color}
              />
            </g>
          );
        })}
      </svg>
      <table>
        <caption>Exact source values</caption>
        <thead>
          <tr>
            <th>Measure</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.title}>
              <th scope="row">{entry.title}</th>
              <td>{entry.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {chart.fileName} · CSV row {chart.sourceRow}. Credit recurrence and cash timing are unknown.
      </p>
    </figure>
  );
}

function GoalForm({
  data,
  state,
  save,
  busy,
}: {
  data: PreparationView;
  state: StateResponse;
  save: (body: unknown) => Promise<void>;
  busy: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const goal = data.goal;
  const [error, setError] = useState('');
  return (
    <form
      ref={form}
      className="prep-goal-form"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const previousValue = values.get('previousRounds');
        const previous = typeof previousValue === 'string' ? previousValue : '';
        const parsed = preparationGoalInputSchema.safeParse({
          round: values.get('round'),
          previousRounds: previous === '' ? null : Number(previous),
          amount: values.get('amount') || null,
          currency: values.get('currency'),
          targetDate: values.get('targetDate') || null,
          timezone: values.get('timezone'),
          investorId: values.get('investorId') || null,
        });
        if (!parsed.success) {
          setError('Check the round, amount, prior rounds, date and timezone.');
          return;
        }
        setError('');
        void save({
          goal: parsed.data,
          version: data.version,
          automatic: values.get('automatic') === 'on',
        });
      }}
    >
      <label>
        Intended round
        <input
          name="round"
          required
          maxLength={100}
          placeholder="For example, Series A; or round not yet decided"
          defaultValue={goal?.round ?? state.workspace.profile.stage}
        />
      </label>
      <label>
        Prior financing rounds
        <input
          name="previousRounds"
          type="number"
          min="0"
          max="30"
          placeholder="Unknown"
          defaultValue={goal?.previousRounds ?? ''}
        />
      </label>
      <label>
        Target raise amount
        <input
          name="amount"
          inputMode="decimal"
          placeholder="Unknown"
          defaultValue={goal?.amount ?? state.workspace.profile.raiseTarget ?? ''}
        />
      </label>
      <label>
        Currency
        <select name="currency" defaultValue={goal?.currency ?? state.workspace.profile.currency}>
          {['unspecified', 'USD', 'CAD', 'EUR', 'GBP'].map((currency) => (
            <option key={currency} value={currency}>
              {currency === 'unspecified' ? 'Not confirmed' : currency}
            </option>
          ))}
        </select>
      </label>
      <label>
        Desired preparation date
        <input type="date" name="targetDate" defaultValue={goal?.targetDate ?? ''} />
      </label>
      <label>
        Timezone
        <input
          name="timezone"
          required
          defaultValue={goal?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
        />
      </label>
      <label className="prep-full">
        Investor
        <select name="investorId" defaultValue={goal?.investorId ?? ''}>
          <option value="">General preparation — select later</option>
          {state.workspace.investors.map((investor) => (
            <option key={investor.id} value={investor.id}>
              {investor.name}
            </option>
          ))}
        </select>
      </label>
      <label className="prep-full prep-check">
        <input
          type="checkbox"
          name="automatic"
          defaultChecked={data.goal ? data.automatic : true}
        />{' '}
        Prepare internal drafts automatically when saved evidence changes.
      </label>
      <p className="muted prep-full">
        Automatic drafting uses saved evidence and local rules. It starts no research, messages or
        paid practice sessions. Written assessment uses the existing AI evaluator after you submit.
      </p>
      {error && (
        <p role="alert" className="prep-full">
          {error}
        </p>
      )}
      <button className="button prep-full" disabled={busy}>
        Confirm goal & prepare plan
      </button>
    </form>
  );
}

export function PreparationPlan({
  state,
  onFinancials,
  onResearch,
}: {
  state: StateResponse;
  onFinancials: () => void;
  onResearch: () => void;
}) {
  const [data, setData] = useState<PreparationView | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState('');
  const previousView = useRef<PreparationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [financialView, setFinancialView] = useState(false);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const actionButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // Read saved state only; do not interrupt open drafts or trigger research from polling.
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const isCancelled = () => cancelled;
    const load = async () => {
      if (isCancelled() || running || document.hidden) return;
      running = true;
      try {
        const result = await request('/preparation-plan', preparationViewSchema, undefined, 'GET');
        if (!isCancelled()) {
          const previous = previousView.current;
          if (previous && previous.plan?.id !== result.plan?.id && result.plan)
            setUpdateNotice('Preparation updated: ' + result.plan.changes.join(' '));
          else if (previous && !previous.outdated && result.outdated)
            setUpdateNotice(
              'New saved evidence: ' +
                (result.position?.pendingChanges.join(' ') ?? 'Review the changed inputs.'),
            );
          else if (
            previous &&
            previous.milestones.map((item) => item.status).join() !==
              result.milestones.map((item) => item.status).join()
          )
            setUpdateNotice('Preparation progress updated from saved reviews and assessments.');
          previousView.current = result;
          setData(result);
          setReceivedAt(new Date().toISOString());
          setConnectionError('');
        }
      } catch {
        if (!isCancelled())
          setConnectionError('Unable to refresh saved evidence. Check the connection to June.');
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload, state.workspace.revision]);
  useEffect(() => {
    if (artifactId && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [artifactId]);
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
      setReload((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Preparation could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (
      (answer.trim() || note.trim()) &&
      !window.confirm('Close without saving your unfinished notes or answer?')
    )
      return;
    dialog.current?.close();
    setArtifactId(null);
    setAnswer('');
    setNote('');
    actionButton.current?.focus();
  }
  if (!data)
    return (
      <section className="prep-plan" aria-label="Fundraising preparation">
        {connectionError || error ? (
          <p role="alert">
            {connectionError || error}{' '}
            <button onClick={() => setReload((value) => value + 1)}>Retry</button>
          </p>
        ) : (
          <p role="status">Loading your preparation plan…</p>
        )}
      </section>
    );
  const artifact = data.plan?.artifacts.find((item) => item.id === artifactId);
  const decision = artifact && data.decisions.findLast((item) => item.artifactId === artifact.id);
  const workerOnline =
    data.heartbeatAt !== null && Date.now() - Date.parse(data.heartbeatAt) < 60000;
  const financial = data.plan?.artifacts.find((item) => item.kind === 'financial');
  const snapshot = state.workspace.snapshots.find(
    (item) => item.id === state.workspace.onboarding.snapshotId,
  );
  const latestRow = snapshot?.rows.at(-1);
  const nextArtifact =
    data.milestones.find((item) => item.id === 'financial')?.status === 'complete' &&
    data.goal?.investorId &&
    data.milestones.find((item) => item.id === 'brief')?.status !== 'complete'
      ? data.plan?.artifacts.find((item) => item.kind === 'investor')
      : financial;
  const schedule = (
    <PreparationSchedule
      operatingResult={
        data.position
          ? (data.position.financial?.operatingIncome ?? null)
          : (latestRow?.operatingIncome ?? null)
      }
      period={
        data.position ? (data.position.financial?.period ?? null) : (latestRow?.month ?? null)
      }
      currency={
        (data.position ? data.position.financial?.currency : snapshot?.currency) === 'unspecified'
          ? 'Currency unconfirmed'
          : data.position
            ? (data.position.financial?.currency ?? 'Currency unconfirmed')
            : (snapshot?.currency ?? 'Currency unconfirmed')
      }
      busy={busy}
      onFinancialReview={() => {
        if (!data.goal) onFinancials();
        else setFinancialView((value) => !value);
      }}
      onSave={async (assumptions) => {
        setBusy(true);
        try {
          await command('/preparation-plan/schedule', {
            assumptions,
            version: data.version,
            planId: data.plan?.id,
          });
          setReload((value) => value + 1);
        } finally {
          setBusy(false);
        }
      }}
      data={data}
      onAction={(action) => {
        if (data.connectedActive && action !== 'goal') {
          const step =
            data.milestones.find((item) => item.id === action)?.preparationStep ?? 'story';
          window.location.assign(`/?preparationStep=${step}`);
          return;
        }
        if (action === 'investor' && state.workspace.investors.length === 0) {
          onResearch();
          return;
        }
        if (action === 'goal' || action === 'investor') {
          setEditing(true);
          return;
        }
        if (action === 'refresh') {
          void run(() => command('/preparation-plan/refresh', {}));
          return;
        }
        const kind = action === 'brief' ? 'investor' : 'financial';
        const prepared = data.plan?.artifacts.find((item) => item.kind === kind);
        if (prepared) {
          setArtifactId(prepared.id);
          setSessionId(null);
        } else if (action === 'brief') setEditing(true);
        else onFinancials();
      }}
    />
  );
  return (
    <section className="prep-plan" aria-label="Fundraising preparation">
      <div className="prep-heading">
        <div>
          <span className="eyebrow">June · Your preparation plan</span>
          <h2>Your position. Your path forward.</h2>
        </div>
        <span className={`prep-agent ${data.automatic && workerOnline ? 'is-on' : ''}`}>
          {data.automatic
            ? workerOnline
              ? 'Watching saved evidence'
              : 'Worker offline · updates waiting'
            : 'Automatic drafting paused'}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data.goal && schedule}
      {!data.goal || editing ? (
        <div className="prep-goal-box">
          <h3>{data.goal ? 'Update your goal' : 'What are you preparing for?'}</h3>
          <PreparationIntentForm
            intent={data.intent}
            busy={busy}
            onSave={async (intent) => {
              await run(async () => {
                await command('/preparation-plan/intent', {
                  intent,
                  version: data.version,
                  profileVersion: data.profileVersion,
                });
                setEditing(false);
              });
            }}
          />
          <details>
            <summary>Round, investor & automation settings · optional</summary>
            <GoalForm
              key={data.goal?.id ?? 'initial'}
              data={data}
              state={state}
              busy={busy}
              save={async (body) => {
                await run(async () => {
                  await command('/preparation-plan/goal', body);
                  setEditing(false);
                });
              }}
            />
          </details>
          {data.goal && (
            <button className="text-button" onClick={() => setEditing(false)}>
              Cancel changes
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="prep-goal-summary">
            <div>
              <span className="eyebrow">Your goal</span>
              <strong>{data.intent || 'Prepare for my next round'}</strong>
            </div>
            <button className="button secondary" onClick={() => setEditing(true)}>
              Update goal
            </button>
          </div>
          <PreparationPosition
            data={data}
            receivedAt={receivedAt}
            connectionError={connectionError}
            notice={updateNotice}
            busy={busy}
            researchReady={state.capabilities.researchReady}
            onRefresh={() => void run(() => command('/preparation-plan/refresh', {}))}
            onCheck={() => {
              const id = data.position?.investor?.id;
              if (id)
                void run(() =>
                  command(`/investors/${encodeURIComponent(id)}/check`, {
                    key: crypto.randomUUID(),
                  }),
                );
            }}
          />
          {financialView && (
            <div className="prep-financial-view">
              <button className="text-button" onClick={() => setFinancialView(false)}>
                Close financial review
              </button>
              <FinancialPerformanceStatement
                revision={state.workspace.revision}
                onEvidence={() => {
                  if (financial) {
                    setArtifactId(financial.id);
                    setSessionId(null);
                  } else onFinancials();
                }}
              />
            </div>
          )}
          {schedule}
          <DeckClaims state={state} onChange={() => setReload((value) => value + 1)} />
          <ConnectedPreparation state={state} onChange={() => setReload((value) => value + 1)} />
          {!data.connectedActive && (
            <div className="prep-next">
              <div>
                <span className="eyebrow">Recommended next action</span>
                <h3>{data.nextAction}</h3>
                {data.outdated && (
                  <p>
                    Saved inputs changed. Previous reviews remain in history; refresh before
                    accepting or rehearsing.
                  </p>
                )}
              </div>
              <div className="prep-buttons">
                {data.outdated ? (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void run(() => command('/preparation-plan/refresh', {}))}
                  >
                    Refresh plan
                  </button>
                ) : nextArtifact ? (
                  <button
                    ref={actionButton}
                    className="button"
                    onClick={() => {
                      setArtifactId(nextArtifact.id);
                      setSessionId(null);
                    }}
                  >
                    Review prepared work <ArrowRight size={16} />
                  </button>
                ) : (
                  <button className="button" onClick={onFinancials}>
                    Open financial evidence
                  </button>
                )}
                <button className="button secondary" onClick={onResearch}>
                  Investor research
                </button>
              </div>
            </div>
          )}
          <PreparationRecommendationBasis
            data={data}
            onEvidence={(id) => {
              setArtifactId(id);
              setSessionId(null);
            }}
          />
          <details className="prep-supporting">
            <summary>Prepared materials, feedback & history</summary>
            <div className="prep-artifacts">
              {data.plan?.artifacts.map((item) => (
                <button
                  className="prep-artifact"
                  key={item.id}
                  disabled={data.outdated}
                  onClick={() => {
                    setArtifactId(item.id);
                    setSessionId(null);
                  }}
                >
                  <span className="eyebrow">
                    {data.decisions.findLast((entry) => entry.artifactId === item.id)?.kind ===
                    'accepted'
                      ? 'Reviewed'
                      : 'Prepared for review'}
                  </span>
                  <strong>{item.title}</strong>
                  <span>{item.why}</span>
                  {item.fictional && (
                    <span className="progress-tag tone-demo">Fictional demo evidence</span>
                  )}
                </button>
              ))}
            </div>
            {data.feedback.length > 0 && (
              <div className="prep-feedback">
                <h3>What still needs attention</h3>
                <ul>
                  {data.feedback.map((item) => (
                    <li key={`${item.sessionId}:${item.taskId}`}>
                      <a
                        href={`/?page=followups&session=${encodeURIComponent(item.sessionId)}&followupsOffset=${item.offset}&task=${encodeURIComponent(item.taskId)}#practice-${encodeURIComponent(item.sessionId)}`}
                      >
                        {item.title}
                      </a>{' '}
                      · {item.status.replaceAll('_', ' ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.reviews.length > 0 && (
              <details>
                <summary>Saved rehearsal results · {data.reviews.length} recent</summary>
                {data.reviews.map((review) => (
                  <div className="prep-review" key={review.sessionId}>
                    <strong>
                      {review.status.replaceAll('_', ' ')}
                      {!review.current ? ' · earlier preparation' : ''}
                    </strong>
                    <p>
                      {review.summary ??
                        'The worker processes submitted assessments. A failed review can be retried below.'}
                    </p>
                    <details>
                      <summary>Inspect assessment & retry</summary>
                      <EvaluationPanel sessionId={review.sessionId} receipt="written" />
                    </details>
                  </div>
                ))}
              </details>
            )}
          </details>
          <details className="prep-method">
            <summary>How June keeps this plan current</summary>
            <p>
              Financial snapshots + confirmed company goal + selected investor research + completed
              practice feedback → updated preparation drafts → your review → targeted rehearsal.
            </p>
            <ul>
              {data.plan?.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
            <p>
              Last plan update:{' '}
              {data.plan ? new Date(data.plan.createdAt).toLocaleString() : 'not yet prepared'}.
              Unchanged inputs create no new drafts. The worker must remain running.
            </p>
            <p>
              These milestones track preparation. They do not predict funding, financial performance
              or a closing date. Desired dates are founder targets; conditional completion estimates
              use your saved effort and availability assumptions. Accepted reviews in the last seven
              days describe activity, not productivity or future performance.
            </p>
            <div className="prep-buttons">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    command('/preparation-plan/automatic', {
                      automatic: !data.automatic,
                      version: data.version,
                    }),
                  )
                }
              >
                {data.automatic ? 'Pause automatic drafts' : 'Enable automatic drafts'}
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void run(() => command('/preparation-plan/refresh', {}))}
              >
                <RefreshCw size={14} /> Check saved inputs now
              </button>
            </div>
          </details>
        </>
      )}
      {artifactId && (
        <dialog
          className="prep-dialog"
          ref={dialog}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          aria-labelledby="prep-dialog-title"
        >
          <div className="prep-heading">
            <h2 id="prep-dialog-title">{artifact?.title ?? 'Earlier preparation'}</h2>
            <button className="button secondary" onClick={close}>
              Close
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {!artifact ? (
            <p>
              The current plan changed while this panel was open. Close it to review the updated
              draft. Unfinished text remains here until you close.
            </p>
          ) : (
            <>
              {data.outdated && (
                <p role="status">Evidence changed. Close and refresh the plan before saving.</p>
              )}
              {artifact.fictional && (
                <p className="progress-tag tone-demo">Fictional demo evidence</p>
              )}
              <h3>Suggested explanation</h3>
              <blockquote>{artifact.narrative}</blockquote>
              <p>
                <strong>Why June prepared this:</strong> {artifact.why}
              </p>
              <PreparationComparisonChart artifact={artifact} />
              <details>
                <summary>Evidence and source passages ({artifact.sources.length})</summary>
                {artifact.kind === 'financial' && data.plan ? (
                  <FinancialSourceEvidence planId={data.plan.id} artifact={artifact} />
                ) : artifact.sources.length ? (
                  artifact.sources.map((source) => (
                    <InvestorSourceEvidence key={source.id} source={source} />
                  ))
                ) : (
                  <p>
                    No research source is available. Verify current mandate and fit before
                    approaching this investor.
                  </p>
                )}
              </details>
              <label className="prep-note">
                Your context or requested changes
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={1000}
                  placeholder="Saved as a founder note. This does not change the source figures or certify new claims."
                />
              </label>
              {decision && (
                <p>
                  Last decision: {decision.kind}.{' '}
                  {decision.note && `Founder note (unverified): ${decision.note}`}
                </p>
              )}
              <div className="prep-buttons">
                <button
                  className="button"
                  disabled={busy || data.outdated}
                  onClick={() =>
                    void run(async () => {
                      await command('/preparation-plan/decisions', {
                        planId: data.plan?.id,
                        artifactId: artifact.id,
                        kind: 'accepted',
                        note,
                        requestKey: crypto.randomUUID(),
                      });
                      setNote('');
                    })
                  }
                >
                  Accept preparation
                </button>
                <button
                  className="button secondary"
                  disabled={busy || data.outdated}
                  onClick={() =>
                    void run(async () => {
                      await command('/preparation-plan/decisions', {
                        planId: data.plan?.id,
                        artifactId: artifact.id,
                        kind: 'rejected',
                        note,
                        requestKey: crypto.randomUUID(),
                      });
                      setNote('');
                    })
                  }
                >
                  Needs changes
                </button>
              </div>
              {artifact.kind === 'financial' && decision?.kind === 'accepted' && (
                <form
                  className="prep-written"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const result = await request(
                        '/preparation-plan/rehearsals',
                        z.strictObject({ id: z.uuid() }),
                        {
                          planId: data.plan?.id,
                          artifactId: artifact.id,
                          answer,
                          requestKey: draftKey,
                        },
                      );
                      setSessionId(result.id);
                      setAnswer('');
                      setDraftKey(crypto.randomUUID());
                    });
                  }}
                >
                  <h3>Try explaining it yourself</h3>
                  <p>{artifact.question}</p>
                  <ul>
                    {artifact.criteria.map((criterion) => (
                      <li key={criterion}>{criterion}</li>
                    ))}
                  </ul>
                  <label>
                    Your answer
                    <textarea
                      required
                      maxLength={3000}
                      value={answer}
                      onChange={(event) => {
                        setAnswer(event.target.value);
                        setDraftKey(crypto.randomUUID());
                      }}
                    />
                  </label>
                  <p className="muted">
                    Submit sends your answer and frozen preparation evidence to the configured AI
                    evaluator. No voice session starts.
                  </p>
                  <button className="button" disabled={busy || data.outdated || !answer.trim()}>
                    Submit for assessment
                  </button>
                  <a
                    className="text-button"
                    href={preparationScenarioHref(artifact.question, data.goal?.investorId)}
                  >
                    Review a voice/video scenario separately
                  </a>
                </form>
              )}
              {sessionId && (
                <div role="status">
                  <p>Answer saved. The assessment will update this plan.</p>
                  <EvaluationPanel sessionId={sessionId} receipt="written" />
                </div>
              )}
            </>
          )}
        </dialog>
      )}
    </section>
  );
}
