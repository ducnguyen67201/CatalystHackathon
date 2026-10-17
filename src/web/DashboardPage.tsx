import { PreparationProgress } from './PreparationProgress.js';
import { PeerDashboard } from './PeerDashboard.js';
import { ArrowRight, FileText, MessageSquare, ExternalLink } from 'lucide-react';
import type { StateResponse } from '../contracts/Workspace.js';
import type { Meeting } from '../contracts/Onboarding.js';

type Props = {
  state: StateResponse;
  onEdit: () => void;
  onRestart: () => void;
  onPrepare: () => void;
  onFinancials: () => void;
  onResearch: () => void;
  onPractice: () => void;
  busy: boolean;
};

function formatAmount(value: string): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value));
}

export function ResearchLinks({ meeting }: { meeting: Meeting | null }) {
  if (!meeting) {
    return null;
  }
  const links = [
    ['LinkedIn', meeting.links.linkedin],
    ['X profile', meeting.links.x],
    ['Firm website', meeting.links.website],
  ];
  return (
    <section className="research-links">
      <h3>Research starting points</h3>
      {links.some(([, url]) => url) ? (
        <ul>
          {links.map(([label, url]) =>
            url ? (
              <li key={label}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {label}
                  <ExternalLink size={13} />
                </a>
                <span>{new URL(url).hostname}</span>
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <p className="muted">No profile links added yet.</p>
      )}
      <p className="footnote">
        Founder-provided links. Research results appear separately with their source passages.
      </p>
    </section>
  );
}

export function DashboardPage({
  state,
  onEdit,
  onRestart,
  onPrepare,
  onFinancials,
  onResearch,
  onPractice,
  busy,
}: Props) {
  const workspace = state.workspace;
  const snapshot =
    workspace.snapshots.find((item) => item.id === workspace.onboarding.snapshotId) ??
    workspace.snapshots.at(-1);
  const row = snapshot?.rows.at(-1);
  const finding = workspace.briefs
    .filter((item) => item.snapshotId === snapshot?.id)
    .at(-1)?.finding;
  const meeting = workspace.onboarding.meeting;
  const lastPractice = workspace.rehearsals.at(-1);
  const investor = workspace.investors.find((item) => item.id === meeting?.investorId);
  const check = investor?.checks.at(-1);
  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your founder workspace</div>
          <h1>Make your next conversation count.</h1>
          <p className="muted">
            {workspace.profile.name} · Financial evidence, a clear story, and a little practice.
          </p>
        </div>
        <div className="dashboard-setup-actions">
          <button className="button secondary" onClick={onEdit} disabled={busy}>
            Edit context
          </button>
          <button
            className="text-button"
            onClick={onRestart}
            disabled={busy}
            title="Return to step 1. Saved data and history are kept."
          >
            Restart onboarding
          </button>
        </div>
      </div>
      <div className="dashboard-hero-grid">
        <article className="conversation-card">
          <div className="eyebrow">
            ↗ {meeting ? 'Your next conversation' : 'Your first rehearsal'}
          </div>
          <h2>{meeting?.name || meeting?.firm || 'Start with your financial story.'}</h2>
          <p>
            {meeting?.firm ? `${meeting.firm} · ` : ''}
            {workspace.profile.goal || 'Prepare to explain your numbers clearly.'}
          </p>
          <dl className="meeting-facts">
            <div>
              <dt>When</dt>
              <dd>
                {meeting?.date
                  ? new Date(`${meeting.date}T12:00:00`).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'At your own pace'}
              </dd>
            </div>
            <div>
              <dt>Preparation</dt>
              <dd>{finding ? 'Financial scenario ready' : 'Add financials'}</dd>
            </div>
            <div>
              <dt>Data through</dt>
              <dd>{row?.month ?? 'Not uploaded'}</dd>
            </div>
          </dl>
          <div className="conversation-action">
            <span>Your brief connects the numbers with the questions behind them.</span>
            <button className="button" disabled={busy || !finding} onClick={onPrepare}>
              Prepare for {meeting ? 'this meeting' : 'practice'} <ArrowRight size={16} />
            </button>
          </div>
        </article>
        <article className="financial-focus">
          <div className="eyebrow">Worth preparing for</div>
          <h2>{finding ? 'There’s a story behind the numbers.' : 'Start with the evidence.'}</h2>
          <p>
            {finding?.question ??
              'Upload a monthly income statement to prepare a sourced financial explanation.'}
          </p>
          <button className="text-button" onClick={onFinancials}>
            See the evidence ↗
          </button>
        </article>
      </div>
      <div className="dashboard-section-heading">
        <h3>Your financial position</h3>
        <button className="text-button" onClick={onFinancials}>
          View financials ↗
        </button>
      </div>
      <div className="dashboard-metrics">
        <article>
          <span>Revenue · {row?.month ?? 'Unknown period'}</span>
          <strong>{row ? formatAmount(row.revenue) : 'Unknown'}</strong>
          <small>Statement currency: {snapshot?.currency ?? 'unspecified'}</small>
        </article>
        <article>
          <span>Operating result · {row?.month ?? 'Unknown period'}</span>
          <strong>{row ? formatAmount(row.operatingIncome) : 'Unknown'}</strong>
          <small>Before other income · {snapshot?.currency ?? 'unspecified'}</small>
        </article>
        <article>
          <span>Cash runway</span>
          <strong>Still unknown</strong>
          <small>Cash balance and cash-flow plan needed</small>
        </article>
      </div>
      <PreparationProgress onFinancials={onFinancials} revision={workspace.revision} />
      <PeerDashboard key={`${snapshot?.id ?? 'none'}:${workspace.profile.version}`} />
      <div className="dashboard-lower">
        <section>
          <div className="dashboard-section-heading">
            <h3>What changed</h3>
            <span className="muted">Your preparation timeline</span>
          </div>
          <div className="dashboard-activity">
            <FileText size={19} />
            <div>
              <strong>{snapshot?.fileName ?? 'No statement yet'}</strong>
              <p>{snapshot?.rows.length ?? 0} months saved. Source rows remain available.</p>
            </div>
          </div>
          {meeting?.notes && (
            <div className="dashboard-activity">
              <MessageSquare size={19} />
              <div>
                <strong>A question to prepare for</strong>
                <p>{meeting.notes}</p>
              </div>
            </div>
          )}
          <div className="dashboard-activity">
            <ArrowRight size={19} />
            <div>
              <strong>{check ? 'Investor research updated' : 'Your investor research'}</strong>
              <p>
                {check?.note ??
                  (investor
                    ? 'Profile saved. Run a check or enable monitoring when you’re ready.'
                    : 'Add an investor or explore candidates for your company.')}
              </p>
            </div>
          </div>
          <button className="text-button" onClick={onResearch}>
            Review research updates →
          </button>
        </section>
        <section>
          <div className="dashboard-section-heading">
            <h3>{lastPractice ? 'Continue your progress' : 'Your first rehearsal'}</h3>
            <span className="count">
              {lastPractice?.status.replaceAll('_', ' ') ?? 'Ready when you are'}
            </span>
          </div>
          <article className="dashboard-practice">
            <div className="eyebrow">Financial storytelling</div>
            <h3>
              {lastPractice
                ? 'A clearer answer starts here.'
                : 'Can you explain your financial position?'}
            </h3>
            <p>
              {lastPractice?.review?.note ??
                'Practise with your company evidence. Keep the figures and the unanswered questions together.'}
            </p>
            <button className="button" disabled={busy} onClick={onPractice}>
              {lastPractice ? 'Continue practice' : 'Start a practice'} <ArrowRight size={16} />
            </button>
          </article>
        </section>
      </div>
    </section>
  );
}

export function MeetingsPage({
  state,
  onEdit,
  onPrepare,
  busy,
}: Pick<Props, 'state' | 'onEdit' | 'onPrepare' | 'busy'>) {
  const meeting = state.workspace.onboarding.meeting;
  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Investor conversations</div>
          <h1>Keep the conversation in context.</h1>
          <p className="muted">Your notes, their questions, and the next step.</p>
        </div>
        <button className="button secondary" onClick={onEdit}>
          Edit meeting & profile links
        </button>
      </div>
      <div className="dashboard-lower">
        <article className="meeting-document">
          <h2>{meeting?.name || meeting?.firm || 'General financial preparation'}</h2>
          <p className="muted">
            {meeting?.firm} {meeting?.date ? `· ${meeting.date}` : ''}
          </p>
          <h3>What you want to achieve</h3>
          <p>{state.workspace.profile.goal || 'Not provided yet.'}</p>
          <h3>Questions and notes</h3>
          <p className="preserve-lines">
            {meeting?.notes ||
              'No investor notes yet. You can still practise with your financials.'}
          </p>
          <p className="footnote">Founder-provided context · Separate from public research.</p>
          <button className="button" disabled={busy} onClick={onPrepare}>
            Open preparation brief <ArrowRight size={16} />
          </button>
        </article>
        <ResearchLinks meeting={meeting} />
      </div>
    </section>
  );
}
