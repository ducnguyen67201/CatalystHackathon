import { InvestorPreparationRecommendationPanel } from './InvestorPreparationRecommendations.js';
import { useEffect, useState } from 'react';
import { InvestorSuggestions } from './InvestorSuggestions.js';
import { InvestorModal } from './InvestorModal.js';
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
      <div className="investor-tags">
        <span>Stage: {fit.stage}</span>
        <span>Sector: {fit.sector}</span>
        <span>Location: {fit.geography}</span>
        <span>Check range: {fit.checkRange}</span>
      </div>
      <details className="investor-source-detail">
        <summary>Source quote & explanation</summary>
        <blockquote>{evidence.excerpt}</blockquote>
        <p>{evidence.explanation}</p>
        <p className="muted">
          A sourced match is a lead to investigate, not a promise of investment.
        </p>
      </details>
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
  onEditProfile,
}: {
  state: StateResponse;
  onRefresh: () => Promise<void>;
  onEditProfile: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('investor'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [addingInvestor, setAddingInvestor] = useState(false);
  const investors = state.workspace.investors;
  const selected = investors.find((item) => item.id === selectedId) ?? investors[0];
  useEffect(() => {
    if (selected?.id !== selectedId || window.location.hash !== '#investor-research-detail') return;
    const detail = document.getElementById('investor-research-detail');
    detail?.scrollIntoView({ block: 'start' });
    detail?.focus({ preventScroll: true });
  }, [selected?.id, selectedId]);
  const latestCheck = selected?.checks.at(-1);
  const selectedJob = state.jobs.find((job) => job.kind === `${checkPrefix}${selected?.id ?? ''}`);
  const selectedPending =
    selectedJob?.status === JobStatus.QUEUED || selectedJob?.status === JobStatus.RUNNING;
  const evidenceIds = [
    ...new Set([
      ...(latestCheck?.evidenceIds ?? []),
      ...(selected?.discoveryEvidenceId ? [selected.discoveryEvidenceId] : []),
    ]),
  ];
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
          <div className="eyebrow">Investor research</div>
          <h1>Discover investors for your next round</h1>
          <p className="muted">
            Find relevant firms and angels, then choose which investors to follow.
          </p>
        </div>
      </div>
      <div className="investor-loop" aria-label="Research workflow">
        <span>01 Set your preferences</span>
        <ArrowRight size={14} />
        <span>02 Discover investors</span>
        <ArrowRight size={14} />
        <span>03 Choose who to track</span>
      </div>
      {!state.capabilities.researchReady && (
        <p className="investor-demo">
          Research is not configured. Add EXA_API_KEY and OPENAI_API_KEY in Doppler, then restart
          the API and worker. Saved profiles will use live public-source research.
        </p>
      )}
      <InvestorPreparationRecommendationPanel revision={state.workspace.revision} />
      <InvestorSuggestions state={state} onRefresh={onRefresh} onEditProfile={onEditProfile} />
      <div className="investor-section-heading">
        <div>
          <h2>Your investors</h2>
          <p className="muted">Select an investor to explore their research and sources.</p>
        </div>
        <button
          className="button"
          onClick={(event) => {
            event.currentTarget.focus();
            setError('');
            setAddingInvestor(true);
          }}
        >
          <Plus size={16} />
          Add investor
        </button>
      </div>
      {addingInvestor && (
        <InvestorModal
          title="Add investor"
          description="Save a person or firm using a public profile or company link."
          onClose={() => setAddingInvestor(false)}
        >
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
                setAddingInvestor(false);
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
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </InvestorModal>
      )}
      {error && !addingInvestor && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="investor-message" role="status">
          {message}
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
              Choose Add investor to save a profile, or find investors using your search
              preferences.
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
                        ? check.mode === 'demo'
                          ? `Previous demo check · ${check.evidenceIds.length} sources · no live search`
                          : `${check.evidenceIds.length} sources · ${check.addedIds.length + check.changedIds.length} new versions`
                        : 'Waiting for first check'}
                </small>
              </button>
            );
          })}
        </aside>
        <div className="investor-detail" id="investor-research-detail" tabIndex={-1}>
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
                      ? 'Saved contact'
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
