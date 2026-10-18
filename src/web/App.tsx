import { InvestorMeetingContext } from './InvestorMeetingContext.js';
import juneWordmark from './assets/JuneWordmark.png';
import { FinancialSheet } from './FinancialSheet.js';
import { RadarUpdates } from './RadarUpdates.js';
import { PracticeFollowups } from './Followups.js';
import { OnboardingPage } from './OnboardingPage.js';
import { DashboardPage } from './DashboardPage.js';
import { MeetingBriefs } from './MeetingBriefs.js';
import { useEffect, useState, useRef } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  LoaderCircle,
  Radar,
  RefreshCw,
  X,
  Clock3,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Brief, Evidence, Profile, StateResponse } from '../contracts/Workspace.js';
import { Stage, profileSchema } from '../contracts/Workspace.js';
import { evaluateInvestorFit } from '../features/InvestorFit.js';
import { command, fetchState, startLocalSession, startRadar } from './ApiClient.js';
import { InvestorTrackingPage } from './InvestorTrackingPage.js';
import { ScenarioPractice } from './ScenarioPractice.js';
import { ScenarioRoom } from './ScenarioRoom.js';
import { WorkspaceLayout } from './WorkspaceLayout.js';
import { Page, readWorkspacePage, workspacePageHref } from './WorkspaceNavigation.js';
function criterionLabel(key: string): string {
  const labels: Record<string, string> = {
    stage: 'Stage',
    sector: 'Sector',
    geography: 'Geography',
    checkRange: 'Check range',
  };
  return labels[key] ?? key;
}
const amount = (value: string | null | undefined): string =>
  value === undefined || value === null
    ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value));
