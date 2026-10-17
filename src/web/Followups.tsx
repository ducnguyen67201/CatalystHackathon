import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Circle } from 'lucide-react';
import { z } from 'zod';
import {
  followupsResponseSchema,
  type FollowupSession,
  type FollowupTask,
  type FollowupsResponse,
} from '../contracts/Followups.js';
import { request } from './ApiClient.js';
import { EvaluationPanel } from './EvaluationPanel.js';
import './Followups.css';

const statuses: Record<FollowupTask['status'], string> = {
  open: 'To practise',
  dismissed: 'Dismissed',
  pending: 'In review',
  improved: 'Improvement observed',
  needs_evidence: 'Needs evidence',
  not_comparable: 'Comparison unavailable',
  review_failed: 'Review needs a retry',
};
const reviewMessages: Record<FollowupSession['reviewStatus'], string> = {
  awaiting_transcript:
    'Waiting for the final transcript. Your next steps will appear after the review finishes.',
  queued: 'Reviewing your transcript and scenario evidence…',
  failed:
    'The review could not finish. Open the saved review to retry; your transcript is preserved.',
  skipped: 'This practice could not be assessed. Open the saved review for details.',
  unavailable:
    'This older practice has no saved evaluation. Start a new practice to get next steps.',
  ready:
    'No specific follow-ups were identified in this review. This does not establish that every claim is correct.',
};
const when = (value: string) => new Date(value).toLocaleString();

