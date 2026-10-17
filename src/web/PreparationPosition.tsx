import type { PreparationView } from '../contracts/FundraisingPreparation.js';
import './PreparationPosition.css';
export function PreparationPosition({
  data,
  receivedAt,
  connectionError,
  notice,
  busy,
  researchReady,
  onCheck,
  onRefresh,
}: {
  data: PreparationView;
  receivedAt: string | null;
  connectionError: string;
  notice: string;
  busy: boolean;
  researchReady: boolean;
  onCheck: () => void;
  onRefresh: () => void;
}) {
  const position = data.position;
  if (!position) return null;
  const when = (date: string | null) => (date ? new Date(date).toLocaleString() : 'Not checked');
  const worker = data.heartbeatAt !== null && Date.now() - Date.parse(data.heartbeatAt) < 60000;
  const investor = position.investor;
  return (
    <section className="prep-live-position" aria-label="Position freshness and updates">
      <div className="prep-position-status">
        <strong>
          {connectionError
            ? 'Connection interrupted · showing saved view'
            : data.outdated
              ? 'New saved evidence · preparation needs updating'
              : 'Your position · preparation matches saved evidence'}
        </strong>
        <span>Last synced: {when(receivedAt)}</span>
      </div>
      {connectionError && (
        <p role="status">{connectionError} Automatic retry continues while this page is visible.</p>
      )}
      <div role="status" aria-live="polite" className="prep-position-notice">
        {notice}
      </div>
      {data.outdated && (
        <div>
          <ul>
            {position.pendingChanges.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
          <p>
            {!data.automatic
              ? 'Automatic drafting is paused. Refresh to review these changes.'
              : !worker
                ? 'The worker is offline. Refresh from saved evidence now or restart the worker.'
                : 'The worker will prepare an updated version. Earlier reviews remain in history.'}
          </p>
          <button className="button secondary" disabled={busy} onClick={onRefresh}>
            Update from saved evidence
          </button>
        </div>
      )}
      <div className="prep-position-freshness">
        <span>
          Financials:{' '}
          {position.financial
            ? `${position.financial.period ?? 'Period unknown'} · ${position.financial.fileName} · uploaded ${when(position.financial.uploadedAt)}`
            : 'No selected statement'}
        </span>
        <span>
          Investor:{' '}
          {investor
            ? `${investor.name} · ${investor.status === 'failed' ? 'latest check failed' : investor.status === 'running' ? 'checking now' : investor.status === 'queued' ? 'check queued' : `last successful check ${when(investor.lastCheckedAt)}`}`
            : 'None selected'}
        </span>
      </div>
      {investor && (
        <div className="prep-position-investor">
          <small>
            {investor.lastCheckedAt && !investor.currentProfile
              ? 'This check used earlier company context. '
              : ''}
            {investor.frequency === 'paused'
              ? 'Monitoring paused.'
              : `Monitoring ${investor.frequency}; next due ${when(investor.nextAt)}.`}{' '}
            Checks require the worker; they are not a continuous internet feed.
          </small>
          <button
            className="button secondary"
            disabled={
              busy ||
              !researchReady ||
              investor.status === 'queued' ||
              investor.status === 'running'
            }
            onClick={onCheck}
          >
            {investor.status === 'queued' || investor.status === 'running'
              ? 'Investor check in progress'
              : 'Check investor now'}
          </button>
        </div>
      )}
      <details>
        <summary>Latest preparation update · {when(data.plan?.createdAt ?? null)}</summary>
        <ul>
          {data.plan?.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
        <p>
          Only changes to saved relevant evidence create new preparation. Unchanged checks do not
          invent new findings.
        </p>
      </details>
    </section>
  );
}
