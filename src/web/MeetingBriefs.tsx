import { ConnectedPreparationBriefs } from './ConnectedPreparationBriefs.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw, Search, X } from 'lucide-react';
import type { Brief, Rehearsal, StateResponse } from '../contracts/Workspace.js';
import { fictionalFinancialHashes } from '../contracts/FinancialProvenance.js';
import { ResearchLinks } from './DashboardPage.js';
import { EvaluationPanel } from './EvaluationPanel.js';
import './MeetingBriefs.css';

type Workspace = StateResponse['workspace'];
type Selection = { kind: 'brief' | 'practice'; id: string };
export function linkedBriefPractices(brief: Brief, workspace: Workspace): Rehearsal[] {
  const ids = new Set([brief.id]);
  let current = brief;
  // Reviewed revisions retain the original practice's brief ID. Ordinary refreshes are separate briefs.
  while (current.review && current.previousBriefId && !ids.has(current.previousBriefId)) {
    const previous = workspace.briefs.find((item) => item.id === current.previousBriefId);
    if (
      !previous ||
      previous.snapshotId !== brief.snapshotId ||
      previous.profileVersion !== brief.profileVersion ||
      previous.investor !== brief.investor
    )
      break;
    ids.add(previous.id);
    current = previous;
  }
  return workspace.rehearsals
    .filter((session) => session.briefId !== null && ids.has(session.briefId))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function practiceInvestor(session: Rehearsal, workspace: Workspace): string {
  const brief = workspace.briefs.find((item) => item.id === session.briefId);
  return (
    brief?.investor ??
    (session.context?.version === 2
      ? session.context.input.investor.name
      : session.context?.investor?.name) ??
    'Open practice'
  );
}
const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const money = (value: string) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));

