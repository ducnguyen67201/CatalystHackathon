import { useEffect, useId, useState } from 'react';
import { ArrowRight, Check, Database, Target } from 'lucide-react';
import {
  preparationProgressSchema,
  type PreparationAction,
  type PreparationArea,
  type PreparationProgress as Progress,
} from '../contracts/PreparationProgress.js';
import { request } from './ApiClient.js';
import { followupObjective, preparationScenarioHref } from '../contracts/PreparationNavigation.js';
import './PreparationProgress.css';

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function followupHref(
  action: Pick<PreparationAction, 'sessionId' | 'offset'> & { taskId?: string },
) {
  const query = new URLSearchParams({
    page: 'followups',
    session: action.sessionId,
    followupsOffset: String(action.offset),
  });
  if (action.taskId) query.set('task', action.taskId);
  return `/?${query}#practice-${encodeURIComponent(action.sessionId)}`;
}
const panes = [
  ['feedback', 'Feedback'],
  ['data', 'Data'],
  ['drill', 'Next drill'],
] as const;
type Pane = (typeof panes)[number][0];
const outcomes: Record<PreparationAction['task']['status'], string> = {
  open: 'To practise',
  pending: 'Review in progress',
  improved: 'Improvement observed',
  needs_evidence: 'More evidence needed',
  not_comparable: 'Comparison unavailable',
  review_failed: 'Review needs a retry',
  dismissed: 'Dismissed',
};

