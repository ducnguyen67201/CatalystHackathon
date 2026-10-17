import { useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { z } from 'zod';
import {
  DiscoveryFrequency,
  SuggestionStatus,
  suggestionLimit,
} from '../contracts/InvestorDiscovery.js';
import { JobStatus, jobSchema, type StateResponse } from '../contracts/Workspace.js';
import {
  hasDiscoveryProfile,
  listCurrentSuggestions,
} from '../features/InvestorSuggestionRules.js';
import { request } from './ApiClient.js';

/** Candidate suggestions stay separate from the founder's monitored watchlist. */
export function InvestorSuggestions({
  state,
  onRefresh,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const schedule = state.workspace.discovery;
  const suggestions = listCurrentSuggestions(state.workspace);
  const job = state.jobs.find((item) => item.kind === 'discover-investors');
  const pending = job?.status === JobStatus.QUEUED || job?.status === JobStatus.RUNNING;
  const ready = hasDiscoveryProfile(state.workspace.profile);

  async function act(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save discovery settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="investor-suggestions" aria-label="Suggested investors">
      <div className="investor-discovery">
        <div>
          <div className="eyebrow">Learn from similar companies</div>
          <h2>A few more investors to consider.</h2>
          <p className="muted">
            Up to three sourced suggestions. Only investors you choose to track receive individual
            monitoring.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy || pending || !ready || suggestions.length >= suggestionLimit}
          onClick={() => {
            void act(async () => {
              await request('/investors/discover', jobSchema, { key: crypto.randomUUID() });
              setMessage(
                'Research queued: similar companies, funding rounds, and participating investors.',
              );
            });
          }}
        >
          <Search size={16} />
          {pending ? 'Researching similar rounds…' : 'Find more'}
        </button>
      </div>
      <div className="investor-schedule">
        <label>
          Discover alternatives{' '}
          <select
            value={schedule.frequency}
            disabled={busy}
            onChange={(event) => {
              const frequency = event.target.value;
              void act(async () => {
                await request(
                  '/investors/discovery/schedule',
                  z.object({ ok: z.boolean() }),
                  { frequency },
                  'PUT',
                );
              });
            }}
          >
            <option value={DiscoveryFrequency.WEEKLY}>
              Weekly and when company context changes
            </option>
            <option value={DiscoveryFrequency.PAUSED}>Paused</option>
          </select>
        </label>
        <span>
          Last completed: {schedule.lastAt ? new Date(schedule.lastAt).toLocaleString() : 'Not yet'}
        </span>
        <span>
          Next check:{' '}
          {schedule.nextAt
            ? new Date(schedule.nextAt).toLocaleString()
            : schedule.frequency === DiscoveryFrequency.PAUSED
              ? 'Paused'
              : 'After company profile setup'}
        </span>
      </div>
      {!ready && (
        <p className="investor-demo">
          Add your company stage, sector and geography before discovering comparable companies.
        </p>
      )}
      <p className="muted">{schedule.note}</p>
      {suggestions.length >= suggestionLimit && (
        <p className="muted">
          Track or dismiss a suggestion to make room for another. We remember your decisions.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {job?.error && (
        <p role="status" className="error">
          Discovery {job.status}: {job.error}
        </p>
      )}
      <div className="investor-suggestion-grid">
        {suggestions.map((suggestion) => {
          const source = state.workspace.evidence.find((item) => item.id === suggestion.evidenceId);
          const deal = source?.comparableDeal;
          return (
            <article className="investor-source" key={suggestion.id}>
              <div className="eyebrow">
                {source?.mode === 'demo'
                  ? 'Fictional example'
                  : 'Sourced lead · needs verification'}
              </div>
              <h3>{suggestion.name}</h3>
              <p>
                <strong>Why consider them?</strong> A documented investment in{' '}
                {deal?.company ?? 'a comparable company'}, described as {deal?.sector} at{' '}
                {deal?.stage} stage.
              </p>
              <p>
                Company location: {deal?.geography ?? 'Unknown'}. Round announced:{' '}
                {deal?.announcedAt ?? source?.publishedAt ?? 'Unknown'}.
              </p>
              <p>
                Whole round: {deal?.roundTotal ?? 'Unknown'}. This is not this investor’s individual
                check.
              </p>
              <p className="muted">
                Investor check range:{' '}
                {source?.checkMin && source.checkMax
                  ? `${source.currency} ${source.checkMin}–${source.checkMax}`
                  : 'Unknown'}
                . Current mandate and possible competitor conflicts still need review.
              </p>
              <details>
                <summary>Inspect funding evidence</summary>
                <blockquote>{deal?.participationQuote}</blockquote>
                <blockquote>{deal?.comparisonQuote}</blockquote>
                <p>{source?.explanation}</p>
                {source?.url && (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Read original funding source
                  </a>
                )}
                <p className="muted">
                  Source published: {source?.publishedAt ?? 'Unknown'}. Retrieved:{' '}
                  {source?.discoveredAt
                    ? new Date(source.discoveredAt).toLocaleString()
                    : 'Unknown'}
                  .
                </p>
              </details>
              <div className="investor-suggestion-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    void act(async () => {
                      await request(
                        `/investors/suggestions/${suggestion.id}/decision`,
                        z.object({ ok: z.boolean() }),
                        { decision: SuggestionStatus.TRACKED },
                      );
                      setMessage(
                        `${suggestion.name} added to your watchlist. An immediate check and daily monitoring are scheduled.`,
                      );
                    });
                  }}
                >
                  <Plus size={15} />
                  Track
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    void act(async () => {
                      await request(
                        `/investors/suggestions/${suggestion.id}/decision`,
                        z.object({ ok: z.boolean() }),
                        { decision: SuggestionStatus.DISMISSED },
                      );
                      setMessage(
                        `${suggestion.name} dismissed. It will not be suggested again under the same name.`,
                      );
                    });
                  }}
                >
                  <X size={15} />
                  Dismiss
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="muted">
        Discovery runs while the worker is running. Pausing stops new scheduled jobs; queued jobs
        may finish. A similar funding round is a reason to investigate, not a promise of investment.
      </p>
    </section>
  );
}