function PracticeTask({
  session,
  task,
  refresh,
  onFinancials,
}: {
  session: FollowupSession;
  task: FollowupTask;
  refresh: () => void;
  onFinancials: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [editing, setEditing] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef(new Map<string, string>());
  async function respond(kind: 'practice' | 'dismissed') {
    if (!session.evaluationId) return;
    setBusy(true);
    setError('');
    const text = kind === 'practice' ? answer.trim() : '';
    const key = JSON.stringify([kind, text]);
    const requestKey = keys.current.get(key) ?? crypto.randomUUID();
    keys.current.set(key, requestKey);
    try {
      await request(
        `/rehearsals/${encodeURIComponent(session.id)}/evaluations/${encodeURIComponent(session.evaluationId)}/responses`,
        z.object({ id: z.string() }),
        {
          itemId: task.id,
          kind,
          text,
          requestKey,
        },
      );
      setEditing(false);
      refresh();
    } catch {
      setError('Could not save your response. Your answer is still here; try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="followup-task">
      <span className="section-label">{statuses[task.status]}</span>
      <h3>{task.title}</h3>
      <p>{task.gap}</p>
      {task.quote && (
        <blockquote>
          <strong>From your answer:</strong> “{task.quote}”
        </blockquote>
      )}
      <h4>Before your next attempt</h4>
      <ol>
        {task.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      {task.missingInputs.length > 0 && (
        <p>
          <strong>Evidence to gather:</strong> {task.missingInputs.join(' · ')}
        </p>
      )}
      <details>
        <summary>Evidence used in this review</summary>
        {task.facts.map((fact) => (
          <p key={fact.id}>
            {fact.metric.replaceAll('_', ' ')}: {fact.value} {fact.unit} · {fact.period}
          </p>
        ))}
        {task.sources.map((source) => (
          <div key={source.id}>
            <p>
              <strong>{source.title}</strong> ·{' '}
              {source.origin === 'fictional'
                ? 'Fictional demo evidence'
                : source.origin.replaceAll('_', ' ')}
            </p>
            {source.kind !== 'financial' && <p>{source.text}</p>}
            {source.url && /^https?:/.test(source.url) && (
              <a href={source.url} target="_blank" rel="noreferrer">
                Open source
              </a>
            )}
          </div>
        ))}
        {!task.sources.length && (
          <p>This suggestion is based on your transcript; no supporting source is cited.</p>
        )}
      </details>
      {task.comparison && (
        <p className="followup-comparison">
          <strong>Latest response:</strong> {task.comparison}
        </p>
      )}
      {task.status !== 'dismissed' && (
        <div className="actions">
          <button className="button" disabled={busy} onClick={() => setEditing(!editing)}>
            {editing ? 'Close answer' : 'Practise this answer'}
          </button>
          {(task.facts.length > 0 || task.sources.some((s) => s.kind === 'financial')) && (
            <button className="button secondary" onClick={onFinancials}>
              Open financials
            </button>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void respond('dismissed')}
          >
            Dismiss suggestion
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void respond('practice');
          }}
        >
          <h4>{task.practiceQuestion}</h4>
          <ul>
            {task.successCriteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
          <label>
            Your revised answer
            <textarea
              maxLength={3000}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <button className="button" disabled={busy || !answer.trim()}>
            {busy ? 'Saving…' : 'Evaluate this answer'}
          </button>
          <p className="muted">
            Reviewed against the evidence saved with this call. New investor updates below are
            separate preparation.
          </p>
        </form>
      )}
      {task.retrySessionId && (
        <details onToggle={(event) => setShowRetry(event.currentTarget.open)}>
          <summary>Open written retry and feedback</summary>
          {showRetry && <EvaluationPanel sessionId={task.retrySessionId} receipt="written" />}
        </details>
      )}
    </article>
  );
}

type TaskFilter = 'all' | 'attention' | 'practised' | 'dismissed';
const needsAttention = (task: FollowupTask) =>
  !['dismissed', 'improved', 'pending'].includes(task.status);

function PracticeTaskRow(props: Parameters<typeof PracticeTask>[0]) {
  const { task } = props;
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <Fragment>
      <tr className={open ? 'followup-row is-open' : 'followup-row'}>
        <th scope="row" className="followup-title-cell">
          <button
            className="followup-row-toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={16} aria-hidden="true" />
            <span>{task.title}</span>
          </button>
        </th>
        <td>
          <span className={`followup-practised ${task.retrySessionId ? 'is-practised' : ''}`}>
            {task.retrySessionId ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Circle size={14} aria-hidden="true" />
            )}
            {task.retrySessionId ? 'Practised' : 'Not yet'}
          </span>
        </td>
        <td>
          <span className={`followup-status status-${task.status}`}>{statuses[task.status]}</span>
        </td>
        <td className="followup-action-cell">
          <button
            className="button secondary"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Close details' : task.status === 'open' ? 'View & practise' : 'View details'}
          </button>
        </td>
      </tr>
      <tr hidden={!open} id={detailId} className="followup-detail-row">
        <td colSpan={4}>
          <PracticeTask {...props} />
        </td>
      </tr>
    </Fragment>
  );
}

export function PracticeFollowups({ onFinancials }: { onFinancials: () => void }) {
  const [data, setData] = useState<FollowupsResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [openReviews, setOpenReviews] = useState<Record<string, boolean>>({});
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (!document.hidden) {
        try {
          const result = await request(
            `/followups?offset=${offset}`,
            followupsResponseSchema,
            undefined,
            'GET',
          );
          if (cancelled) return;
          setData(result);
          setError('');
        } catch {
          if (!cancelled)
            setError('Could not refresh next steps. Previously loaded results may be out of date.');
        }
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void load();
        }, 8000);
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [offset, revision]);
  function move(next: number) {
    setData(null);
    setOffset(next);
  }
  const tasks = data?.sessions.flatMap((session) => session.tasks) ?? [];
  const counts = {
    all: tasks.length,
    attention: tasks.filter(needsAttention).length,
    practised: tasks.filter((task) => task.retrySessionId !== null).length,
    dismissed: tasks.filter((task) => task.status === 'dismissed').length,
  };
  const matchesFilter = (task: FollowupTask) =>
    filter === 'all' ||
    (filter === 'attention' && needsAttention(task)) ||
    (filter === 'practised' && task.retrySessionId !== null) ||
    (filter === 'dismissed' && task.status === 'dismissed');
  const visibleSessions = data?.sessions.filter(
    (session) => filter === 'all' || session.tasks.some(matchesFilter),
  );
  return (
    <section className="practice-followups" aria-label="Practice next steps">
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="button secondary" onClick={refresh}>
            Retry loading
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Loading your next steps…</p>}
      {data?.sessions.length === 0 && (
        <div className="panel empty-signal">
          <h2>Your next practice starts here.</h2>
          <p>
            Finish a practice call or guided text session. June will use the saved transcript and
            scenario evidence to suggest what to work on next.
          </p>
          <a className="button" href="/scenarios">
            Choose a practice scenario
          </a>
        </div>
      )}
      {data && tasks.length > 0 && (
        <div className="followup-overview">
          <div className="followup-overview-heading">
            <div>
              <h2>Practice progress</h2>
              <p className="muted">
                A check means you submitted a written retry. Review outcomes show what changed.
              </p>
            </div>
            <span className="followup-page-count">
              {counts.practised} of {counts.all} practised · this page
            </span>
          </div>
          <div
            className="followup-filters"
            role="group"
            aria-label="Filter follow-ups on this page"
          >
            {(
              [
                ['all', 'All follow-ups'],
                ['attention', 'Needs attention'],
                ['practised', 'Practised'],
                ['dismissed', 'Dismissed'],
              ] as const
            ).map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label} <span>{counts[value]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {data && data.sessions.length > 0 && visibleSessions?.length === 0 && (
        <div className="panel empty-signal">
          <h2>No matching follow-ups on this page.</h2>
          <button className="button secondary" onClick={() => setFilter('all')}>
            Show all follow-ups
          </button>
        </div>
      )}
      {visibleSessions?.map((session) => (
        <section className="panel followup-session" key={session.id}>
          <div className="eyebrow">
            {session.investorName ?? 'Open practice'} · {when(session.createdAt)}
          </div>
          <h2>{session.scenario}</h2>
          {session.fictional && (
            <p className="followup-label">Includes fictional demo evidence or a demo scenario</p>
          )}
          {session.partial && (
            <p className="muted">Partial session — follow-ups cover only the saved transcript.</p>
          )}
          {session.contextAt && (
            <p className="muted">
              Scenario evidence saved {when(session.contextAt)}. AI coaching — check the cited
              evidence.
            </p>
          )}
          {!session.tasks.length && <p role="status">{reviewMessages[session.reviewStatus]}</p>}
          {session.tasks.length > 0 && (
            <div
              className="followup-table-scroll"
              role="region"
              aria-label={`Follow-ups for ${session.scenario}`}
              tabIndex={0}
            >
              <table className="followup-table">
                <caption className="followup-table-caption">
                  Next steps · {session.tasks.filter(matchesFilter).length} shown
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Follow-up</th>
                    <th scope="col">Practice</th>
                    <th scope="col">Review outcome</th>
                    <th scope="col">
                      <span className="followup-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {session.tasks.filter(matchesFilter).map((task) => (
                    <PracticeTaskRow
                      key={`${session.evaluationId}:${task.id}`}
                      session={session}
                      task={task}
                      refresh={refresh}
                      onFinancials={onFinancials}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {session.evaluationId && (
            <details
              className="followup-review"
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpenReviews((values) => ({ ...values, [session.id]: open }));
              }}
            >
              <summary>Open the saved call review</summary>
              {openReviews[session.id] && (
                <EvaluationPanel sessionId={session.id} receipt="saved" />
              )}
            </details>
          )}
          {session.investorUpdates.length > 0 && (
            <section className="followup-updates" aria-label="Investor updates since this scenario">
              <h3>New research since this scenario</h3>
              <p>
                These updates were found after the scenario evidence was saved. They were not used
                to assess your call. Publication dates may be earlier.
              </p>
              {session.investorUpdates.map((update) => (
                <article className="followup-task" key={update.id}>
                  <span className="section-label">
                    {update.fictional
                      ? 'Fictional demo update'
                      : update.needsReview
                        ? 'Identity or source needs review'
                        : 'Public research — unverified'}
                  </span>
                  <h4>{update.title}</h4>
                  <p>
                    <strong>{update.headline}</strong>
                  </p>
                  <p>{update.summary}</p>
                  <p className="muted">
                    Found {when(update.observedAt)} · Published / occurred:{' '}
                    {update.occurredAt ?? 'Unknown'}
                  </p>
                  <blockquote>{update.quote}</blockquote>
                  <ol>
                    {update.steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                  <div className="actions">
                    {update.url && /^https?:/.test(update.url) && (
                      <a
                        className="button secondary"
                        href={update.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read source
                      </a>
                    )}
                    <a
                      className="button secondary"
                      href={`/?radarEvent=${encodeURIComponent(update.id)}`}
                    >
                      View radar update
                    </a>
                  </div>
                </article>
              ))}
              {session.additionalUpdates > 0 && (
                <p>{session.additionalUpdates} more updates available in Investor radar.</p>
              )}
              <a
                className="button"
                href={`/scenarios?investor=${encodeURIComponent(session.investorId ?? '')}`}
              >
                Prepare an updated scenario
              </a>
            </section>
          )}
        </section>
      ))}
      {data && (offset > 0 || data.nextOffset !== null) && (
        <nav className="actions" aria-label="Practice history pages">
          <button
            className="button secondary"
            disabled={offset === 0}
            onClick={() => move(Math.max(0, offset - 10))}
          >
            Newer practices
          </button>
          <button
            className="button secondary"
            disabled={data.nextOffset === null}
            onClick={() => {
              if (data.nextOffset !== null) move(data.nextOffset);
            }}
          >
            Older practices
          </button>
        </nav>
      )}
    </section>
  );
}