export function MeetingBriefs({
  state,
  initialBriefId,
  busy,
  onCloseSelection,
  onRefreshBrief,
  onPractice,
  onFollowup,
}: {
  state: StateResponse;
  initialBriefId: string | null;
  busy: boolean;
  onCloseSelection: () => void;
  onRefreshBrief: () => void;
  onPractice: (id: string) => void;
  onFollowup: (id: string) => void;
}) {
  const workspace = state.workspace;
  const [selection, setSelection] = useState<Selection | null>(() =>
    initialBriefId ? { kind: 'brief', id: initialBriefId } : null,
  );
  const [filter, setFilter] = useState<'brief' | 'practice'>('brief');
  const [query, setQuery] = useState('');
  const [connectedBriefCount, setConnectedBriefCount] = useState(0);
  const [newestFirst, setNewestFirst] = useState(true);
  const rows =
    filter === 'brief'
      ? workspace.briefs.map((brief) => ({
          id: brief.id,
          title: brief.finding.question,
          investor: brief.investor,
          date: brief.createdAt,
          status: brief.review ? 'Practice incorporated' : 'Prepared',
          detail: `${linkedBriefPractices(brief, workspace).length} linked practices`,
        }))
      : workspace.rehearsals.map((session) => ({
          id: session.id,
          title:
            session.context?.scenario?.objective ??
            workspace.briefs.find((brief) => brief.id === session.briefId)?.finding.question ??
            'Practice conversation',
          investor: practiceInvestor(session, workspace),
          date: session.createdAt,
          status: session.status.replaceAll('_', ' '),
          detail: `${session.mode === 'liveavatar' ? 'Video' : session.mode === 'elevenlabs' ? 'Voice' : 'Written'} · ${session.turns.length} turns`,
        }));
  const matches = rows
    .filter((row) =>
      `${row.title} ${row.investor} ${row.status}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        (newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) ||
        a.id.localeCompare(b.id),
    );
  const close = () => {
    setSelection(null);
    onCloseSelection();
  };
  return (
    <section className="meeting-briefs" aria-label="Meeting briefs and practice reviews">
      <header className="page-heading">
        <div>
          <div className="eyebrow">Prepare, practise, reflect</div>
          <h1>Meeting briefs</h1>
          <p className="muted">
            Your meeting context and saved conversations, with the evidence close at hand.
          </p>
        </div>
        <button className="button secondary" disabled={busy} onClick={onRefreshBrief}>
          <RefreshCw size={14} /> Refresh brief
        </button>
      </header>
      <ConnectedPreparationBriefs state={state} onCount={setConnectedBriefCount} />
      <div className="meeting-table-toolbar">
        <div className="meeting-view-switch" role="group" aria-label="Record type">
          <button aria-pressed={filter === 'brief'} onClick={() => setFilter('brief')}>
            {connectedBriefCount ? 'Other meeting briefs' : 'Meeting briefs'}{' '}
            <span>{workspace.briefs.length}</span>
          </button>
          <button aria-pressed={filter === 'practice'} onClick={() => setFilter('practice')}>
            Practice reviews <span>{workspace.rehearsals.length}</span>
          </button>
        </div>
        <label className="meeting-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search meeting records</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search investor or question…"
          />
        </label>
      </div>
      <div className="meeting-table-scroll">
        <table className="meeting-table">
          <caption className="sr-only">
            {filter === 'brief' ? 'Saved meeting briefs' : 'Saved practice conversations'}. Select a
            row to inspect it.
          </caption>
          <thead>
            <tr>
              <th scope="col">{filter === 'brief' ? 'Question to prepare' : 'Conversation'}</th>
              <th scope="col">Investor</th>
              <th scope="col">Status</th>
              <th scope="col">Context</th>
              <th scope="col" aria-sort={newestFirst ? 'descending' : 'ascending'}>
                <button onClick={() => setNewestFirst((value) => !value)}>
                  Created {newestFirst ? '↓' : '↑'}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((row) => (
              <tr
                key={row.id}
                className={selection?.id === row.id && selection.kind === filter ? 'selected' : ''}
                onClick={(event) => {
                  event.currentTarget.querySelector('button')?.focus();
                  setSelection({ kind: filter, id: row.id });
                }}
              >
                <td>
                  <button
                    className="meeting-row-title"
                    aria-haspopup="dialog"
                    onClick={() => setSelection({ kind: filter, id: row.id })}
                  >
                    {row.title}
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </td>
                <td>{row.investor}</td>
                <td>
                  <span className="meeting-record-status">{row.status}</span>
                </td>
                <td>{row.detail}</td>
                <td>
                  <time dateTime={row.date}>{dateLabel(row.date)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!matches.length && (
        <div className="meeting-table-empty">
          <h3>
            {query
              ? 'No matching records'
              : filter === 'brief'
                ? connectedBriefCount
                  ? 'No other meeting briefs'
                  : 'Prepare your first brief'
                : 'Your conversations will appear here'}
          </h3>
          <p>
            {query
              ? 'Try another investor name or question.'
              : filter === 'brief'
                ? connectedBriefCount
                  ? 'Your checklist briefs and their next actions are shown above.'
                  : 'Create a brief from your current financial evidence.'
                : 'Finish a practice to inspect its saved transcript and evaluation.'}
          </p>
          {!query && filter === 'brief' && (
            <button className="button" disabled={busy} onClick={onRefreshBrief}>
              {connectedBriefCount ? 'Create another brief' : 'Create brief'}
            </button>
          )}
        </div>
      )}
      <p className="muted meeting-table-footer">
        {matches.length} {filter === 'brief' ? 'briefs' : 'practices'} · Select a row to open its
        details.
      </p>
      {selection && (
        <MeetingReviewDrawer
          key={`${selection.kind}:${selection.id}`}
          selection={selection}
          workspace={workspace}
          busy={busy}
          onClose={close}
          onPractice={onPractice}
          onFollowup={onFollowup}
        />
      )}
    </section>
  );
}

function MeetingReviewDrawer({
  selection,
  workspace,
  busy,
  onClose,
  onPractice,
  onFollowup,
}: {
  selection: Selection;
  workspace: Workspace;
  busy: boolean;
  onClose: () => void;
  onPractice: (id: string) => void;
  onFollowup: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const brief =
    selection.kind === 'brief'
      ? workspace.briefs.find((item) => item.id === selection.id)
      : undefined;
  const practices = brief ? linkedBriefPractices(brief, workspace) : [];
  const [practiceId, setPracticeId] = useState<string | null>(
    selection.kind === 'practice' ? selection.id : null,
  );
  const [view, setView] = useState<'brief' | 'review'>(
    selection.kind === 'brief' ? 'brief' : 'review',
  );
  const session = workspace.rehearsals.find(
    (item) =>
      item.id === practiceId &&
      (selection.kind === 'practice' || practices.some((practice) => practice.id === item.id)),
  );
  const snapshot = workspace.snapshots.find((item) => item.id === brief?.snapshotId);
  const evidence = workspace.evidence.find((item) => item.id === brief?.evidenceId);
  const stale =
    brief &&
    (brief.profileVersion !== workspace.profile.version ||
      brief.snapshotId !== workspace.onboarding.snapshotId ||
      JSON.stringify(brief.meeting) !== JSON.stringify(workspace.onboarding.meeting));
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="meeting-review-drawer"
      aria-labelledby="meeting-drawer-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="meeting-drawer-header">
        <div>
          <div className="eyebrow">
            {selection.kind === 'brief' ? 'Meeting brief' : 'Practice review'}
          </div>
          <h2 id="meeting-drawer-title">
            {brief?.investor ?? (session ? practiceInvestor(session, workspace) : 'Saved record')}
          </h2>
          <p>
            {brief
              ? dateLabel(brief.createdAt)
              : session
                ? dateLabel(session.createdAt)
                : 'Record unavailable'}
          </p>
        </div>
        <button className="close" aria-label="Close meeting details" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="meeting-drawer-body">
        {brief && (
          <div className="meeting-view-switch" role="group" aria-label="Brief detail views">
            <button aria-pressed={view === 'brief'} onClick={() => setView('brief')}>
              Meeting context
            </button>
            <button
              aria-pressed={view === 'review'}
              onClick={() => {
                setView('review');
                setPracticeId(practiceId ?? practices[0]?.id ?? null);
              }}
            >
              Practice and feedback <span>{practices.length}</span>
            </button>
          </div>
        )}
        {brief && view === 'brief' && (
          <>
            {stale && (
              <p className="notice">
                This brief retains earlier inputs. Refresh the brief from the table to prepare with
                current data.
              </p>
            )}
            {snapshot && fictionalFinancialHashes.has(snapshot.hash) && (
              <p className="notice">Fictional demo financial evidence</p>
            )}
            <section className="meeting-brief-question">
              <div className="eyebrow">A question to prepare for</div>
              <h3>{brief.finding.question}</h3>
              <p>
                This question comes from the saved financial evidence; investor-specific preferences
                require sourced research.
              </p>
            </section>
            <section className="meeting-detail-section">
              <h3>Follow the numbers · {brief.finding.month}</h3>
              <dl className="meeting-brief-values">
                {[
                  ['Operating income', brief.finding.operatingIncome],
                  ['Other income · SR&ED credit', brief.finding.credit],
                  ['Reported net income', brief.finding.netIncome],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {value ? money(value) : '—'} {snapshot?.currency ?? 'currency unknown'}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="muted">
                {snapshot?.fileName ?? 'Statement unavailable'} · CSV row {brief.finding.sourceRow}{' '}
                · Profile version {brief.profileVersion}
              </p>
              <p className="grounded-answer">{brief.finding.answer}</p>
            </section>
            <section className="meeting-detail-section">
              <h3>What still needs an answer</h3>
              <ul>
                {brief.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </section>
            <ResearchLinks meeting={brief.meeting} />
            {brief.meeting?.notes && (
              <section className="meeting-detail-section">
                <h3>Meeting notes</h3>
                <p className="preserve-lines">{brief.meeting.notes}</p>
                <small>Founder-provided · saved with this brief</small>
              </section>
            )}
            {evidence && (
              <section className="meeting-detail-section">
                <h3>Research evidence</h3>
                <p>{evidence.explanation}</p>
                <p className="muted">
                  {evidence.mode === 'demo'
                    ? 'Fictional demo'
                    : evidence.verified
                      ? 'Marked verified'
                      : 'Unverified public research'}
                </p>
                <blockquote>{evidence.excerpt}</blockquote>
                {evidence.url && /^https?:/.test(evidence.url) && (
                  <a href={evidence.url} target="_blank" rel="noopener noreferrer">
                    Open original source
                  </a>
                )}
              </section>
            )}
            {brief.review && (
              <section className="meeting-detail-section">
                <h3>Earlier rehearsal notes</h3>
                <blockquote>{brief.review.answer}</blockquote>
                <p>{brief.review.note}</p>
                <p>
                  {brief.review.missing.length
                    ? `Open themes: ${brief.review.missing.join(', ')}`
                    : 'Expected themes appeared; this does not certify the financial figures.'}
                </p>
              </section>
            )}
            <div className="actions">
              <button
                className="button"
                onClick={() => {
                  onClose();
                  onPractice(brief.id);
                }}
              >
                Practice this question <ArrowRight size={14} />
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => onFollowup(brief.id)}
              >
                Track a follow-up
              </button>
            </div>
          </>
        )}
        {view === 'review' && (
          <>
            {brief && practices.length > 0 && (
              <label className="meeting-practice-picker">
                Saved practice
                <select
                  value={practiceId ?? ''}
                  onChange={(event) => setPracticeId(event.target.value)}
                >
                  {practices.map((practice) => (
                    <option key={practice.id} value={practice.id}>
                      {dateLabel(practice.createdAt)} · {practice.mode} · {practice.status}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!session && (
              <p className="notice">
                No practice is linked to this brief yet. Other conversations are available in the
                table’s Practice reviews view.
              </p>
            )}
            {session && (
              <>
                <p className="muted">
                  {session.mode} · {session.status.replaceAll('_', ' ')} · {session.turns.length}{' '}
                  saved turns
                </p>
                <MeetingPracticeReview key={session.id} session={session} />
              </>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}

function MeetingPracticeReview({ session }: { session: Rehearsal }) {
  return (
    <EvaluationPanel
      sessionId={session.id}
      receipt={session.transcriptReceivedAt ?? (session.mode === 'text' ? 'written' : null)}
      fallbackTurns={session.turns}
      transcriptFirst
    />
  );
}
