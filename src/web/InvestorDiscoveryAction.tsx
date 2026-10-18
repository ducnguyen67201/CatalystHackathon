import { useId, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { JobStatus, jobSchema, type StateResponse } from '../contracts/Workspace.js';
import { suggestionLimit } from '../contracts/InvestorDiscovery.js';
import {
  hasDiscoveryProfile,
  listCurrentSuggestions,
} from '../features/InvestorSuggestionRules.js';
import { request } from './ApiClient.js';

/** One explicit search command, shared by Radar and investor research. Navigation never starts it. */
export function InvestorDiscoveryAction({
  state,
  onRefresh,
  onEditProfile,
  compact = false,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
  onEditProfile: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState('');
  const statusId = useId();
  const job = state.jobs.find((item) => item.kind === 'discover-investors');
  const pending = job?.status === JobStatus.QUEUED || job?.status === JobStatus.RUNNING;
  const loading = busy || pending || queued;
  const ready = hasDiscoveryProfile(state.workspace.profile);
  const full = listCurrentSuggestions(state.workspace).length >= suggestionLimit;
  const missing = [
    ...(state.workspace.profile.stage === 'Not confirmed' ? ['stage'] : []),
    ...(!state.workspace.profile.sector.trim() ? ['sector'] : []),
    ...(!state.workspace.profile.geography.trim() ? ['geography'] : []),
  ];
  const status = !ready
    ? `Add your company ${missing.join(' and ')} to search. Click Find investors to complete your details.`
    : !state.capabilities.researchReady
      ? 'Investor research is unavailable. Check the research configuration.'
      : job?.status === JobStatus.RUNNING
        ? `Searching public sources and checking investor evidence${job.attempts > 1 ? ` · attempt ${job.attempts} of 3` : ''}. Results appear when the check finishes.`
        : job?.status === JobStatus.QUEUED
          ? job.error
            ? `Search retry queued · ${job.error}`
            : 'Search queued. Waiting for the worker to start.'
          : queued
            ? 'Search queued. Waiting for the latest status…'
            : job?.status === JobStatus.FAILED
              ? `Search failed · ${job.error ?? 'Please try again.'}`
              : job?.status === JobStatus.SUCCEEDED
                ? `Search complete · ${job.result ?? state.workspace.discovery.note}`
                : 'Find new investors using your saved company details and preferences.';
  const completed =
    compact &&
    ready &&
    state.capabilities.researchReady &&
    !loading &&
    job?.status === JobStatus.SUCCEEDED;
  return (
    <div className="investor-search-action" data-compact={compact ? 'true' : undefined}>
      <button
        className="button"
        aria-busy={loading}
        aria-describedby={statusId}
        disabled={loading || (ready && (full || !state.capabilities.researchReady))}
        onClick={() => {
          if (!ready) {
            onEditProfile();
            return;
          }
          setBusy(true);
          setError('');
          void (async () => {
            try {
              await request('/investors/discover', jobSchema, { key: crypto.randomUUID() });
              setQueued(true);
              await onRefresh();
              setQueued(false);
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : 'Could not start investor search.',
              );
            } finally {
              setQueued(false);
              setBusy(false);
            }
          })();
        }}
      >
        {loading ? (
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
        ) : (
          <Search size={16} aria-hidden="true" />
        )}
        {busy
          ? 'Starting search…'
          : job?.status === JobStatus.RUNNING
            ? 'Finding investors…'
            : pending
              ? 'Search queued…'
              : 'Find investors'}
      </button>
      <div className="investor-search-feedback">
        <p id={statusId} role="status">
          {completed ? 'Search complete · review the saved leads below' : status}
        </p>
        {completed && (
          <details>
            <summary>Search details</summary>
            <p>{status}</p>
          </details>
        )}
      </div>
      {full && <p>Track or dismiss a suggestion before finding more investors.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
