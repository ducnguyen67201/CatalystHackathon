import { useState } from 'react';
import { Plus, Search, RefreshCw, ExternalLink, ArrowRight } from 'lucide-react';
import { z } from 'zod';
import {
  CheckFrequency,
  InvestorOrigin,
  trackedInvestorSchema,
} from '../contracts/InvestorTracking.js';
import type { StateResponse, Evidence } from '../contracts/Workspace.js';
import { jobSchema, JobStatus } from '../contracts/Workspace.js';
import { evaluateInvestorFit } from '../features/InvestorFit.js';
import { request } from './ApiClient.js';
import './InvestorTracking.css';

const checkPrefix = 'investor:';
const date = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : 'Not scheduled';

function SourceCard({ evidence, state }: { evidence: Evidence; state: StateResponse }) {
  const fit = evaluateInvestorFit(state.workspace.profile, evidence);
  return (
    <article className="investor-source">
      <div className="investor-tags">
        <span>
          {evidence.mode === 'demo' ? 'Fictional example' : 'Public source · verify identity'}
        </span>
        <span>Published: {evidence.publishedAt ? date(evidence.publishedAt) : 'Unknown'}</span>
      </div>
      <h3>{evidence.title}</h3>
      <p className="muted">Source describes: {evidence.investor}</p>
      <blockquote>{evidence.excerpt}</blockquote>
      <p>{evidence.explanation}</p>
      <div className="investor-tags">
        <span>Stage: {fit.stage}</span>
        <span>Sector: {fit.sector}</span>
        <span>Location: {fit.geography}</span>
        <span>Check range: {fit.checkRange}</span>
      </div>
      <p className="muted">
        A sourced match is a lead to investigate, not a promise of investment.
      </p>
      {evidence.url && (
        <a href={evidence.url} target="_blank" rel="noreferrer">
          Read original source <ExternalLink size={13} />
        </a>
      )}
    </article>
  );
}