export function PreparationProgress({
  onFinancials,
  revision,
}: {
  onFinancials: () => void;
  revision: number;
}) {
  const [pane, setPane] = useState<Pane>('feedback');
  const paneId = useId();
  const [data, setData] = useState<Progress | null>(null);
  const [selected, setSelected] = useState<PreparationArea>('profitability');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (!document.hidden) {
        try {
          const result = await request(
            '/preparation-progress',
            preparationProgressSchema,
            undefined,
            'GET',
          );
          if (!cancelled) {
            setData(result);
            setError('');
          }
        } catch {
          if (!cancelled)
            setError('Could not refresh preparation progress. Saved results may be out of date.');
        }
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void load();
        }, 15000);
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [revision, retry]);
  const area = data?.areas.find((item) => item.id === selected);
  return (
    <section className="preparation-progress" aria-labelledby="preparation-progress-title">
      <header className="progress-heading">
        <div>
          <div className="eyebrow">Your preparation, over time</div>
          <h2 id="preparation-progress-title">Know your numbers. Strengthen your answers.</h2>
          <p className="muted">
            Review feedback, inspect the evidence, then choose your next drill.
          </p>
        </div>
        <a className="button secondary" href="/?page=followups">
          All follow-ups <ArrowRight size={15} aria-hidden="true" />
        </a>
      </header>
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Loading your preparation history…</p>}
      {data && area && (
        <>
          <dl className="progress-totals">
            <div>
              <dt>Practices reviewed</dt>
              <dd>{data.reviewedSessions}</dd>
            </div>
            <div>
              <dt>Follow-ups practised</dt>
              <dd>
                {data.counts.practised}
                <small> / {data.counts.followups}</small>
              </dd>
            </div>
            <div>
              <dt>Improvement observed</dt>
              <dd>{data.counts.improved}</dd>
            </div>
            <div>
              <dt>Still needs attention</dt>
              <dd>{data.counts.attention}</dd>
            </div>
          </dl>
          <details className="progress-explainer">
            <summary>How progress is tracked</summary>
            <p className="progress-method">
              From saved practice reviews and their linked written retries. Counts track reviewed
              claims and follow-ups, not a skill score. Improvement requires a saved comparison; a
              new session alone does not establish progress.
            </p>
          </details>
          {(data.pendingSessions > 0 || data.unavailableSessions > 0) && (
            <p className="progress-method">
              <span className="progress-tag tone-review">
                {data.pendingSessions} awaiting review
              </span>{' '}
              <span className="progress-tag">
                {data.unavailableSessions} without a completed review
              </span>
            </p>
          )}
          <div className="progress-workbench">
            <div
              className="progress-areas"
              role="group"
              aria-label="Choose a financial preparation area"
            >
              {data.areas.map((item) => (
                <button
                  key={item.id}
                  className="progress-area"
                  aria-pressed={selected === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="progress-area-title">
                    {item.title}
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                  <span>
                    {item.counts.assessed
                      ? `${item.counts.assessed} claims reviewed`
                      : 'No reviewed claims yet'}
                  </span>
                  <span className="progress-area-outcomes">
                    {item.counts.improved > 0 && (
                      <span>
                        <span className="progress-tag tone-positive">
                          <Check size={13} aria-hidden="true" /> {item.counts.improved} improved
                        </span>
                      </span>
                    )}
                    {item.counts.attention > 0 && (
                      <span className="progress-tag tone-attention">
                        {item.counts.attention} to work on
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="progress-detail">
              <h3>{area.title}</h3>
              <p className="muted">{area.description}</p>
              <div className="progress-tags" aria-label="Topic progress">
                <span className="progress-tag">
                  {area.counts.assessed
                    ? `${area.counts.assessed} claims reviewed`
                    : 'Not assessed yet'}
                </span>
                {area.counts.attention > 0 && (
                  <span className="progress-tag tone-attention">
                    {area.counts.attention} needs attention
                  </span>
                )}
                {area.counts.improved > 0 && (
                  <span className="progress-tag tone-positive">
                    <Check size={13} aria-hidden="true" />
                    {area.counts.improved} improved
                  </span>
                )}
              </div>
              <div className="progress-tabs" role="tablist" aria-label="Preparation details">
                {panes.map(([value, label], index) => (
                  <button
                    key={value}
                    role="tab"
                    id={`${paneId}-tab-${value}`}
                    aria-selected={pane === value}
                    aria-controls={`${paneId}-panel-${value}`}
                    tabIndex={pane === value ? 0 : -1}
                    onClick={() => setPane(value)}
                    onKeyDown={(event) => {
                      let next: number;
                      if (event.key === 'ArrowRight') next = (index + 1) % panes.length;
                      else if (event.key === 'ArrowLeft')
                        next = (index + panes.length - 1) % panes.length;
                      else if (event.key === 'Home') next = 0;
                      else if (event.key === 'End') next = panes.length - 1;
                      else return;
                      event.preventDefault();
                      const target = panes[next];
                      if (target) setPane(target[0]);
                      event.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                        .item(next)
                        .focus();
                    }}
                  >
                    {label}
                    {value !== 'drill' && (
                      <span>{value === 'data' ? area.facts.length : area.actions.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <div
                className="progress-pane"
                role="tabpanel"
                id={`${paneId}-panel-data`}
                aria-labelledby={`${paneId}-tab-data`}
                hidden={pane !== 'data'}
                tabIndex={0}
              >
                <section className="progress-evidence" aria-label="Current financial evidence">
                  <div className="progress-subheading">
                    <h4>
                      <Database size={16} aria-hidden="true" /> Data to drill into
                    </h4>
                    <button className="text-button" onClick={onFinancials}>
                      Open financials ↗
                    </button>
                  </div>
                  {data.currentEvidence.fictional && (
                    <span className="progress-tag tone-demo">Fictional demo evidence</span>
                  )}
                  {area.facts.length ? (
                    <>
                      <dl className="progress-facts">
                        {area.facts.map((fact) => (
                          <div key={fact.id}>
                            <dt>{fact.metric.replaceAll('_', ' ')}</dt>
                            <dd>
                              {fact.value} <small>{fact.unit}</small>
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <div className="progress-tags" aria-label="Statement source">
                        <span className="progress-tag">Current statement</span>
                        <span className="progress-tag">{data.currentEvidence.period}</span>
                        <span className="progress-tag">
                          {data.currentEvidence.fileName} · row {data.currentEvidence.sourceRow}
                        </span>
                      </div>
                      <details className="progress-explainer">
                        <summary>About this evidence</summary>
                        <p className="progress-method">
                          These figures come from the current selected statement. Saved practice
                          reviews retain the evidence captured at the time.
                        </p>
                      </details>
                    </>
                  ) : (
                    <p className="muted">
                      {data.currentEvidence.snapshotId
                        ? 'The selected income statement does not supply a direct metric for this area.'
                        : 'Select a financial statement to see the source figures here.'}
                    </p>
                  )}
                  <h4>Evidence to bring</h4>
                  <ul className="progress-evidence-tags">
                    {area.missingEvidence.map((input) => (
                      <li className="progress-tag tone-attention" key={input}>
                        {input}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
              <div
                className="progress-pane"
                role="tabpanel"
                id={`${paneId}-panel-drill`}
                aria-labelledby={`${paneId}-tab-drill`}
                hidden={pane !== 'drill'}
                tabIndex={0}
              >
                <section className="progress-drill" aria-label="Suggested financial drill">
                  <h4>
                    <Target size={16} aria-hidden="true" /> Your next drill
                  </h4>
                  <p>{area.drill}</p>
                  <a className="button secondary" href={preparationScenarioHref(area.drill)}>
                    Review a scenario for this topic <ArrowRight size={15} aria-hidden="true" />
                  </a>
                  <details className="progress-explainer">
                    <summary>How the next scenario works</summary>
                    <p className="progress-method">
                      Edit the objective, choose an investor and review current sources before
                      generating. Run Check now in Investor research first if you need fresh
                      research.
                    </p>
                  </details>
                </section>
              </div>
              <div
                className="progress-pane"
                role="tabpanel"
                id={`${paneId}-panel-feedback`}
                aria-labelledby={`${paneId}-tab-feedback`}
                hidden={pane !== 'feedback'}
                tabIndex={0}
              >
                <div className="progress-tags" aria-label="Original practice claim checks">
                  <span className="progress-tag">Original answers</span>
                  {area.counts.supported > 0 && (
                    <span className="progress-tag tone-positive">
                      {area.counts.supported} supported
                    </span>
                  )}
                  {area.counts.contradicted > 0 && (
                    <span className="progress-tag tone-attention">
                      {area.counts.contradicted} contradicted
                    </span>
                  )}
                  {area.counts.unresolved > 0 && (
                    <span className="progress-tag">
                      {area.counts.unresolved} unresolved / not checked
                    </span>
                  )}
                </div>
                <details className="progress-explainer">
                  <summary>What these checks mean</summary>
                  <p className="progress-method">
                    Grouped by the financial topic saved in each review. Other topics appear under
                    Evidence & explanation. These counts describe original answers; retries are
                    tracked separately above.
                  </p>
                </details>
                {area.strengths.length > 0 && (
                  <section aria-label="Observed strengths">
                    <h4>What your reviews picked up</h4>
                    {area.strengths.map((strength, index) => (
                      <details className="progress-finding" key={index}>
                        <summary>
                          <span className="progress-finding-title">{strength.statement}</span>
                          <span className="progress-tags">
                            <span className="progress-tag tone-positive">Observed strength</span>
                            <span className="progress-tag">{date(strength.createdAt)}</span>
                            {strength.fictional && (
                              <span className="progress-tag tone-demo">
                                Fictional demo evidence
                              </span>
                            )}
                            {strength.partial && (
                              <span className="progress-tag">Partial practice</span>
                            )}
                          </span>
                        </summary>
                        <blockquote>{strength.quote}</blockquote>
                      </details>
                    ))}
                  </section>
                )}
                <section aria-label="Saved feedback to work on">
                  <h4>Feedback to work on</h4>
                  {!area.actions.length && (
                    <p className="muted">
                      {area.counts.assessed
                        ? 'No active follow-up is saved for this area. Use the drill to explore it further.'
                        : 'Practise this topic to build a review history. Missing assessment does not mean poor performance.'}
                    </p>
                  )}
                  {area.actions.map((action) => (
                    <details
                      className="progress-finding"
                      key={`${action.sessionId}:${action.task.id}`}
                    >
                      <summary>
                        <span className="progress-finding-title">{action.task.title}</span>
                        <span className="progress-tags">
                          <span
                            className={`progress-tag tone-${action.task.status === 'improved' ? 'positive' : action.task.status === 'pending' ? 'review' : 'attention'}`}
                          >
                            {outcomes[action.task.status]}
                          </span>
                          {action.task.retrySessionId && (
                            <span className="progress-tag tone-positive">
                              <Check size={12} aria-hidden="true" />
                              Practised
                            </span>
                          )}
                          <span className="progress-tag">{date(action.createdAt)}</span>
                          {action.fictional && (
                            <span className="progress-tag tone-demo">Fictional demo</span>
                          )}
                          {action.partial && <span className="progress-tag">Partial session</span>}
                        </span>
                      </summary>
                      {action.snapshotId !== data.currentEvidence.snapshotId && (
                        <span className="progress-tag tone-review">
                          Different financial snapshot
                        </span>
                      )}
                      <p>{action.task.gap}</p>
                      {action.task.quote && (
                        <blockquote>
                          <strong>Your answer:</strong> “{action.task.quote}”
                        </blockquote>
                      )}
                      {action.interpretation && (
                        <p>
                          <strong>Financial interpretation:</strong> {action.interpretation}
                        </p>
                      )}
                      {action.implication && (
                        <p>
                          <strong>Why it matters:</strong> {action.implication}
                        </p>
                      )}
                      <ol>
                        {action.task.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                      {action.task.missingInputs.length > 0 && (
                        <>
                          <h4>Evidence to gather</h4>
                          <ul className="progress-evidence-tags">
                            {action.task.missingInputs.map((input) => (
                              <li className="progress-tag tone-attention" key={input}>
                                {input}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {action.task.comparison && (
                        <p>
                          <strong>Latest comparison:</strong> {action.task.comparison}
                        </p>
                      )}
                      <div className="progress-actions">
                        <a
                          className="button secondary"
                          href={followupHref({
                            sessionId: action.sessionId,
                            offset: action.offset,
                            taskId: action.task.id,
                          })}
                        >
                          Inspect evidence & retry
                        </a>
                        <a
                          className="button"
                          href={preparationScenarioHref(
                            followupObjective(action.task),
                            action.investorId,
                          )}
                        >
                          Review next scenario
                        </a>
                      </div>
                    </details>
                  ))}
                  {area.counts.followups > area.actions.length && (
                    <p className="progress-method">
                      Showing up to three non-dismissed follow-ups, prioritizing items that need
                      attention. All {area.counts.followups} follow-ups, including dismissals,
                      remain in history.
                    </p>
                  )}
                </section>
              </div>
            </div>
          </div>
          {data.recentSessions.length > 0 && (
            <details className="progress-history">
              <summary>Recent practice history · latest {data.recentSessions.length}</summary>
              <ol>
                {data.recentSessions.map((session) => (
                  <li key={session.id}>
                    <div>
                      <a href={followupHref({ sessionId: session.id, offset: session.offset })}>
                        {session.scenario}
                      </a>
                      <p className="progress-method">
                        {date(session.createdAt)} · {session.fictional ? 'Fictional demo · ' : ''}
                        {session.partial ? 'Partial session · ' : ''}
                        {session.reviewStatus === 'ready'
                          ? `${session.counts.practised} retries saved · ${session.counts.improved} follow-ups with improvement observed`
                          : session.reviewStatus.replaceAll('_', ' ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="progress-method">
                Different sessions can cover different topics and evidence. These entries are not a
                comparable performance score.
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