const when = (value: string | null): string =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Paused';
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="close" aria-label="Close dialog" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function RevenueChart({ state }: { state: StateResponse }) {
  const rows = state.workspace.snapshots.at(-1)?.rows ?? [];
  const max = Math.max(...rows.map((row) => Number(row.revenue)), 1);
  const points = rows
    .map(
      (row, index) =>
        `${(index * 340) / Math.max(rows.length - 1, 1)},${82 - (Number(row.revenue) / max) * 65}`,
    )
    .join(' ');
  return (
    <div className="revenue-chart">
      <div>
        <span className="eyebrow">Revenue over time</span>
        <strong>
          ${amount(rows.at(-1)?.revenue)}
          <small>latest month</small>
        </strong>
      </div>
      <svg
        viewBox="0 0 340 90"
        role="img"
        aria-label="Revenue history from the uploaded income statement"
      >
        <path d="M0 82H340" stroke="#dce4d5" />
        <polyline points={points} fill="none" stroke="#71934d" strokeWidth="2.5" />
      </svg>
      <div className="chart-labels">
        <span>{rows[0]?.month}</span>
        <span>{rows.at(-1)?.month}</span>
      </div>
    </div>
  );
}
export function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [page, updatePage] = useState<Page>(() => readWorkspacePage(window.location));
  function setPage(next: Page): void {
    window.history.pushState(null, '', workspacePageHref(next));
    updatePage(next);
  }
  useEffect(() => {
    const onPopState = () => updatePage(readWorkspacePage(window.location));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [editingOnboarding, setEditingOnboarding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<'profile' | 'upload' | 'notices' | null>(null);
  const [source, setSource] = useState<Evidence | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [selectedBrief, setSelectedBrief] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ fileName: string; csv: string } | null>(null);
  const [currency, setCurrency] = useState<Profile['currency']>('unspecified');
  async function refresh(): Promise<void> {
    setState(await fetchState());
  }
  async function action(operation: () => Promise<void>, message?: string): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await operation();
      await refresh();
      if (message) {
        setToast(message);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The operation failed.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void startLocalSession()
      .then(fetchState)
      .then((data) => {
        if (alive) {
          setState(data);
        }
      })
      .catch(() => {
        if (alive) {
          setError('Cannot connect to June. Start the API and database with pnpm dev.');
        }
      });
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void fetchState()
        .then((data) => {
          if (alive) {
            setState(data);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => {
      setToast('');
    }, 4500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);
  if (!state) {
    return (
      <main className="loading">
        <div className="brand">
          <img className="brand-wordmark" src={juneWordmark} alt="June" width={459} height={150} />
        </div>
        <LoaderCircle className="spin" />
        <p>{error || 'Opening your workspace…'}</p>
        <button
          className="button secondary"
          onClick={() => {
            window.location.reload();
          }}
        >
          Retry connection
        </button>
      </main>
    );
  }
  const workspace = state.workspace;
  const snapshot =
    workspace.snapshots.find((item) => item.id === workspace.onboarding.snapshotId) ??
    workspace.snapshots.at(-1);
  const latestRow = snapshot?.rows.at(-1);
  const brief: Brief | undefined =
    workspace.briefs.find((item) => item.id === selectedBrief) ?? workspace.briefs.at(-1);
  const activeJobs = state.jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running',
  );
  const unread = workspace.notices.filter((notice) => !notice.read).length;
  const latestEvidence = workspace.evidence.at(-1);
  const openBrief = (id?: string): void => {
    setSelectedBrief(id ?? null);
    setPage(Page.BRIEF);
  };
  if (
    editingOnboarding ||
    (!workspace.onboarding.completedAt && page !== Page.ROOM && page !== Page.PRACTICE)
  ) {
    return (
      <OnboardingPage
        state={state}
        editing={editingOnboarding}
        onRefresh={refresh}
        onCancel={() => {
          setEditingOnboarding(false);
        }}
        onComplete={async () => {
          await refresh();
          setEditingOnboarding(false);
          setPage(Page.OVERVIEW);
        }}
      />
    );
  }
  const prepare = (practice = false): void => {
    void action(async () => {
      await command('/briefs');
      setSelectedBrief(null);
      setPage(practice ? Page.PRACTICE : Page.BRIEF);
    });
  };
  return (
    <WorkspaceLayout
      page={page}
      onNavigate={setPage}
      researchReady={state.capabilities.researchReady}
      unread={unread}
      onNotifications={() => setModal('notices')}
    >
      <main className="main">
        <div className="content">
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button
                aria-label="Dismiss error"
                onClick={() => {
                  setError('');
                }}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {page === Page.OVERVIEW && (
            <DashboardPage
              state={state}
              busy={busy}
              onEdit={() => {
                setEditingOnboarding(true);
              }}
              onRestart={() => {
                void action(async () => {
                  await command('/onboarding/restart', {});
                  setEditingOnboarding(false);
                });
              }}
              onPrepare={() => {
                prepare();
              }}
              onPractice={() => {
                prepare(true);
              }}
              onFinancials={() => {
                setPage(Page.FINANCIALS);
              }}
              onResearch={() => {
                setPage(Page.INVESTORS);
              }}
            />
          )}
          {page === Page.INVESTORS && <InvestorTrackingPage state={state} onRefresh={refresh} />}
          {page === Page.RADAR && (
            <>
              <RadarUpdates state={state} onRefresh={refresh}>
                <InvestorMeetingContext
                  state={state}
                  onRefresh={refresh}
                  onPrepare={() => prepare()}
                />
              </RadarUpdates>
              <details className="radar-legacy">
                <summary>Company fit and legacy research schedule</summary>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">Your next conversation</div>
                    <h2>A signal worth acting on.</h2>
                    <p className="muted">Connect your numbers to the right opportunity.</p>
                  </div>
                  <div className="header-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setDraft({ ...workspace.profile });
                        setModal('profile');
                      }}
                    >
                      Edit company profile
                    </button>
                    <button
                      className="button"
                      disabled={busy || activeJobs.length > 0}
                      onClick={() => {
                        void action(async () => {
                          await startRadar();
                        }, 'Radar check queued. The worker will save its findings.');
                      }}
                    >
                      {activeJobs.length ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}{' '}
                      {activeJobs.length ? 'Checking…' : 'Run radar check'}
                    </button>
                  </div>
                </div>
                <div className="schedule-bar">
                  <div>
                    <h3>
                      <Clock3 size={15} /> Scheduled monitoring
                    </h3>
                    <p>
                      {workspace.schedule.nextAt
                        ? `Next check ${when(workspace.schedule.nextAt)} · ${workspace.schedule.timezone}`
                        : 'Choose a schedule to keep checking while the browser is closed.'}
                    </p>
                  </div>
                  <div className="schedule-controls">
                    <select
                      aria-label="Radar schedule"
                      value={workspace.schedule.frequency}
                      disabled={busy}
                      onChange={(event) => {
                        void action(
                          () =>
                            command(
                              '/schedule',
                              {
                                frequency: event.target.value,
                                timezone: workspace.schedule.timezone,
                              },
                              'PUT',
                            ),
                          'Schedule saved to the server.',
                        );
                      }}
                    >
                      <option value="paused">Paused</option>
                      <option value="weekdays">Weekdays · 9:00 AM</option>
                      <option value="weekly">Mondays · 9:00 AM</option>
                    </select>
                    <button
                      className="text-button"
                      onClick={() => {
                        setPage(Page.FOLLOWUPS);
                      }}
                    >
                      View follow-ups →
                    </button>
                  </div>
                </div>
                <div className="metrics">
                  <div className="metric">
                    <div className="metric-label">Revenue · {latestRow?.month}</div>
                    <div className="metric-value">${amount(latestRow?.revenue)}</div>
                    <div className="metric-note">From uploaded financial data</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">Operating result</div>
                    <div className="metric-value">${amount(latestRow?.operatingIncome)}</div>
                    <div className="metric-note">{latestRow?.month} · income statement</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">Raise target · founder assumption</div>
                    <div className="metric-value">${amount(workspace.profile.raiseTarget)}</div>
                    <div className="metric-note">
                      {workspace.profile.stage} · {workspace.profile.currency}
                    </div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">Cash runway</div>
                    <div className="metric-value muted">Unknown</div>
                    <div className="metric-note">Cash and cash-flow data needed</div>
                  </div>
                </div>
                <div className="grid">
                  <div>
                    <article className="panel">
                      <div className="panel-title">
                        <h3>Opportunity feed</h3>
                        <span className="count">{workspace.evidence.length} sources</span>
                      </div>
                      {latestEvidence ? (
                        <div className="opportunity">
                          <div className="signal-label">
                            <span className="dot" />
                            {latestEvidence.mode === 'demo'
                              ? 'Fictional fund announcement'
                              : 'New research evidence'}
                          </div>
                          <h2>
                            {evaluateInvestorFit(workspace.profile, latestEvidence).suitable
                              ? 'A new fund. A reason to investigate.'
                              : 'New evidence. Reconsider the fit.'}
                          </h2>
                          <p className="signal-body">{latestEvidence.explanation}</p>
                          <div className="tags">
                            {Object.entries(evaluateInvestorFit(workspace.profile, latestEvidence))
                              .filter(([key]) => key !== 'suitable')
                              .map(([key, value]) => (
                                <span className="tag" key={key}>
                                  {criterionLabel(key)}: {String(value)}
                                </span>
                              ))}
                          </div>
                          <div className="signal-footer">
                            <button
                              className="text-button"
                              onClick={() => {
                                setSource(latestEvidence);
                              }}
                            >
                              Inspect source & fit →
                            </button>
                            <button
                              className="button"
                              onClick={() => {
                                openBrief();
                              }}
                            >
                              Prepare me <ArrowRight size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="empty-signal">
                          <Radar size={34} strokeWidth={1} />
                          <h2>Your next signal starts here.</h2>
                          <p className="signal-body">
                            Set your founder profile, then run a radar check. June connects investor
                            evidence with your financial preparation.
                          </p>
                          <p className="source-label">
                            Research searches public sources with Exa and checks supporting
                            passages. Results depend on publicly accessible information.
                          </p>
                        </div>
                      )}
                      <div className="workflow">
                        <strong>01 Notice the change</strong>
                        <span>→</span>
                        <span>02 Understand the fit</span>
                        <span>→</span>
                        <span>03 Be ready</span>
                      </div>
                    </article>
                    {brief && (
                      <article className="panel financial-flag">
                        <div className="flag-icon">!</div>
                        <div>
                          <h3>There’s a question hiding in the numbers.</h3>
                          <p>{brief.finding.question}</p>
                          <button
                            className="text-button"
                            onClick={() => {
                              openBrief();
                            }}
                          >
                            See the financial evidence →
                          </button>
                        </div>
                      </article>
                    )}
                    <p className="footnote">
                      Confirm your stage, sector, location and raise goal before researching
                      investors. Financial currency stays unspecified until you confirm it. Investor
                      matching is a research lead, not a funding prediction.
                    </p>
                  </div>
                  <div>
                    <article className="panel">
                      <div className="panel-title">
                        <h3>Your investor radar</h3>
                        <span className="count">Evidence first</span>
                      </div>
                      {workspace.evidence.length ? (
                        workspace.evidence.map((evidence) => (
                          <button
                            className="investor investor-button"
                            key={evidence.id}
                            onClick={() => {
                              setSource(evidence);
                            }}
                          >
                            <div className="investor-head">
                              <div className="investor-logo">{evidence.investor.slice(0, 1)}</div>
                              <div>
                                <div className="investor-name">{evidence.investor}</div>
                                <div className="investor-type">
                                  {evidence.stage ?? 'Stage unknown'} ·{' '}
                                  {evidence.mode === 'demo'
                                    ? 'Fictional example'
                                    : 'Source-backed claims'}
                                </div>
                              </div>
                              <ArrowRight size={13} />
                            </div>
                            <p>{evidence.title}</p>
                          </button>
                        ))
                      ) : (
                        <div className="investor">
                          <h3>No investors researched yet.</h3>
                          <p>
                            Add up to five names to your profile’s watchlist or start with your
                            founder segment.
                          </p>
                        </div>
                      )}
                    </article>
                    <RevenueChart state={state} />
                    <div className="research-note">
                      <strong>Fit has reasons, not a magic score.</strong>Unknown criteria stay
                      visible. Source passages support investigation; extracted claims still need
                      verification.
                    </div>
                  </div>
                </div>
                <div className="runs">
                  <div className="runs-title">
                    <Activity size={14} /> Recent checks <span>Worker polls every 2 seconds</span>
                  </div>
                  {state.jobs.slice(0, 3).map((job) => (
                    <div className="run-row" key={job.id}>
                      <span className={`run-dot ${job.status}`} />
                      <strong>
                        {job.kind === 'rebuild'
                          ? 'Brief refresh'
                          : job.kind === 'discover-investors'
                            ? 'Investor discovery'
                            : 'Investor research'}
                      </strong>
                      <span>{job.result ?? job.error ?? job.status}</span>
                      <small>{when(job.createdAt)}</small>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
          {page === Page.FINANCIALS && (
            <FinancialSheet
              snapshot={snapshot}
              snapshotCount={workspace.snapshots.length}
              onUpload={() => {
                setUpload(null);
                setModal('upload');
              }}
            />
          )}
          {page === Page.BRIEF && (
            <MeetingBriefs
              state={state}
              initialBriefId={selectedBrief}
              busy={busy}
              onCloseSelection={() => setSelectedBrief(null)}
              onRefreshBrief={() => {
                void action(async () => {
                  await command('/briefs');
                  setSelectedBrief(null);
                }, 'Brief refreshed from current inputs.');
              }}
              onPractice={(id) => {
                setSelectedBrief(id);
                setPage(Page.PRACTICE);
              }}
              onFollowup={(id) => {
                void action(() => command('/milestones', { briefId: id }), 'Follow-up saved.');
              }}
            />
          )}
          {page === Page.ROOM && (
            <>
              <header className="page-heading">
                <div>
                  <div className="eyebrow">June · Practice room</div>
                  <h1>Make the next conversation count.</h1>
                  <p className="muted">
                    Rehearse with June using your selected scenario and saved context.
                  </p>
                </div>
              </header>
              <ScenarioRoom state={state} onRefresh={refresh} onError={setError} />
            </>
          )}
          {page === Page.PRACTICE && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Practice scenario</div>
                  <h1>Choose your next conversation.</h1>
                  <p className="muted">
                    Generate a scenario, explore the details, and take it into the practice room.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => {
                    openBrief(brief?.id);
                  }}
                >
                  Back to brief
                </button>
              </div>
              <ScenarioPractice state={state} />
            </>
          )}
          {page === Page.FOLLOWUPS && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">From conversation to progress</div>
                  <h1>Your next steps.</h1>
                  <p className="muted">
                    See what needs work, track your practice, and review progress before your next
                    conversation.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => {
                    openBrief();
                  }}
                >
                  Open meeting brief
                </button>
              </div>
              <PracticeFollowups onFinancials={() => setPage(Page.FINANCIALS)} />
              {workspace.milestones.length > 0 && (
                <details className="followup-review">
                  <summary>Financial follow-ups from meeting briefs</summary>
                  <p className="muted">
                    A data comparison is a review, not evidence that the underlying goal has been
                    achieved.
                  </p>
                  {workspace.milestones.map((milestone) => (
                    <article className="panel milestone" key={milestone.id}>
                      <div className="milestone-head">
                        <span className="section-label">{milestone.status}</span>
                        <span className="muted">Review by {when(milestone.dueAt)}</span>
                      </div>
                      <h2>{milestone.title}</h2>
                      <p>
                        Compare against the saved baseline, then explain the causes with financial
                        and cash-flow evidence.
                      </p>
                      {milestone.observation && (
                        <div className="milestone-result">{milestone.observation}</div>
                      )}
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          void action(
                            () => command(`/milestones/${milestone.id}/review`),
                            'Review saved with its source references.',
                          );
                        }}
                      >
                        Review against latest data <ArrowRight size={14} />
                      </button>
                    </article>
                  ))}
                </details>
              )}
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {modal === 'profile' && draft && (
        <Modal
          title="Company profile"
          onClose={() => {
            setModal(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                const profile = profileSchema.omit({ version: true }).strip().parse(draft);
                await command('/profile', profile, 'PUT');
                setModal(null);
              }, 'Profile saved. Brief refresh queued.');
            }}
          >
            <div className="modal-body">
              <p className="muted">Confirm these assumptions so the radar can assess the fit.</p>
              <label className="field">
                Company name
                <input
                  value={draft.name}
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.target.value });
                  }}
                  required
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  Stage
                  <select
                    value={draft.stage}
                    onChange={(event) => {
                      const value = event.target.value;
                      const stage = Object.values(Stage).find((item) => item === value);
                      if (stage) {
                        setDraft({ ...draft, stage });
                      }
                    }}
                  >
                    {Object.values(Stage).map((stage) => (
                      <option key={stage}>{stage}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Raise target
                  <input
                    type="number"
                    min="1"
                    value={draft.raiseTarget ?? ''}
                    onChange={(event) => {
                      setDraft({ ...draft, raiseTarget: event.target.value || null });
                    }}
                    required
                  />
                </label>
              </div>
              <label className="field">
                Sector
                <input
                  value={draft.sector}
                  onChange={(event) => {
                    setDraft({ ...draft, sector: event.target.value });
                  }}
                  required
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  Geography
                  <input
                    value={draft.geography}
                    onChange={(event) => {
                      setDraft({ ...draft, geography: event.target.value });
                    }}
                    required
                  />
                </label>
                <label className="field">
                  Raise currency
                  <select
                    value={draft.currency}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (
                        value === 'USD' ||
                        value === 'CAD' ||
                        value === 'EUR' ||
                        value === 'GBP' ||
                        value === 'unspecified'
                      ) {
                        setDraft({ ...draft, currency: value });
                      }
                    }}
                  >
                    {['unspecified', 'CAD', 'USD', 'EUR', 'GBP'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                What will the raise achieve?
                <textarea
                  value={draft.goal}
                  onChange={(event) => {
                    setDraft({ ...draft, goal: event.target.value });
                  }}
                  maxLength={1000}
                />
              </label>
              <label className="field">
                Investor watchlist · up to 5, one per line
                <textarea
                  defaultValue={draft.watchlist.join('\n')}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      watchlist: event.target.value
                        .split('\n')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    });
                  }}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button className="button" disabled={busy}>
                Save profile →
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'upload' && (
        <Modal
          title="Upload financial evidence"
          onClose={() => {
            setModal(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (upload) {
                void action(async () => {
                  await command('/financials', { ...upload, currency });
                  setModal(null);
                }, 'Validated financial snapshot saved.');
              }
            }}
          >
            <div className="modal-body">
              <p className="muted">
                Use the provided monthly income statement format. Uploaded versions remain
                traceable.
              </p>
              <label className="field">
                CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  required
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      if (file.size > 2000000) {
                        setError('Choose a CSV smaller than 2 MB.');
                        return;
                      }
                      void file
                        .text()
                        .then((csv) => {
                          setUpload({ fileName: file.name, csv });
                        })
                        .catch(() => {
                          setError('Could not read the selected file.');
                        });
                    }
                  }}
                />
              </label>
              <label className="field">
                Financial currency
                <select
                  value={currency}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (
                      value === 'USD' ||
                      value === 'CAD' ||
                      value === 'EUR' ||
                      value === 'GBP' ||
                      value === 'unspecified'
                    ) {
                      setCurrency(value);
                    }
                  }}
                >
                  {['unspecified', 'CAD', 'USD', 'EUR', 'GBP'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <div className="notice">
                Keep currency unspecified unless you have confirmed it. A $ symbol alone is not
                enough.
              </div>
              {upload && <p className="footnote">Ready: {upload.fileName}</p>}
            </div>
            <div className="modal-footer">
              <button className="button" disabled={busy || !upload}>
                Validate & save snapshot →
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'notices' && (
        <Modal
          title="Your updates"
          onClose={() => {
            setModal(null);
          }}
        >
          <div className="modal-body">
            {workspace.notices.length ? (
              [...workspace.notices].reverse().map((notice) => (
                <div className="turn" key={notice.id}>
                  <small>{when(notice.createdAt)}</small>
                  <h3>{notice.title}</h3>
                  <p>{notice.message}</p>
                </div>
              ))
            ) : (
              <p>
                No new updates. The radar only creates a notification when relevant new evidence
                appears.
              </p>
            )}
            <button
              className="text-button"
              onClick={() => {
                void action(() => command('/notices/read'));
              }}
            >
              Mark all as read
            </button>
          </div>
        </Modal>
      )}
      {source && (
        <Modal
          title="Trace the evidence"
          onClose={() => {
            setSource(null);
          }}
        >
          <div className="modal-body">
            <div className="signal-label">
              {source.mode === 'demo'
                ? 'Fictional source · demo only'
                : 'Extracted source · needs verification'}
            </div>
            <h2>{source.title}</h2>
            <p className="source-excerpt">{source.excerpt}</p>
            {source.url && (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                Open original source ↗
              </a>
            )}
            <div className="evidence-row">
              <span>Investor</span>
              <strong>{source.investor}</strong>
            </div>
            {Object.entries(evaluateInvestorFit(workspace.profile, source))
              .filter(([key]) => key !== 'suitable')
              .map(([key, value]) => (
                <div className="evidence-row" key={key}>
                  <span>{criterionLabel(key)}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            <div className="evidence-row">
              <span>Published</span>
              <strong>{source.publishedAt ?? 'Unknown'}</strong>
            </div>
            <div className="evidence-row">
              <span>Discovered</span>
              <strong>{when(source.discoveredAt)}</strong>
            </div>
            <p className="footnote">
              A passage provides provenance, not proof that the investor will invest. Unknown
              criteria stay unknown.
            </p>
          </div>
        </Modal>
      )}
    </WorkspaceLayout>
  );
}