export function InvestorTrackingPage({
  state,
  onRefresh,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const investors = state.workspace.investors;
  const selected = investors.find((item) => item.id === selectedId) ?? investors[0];
  const discovery = state.jobs.find((job) => job.kind === 'discover-investors');
  const discoveryPending =
    discovery?.status === JobStatus.QUEUED || discovery?.status === JobStatus.RUNNING;
  const latestCheck = selected?.checks.at(-1);
  const selectedJob = state.jobs.find((job) => job.kind === `${checkPrefix}${selected?.id ?? ''}`);
  const selectedPending =
    selectedJob?.status === JobStatus.QUEUED || selectedJob?.status === JobStatus.RUNNING;
  const evidenceIds =
    latestCheck?.evidenceIds ??
    (selected?.discoveryEvidenceId ? [selected.discoveryEvidenceId] : []);
  const sources = evidenceIds.flatMap((id) => {
    const source = state.workspace.evidence.find((item) => item.id === id);
    return source ? [source] : [];
  });

  async function act(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="investor-tracking">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your investor watchlist</div>
          <h1>Start with who you know.</h1>
          <p className="muted">
            Follow a person or firm. Keep the evidence behind your next conversation.
          </p>
        </div>
      </div>
      <div className="investor-loop" aria-label="Research workflow">
        <span>01 Add a profile</span>
        <ArrowRight size={14} />
        <span>02 Research public sources</span>
        <ArrowRight size={14} />
        <span>03 Review what changed</span>
      </div>
      {state.capabilities.researchMode === 'demo' && (
        <p className="investor-demo">
          Demo mode: saves real profile links, but makes no live searches. “Find candidates”
          demonstrates the loop with fictional Northline Ventures.
        </p>
      )}
      <form
        className="investor-add"
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const investor = await request('/investors', trackedInvestorSchema, {
              name,
              url,
              frequency: CheckFrequency.DAILY,
            });
            setSelectedId(investor.id);
            setName('');
            setUrl('');
            setMessage(
              'Profile saved. New profiles are scheduled for an immediate check, then every 24 hours. Existing profiles keep their schedule.',
            );
          });
        }}
      >
        <label>
          LinkedIn, X, or firm URL{' '}
          <input
            required
            value={url}
            maxLength={500}
            placeholder="https://linkedin.com/in/investor-name"
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
        </label>
        <label>
          Name and firm <span className="muted">(optional, helps identify them)</span>
          <input
            value={name}
            maxLength={100}
            placeholder="Alex Chen, Example Ventures"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <button className="button" disabled={busy} type="submit">
          <Plus size={16} />
          Track investor
        </button>
        <p className="muted investor-add-note">
          Checks public sources every 24 hours while the worker runs. Login-only posts may be
          unavailable. You can pause any investor below.
        </p>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="investor-message" role="status">
          {message}
        </p>
      )}
      <div className="investor-discovery">
        <div>
          <strong>Who else is worth researching?</strong>
          <p className="muted">
            Find candidates for {state.workspace.profile.stage} · {state.workspace.profile.sector} ·{' '}
            {state.workspace.profile.geography}. Every new candidate gets an individual check and
            daily monitoring.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy || discoveryPending}
          onClick={() => {
            void act(async () => {
              await request('/investors/discover', jobSchema, { key: crypto.randomUUID() });
              setMessage(
                'Discovery queued. Check results will appear here as the worker finishes.',
              );
            });
          }}
        >
          <Search size={16} />
          {discoveryPending ? 'Finding candidates…' : 'Find candidates'}
        </button>
      </div>
      {discovery?.error && (
        <p role="status" className="muted">
          Discovery {discovery.status}: {discovery.error}
        </p>
      )}
      {discovery?.result && (
        <p className="muted" role="status">
          {discovery.result}
        </p>
      )}
      <div className="investor-grid">
        <aside className="investor-list" aria-label="Tracked investors">
          <div className="investor-list-heading">
            <h2>Following</h2>
            <span>{investors.length}</span>
          </div>
          {!investors.length && (
            <p className="investor-empty">
              Paste your first profile above, or discover candidates from your company profile.
            </p>
          )}
          {investors.map((investor) => {
            const job = state.jobs.find((item) => item.kind === `${checkPrefix}${investor.id}`);
            const check = investor.checks.at(-1);
            const pending = job?.status === JobStatus.QUEUED || job?.status === JobStatus.RUNNING;
            return (
              <button
                key={investor.id}
                className={`investor-list-item ${selected?.id === investor.id ? 'selected' : ''}`}
                aria-pressed={selected?.id === investor.id}
                onClick={() => {
                  setSelectedId(investor.id);
                }}
              >
                <strong>{investor.name}</strong>
                <span>
                  {investor.origin === InvestorOrigin.ADDED
                    ? 'Added by you'
                    : 'Discovered candidate'}{' '}
                  · {investor.frequency}
                </span>
                <small>
                  {pending
                    ? `Research ${job.status}`
                    : job?.status === JobStatus.FAILED
                      ? 'Check failed · retry available'
                      : check
                        ? `${check.addedIds.length + check.changedIds.length} new source versions in last check`
                        : 'Waiting for first check'}
                </small>
              </button>
            );
          })}
        </aside>
        <div className="investor-detail">
          {!selected ? (
            <div className="investor-empty">
              <Search size={30} />
              <h2>Evidence before outreach.</h2>
              <p>
                Your first check will collect source passages and show what is known, missing, or
                needs verification.
              </p>
            </div>
          ) : (
            <>
              <div className="investor-detail-heading">
                <div>
                  <div className="eyebrow">
                    {selected.origin === InvestorOrigin.ADDED
                      ? 'Your priority investor'
                      : 'Candidate to investigate'}
                  </div>
                  <h2>{selected.name}</h2>
                  <a
                    className="text-button"
                    href={'/scenarios?investor=' + encodeURIComponent(selected.id)}
                  >
                    Prepare scenarios in the Practice scenario →
                  </a>
                  {selected.url && (
                    <a href={selected.url} target="_blank" rel="noreferrer">
                      Open saved profile <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <button
                  className="button secondary"
                  disabled={busy || selectedPending}
                  onClick={() => {
                    void act(async () => {
                      await request(`/investors/${selected.id}/check`, jobSchema, {
                        key: crypto.randomUUID(),
                      });
                      setMessage(
                        'Research queued. You can leave this page while the worker checks.',
                      );
                    });
                  }}
                >
                  <RefreshCw size={15} />
                  {selectedPending ? 'Checking…' : 'Check now'}
                </button>
              </div>
              <div className="investor-tags">
                {selected.profileLinks
                  .filter((link) => link !== selected.url)
                  .map((link) => (
                    <a key={link} href={link} target="_blank" rel="noopener noreferrer">
                      {new URL(link).hostname} <ExternalLink size={13} />
                    </a>
                  ))}
              </div>
              <form
                className="investor-identity"
                onSubmit={(event) => {
                  event.preventDefault();
                  const editedName = new FormData(event.currentTarget).get('name');
                  if (typeof editedName !== 'string') {
                    return;
                  }
                  void act(async () => {
                    await request(
                      `/investors/${selected.id}/identity`,
                      z.object({ ok: z.boolean() }),
                      { name: editedName },
                      'PUT',
                    );
                    setMessage(
                      'Identity hint updated. Choose Check now to research with this name.',
                    );
                  });
                }}
              >
                <label>
                  Investor name and firm
                  <input
                    key={`${selected.id}:${selected.name}`}
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={selected.name}
                  />
                </label>
                <button className="button secondary" disabled={busy} type="submit">
                  Save name
                </button>
              </form>
              <div className="investor-schedule">
                <label>
                  Monitoring{' '}
                  <select
                    aria-label="Monitoring frequency"
                    value={selected.frequency}
                    disabled={busy}
                    onChange={(event) => {
                      const frequency = event.target.value;
                      void act(async () => {
                        await request(
                          `/investors/${selected.id}/schedule`,
                          z.object({ ok: z.boolean() }),
                          { frequency },
                          'PUT',
                        );
                      });
                    }}
                  >
                    <option value={CheckFrequency.DAILY}>Every 24 hours</option>
                    <option value={CheckFrequency.WEEKLY}>Every 7 days</option>
                    <option value={CheckFrequency.PAUSED}>Paused</option>
                  </select>
                </label>
                <div>
                  <small>Last completed check</small>
                  <strong>{latestCheck ? date(latestCheck.checkedAt) : 'Not checked yet'}</strong>
                </div>
                <div>
                  <small>Next scheduled check</small>
                  <strong>{date(selected.nextAt)}</strong>
                </div>
              </div>
              <p className="muted">
                Pausing stops future scheduled checks; already queued checks may finish. Manual
                checks still work.
              </p>
              {selectedJob?.error && (
                <p role="status" className="error">
                  {selectedJob.status === JobStatus.FAILED ? 'Check failed.' : 'Retry pending.'}{' '}
                  {selectedJob.error}
                </p>
              )}
              <div className="investor-result">
                <strong>What changed?</strong>
                <p>
                  {latestCheck?.note ??
                    'Your sources will appear after the first check. A discovered candidate may already have an initial source below.'}
                </p>
              </div>
              {sources.map((evidence) => (
                <SourceCard key={evidence.id} evidence={evidence} state={state} />
              ))}
              <details className="investor-history">
                <summary>Check history ({selected.checks.length})</summary>
                {[...selected.checks].reverse().map((check) => (
                  <article key={check.jobId}>
                    <strong>{date(check.checkedAt)}</strong>
                    <p>{check.note}</p>
                    <small>Company profile version {check.profileVersion}</small>
                    {check.evidenceIds.map((id) => {
                      const evidence = state.workspace.evidence.find((item) => item.id === id);
                      return evidence ? (
                        <details key={id}>
                          <summary>{evidence.title}</summary>
                          <blockquote>{evidence.excerpt}</blockquote>
                          {evidence.url && (
                            <a href={evidence.url} target="_blank" rel="noreferrer">
                              Source
                            </a>
                          )}
                        </details>
                      ) : null;
                    })}
                  </article>
                ))}
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
