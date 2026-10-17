import { useState } from 'react';
import { z } from 'zod';
import { ArrowRight, Check, Upload } from 'lucide-react';
import { Stage, profileSchema, type Profile, type StateResponse } from '../contracts/Workspace.js';
import { meetingInputSchema } from '../contracts/Onboarding.js';
import { command, request } from './ApiClient.js';

type Props = {
  state: StateResponse;
  onComplete: () => Promise<void>;
  onRefresh: () => Promise<void>;
  editing?: boolean;
  onCancel: () => void;
};

/** Each completed step is saved on the server; drafts stay local until Continue. */
export function OnboardingPage({ state, onComplete, onRefresh, editing = false, onCancel }: Props) {
  const workspace = state.workspace;
  const [step, setStep] = useState(editing ? 2 : workspace.onboarding.step);
  const [profile, setProfile] = useState<Profile>(() =>
    workspace.profile.version === 1 && !workspace.onboarding.completedAt
      ? { ...workspace.profile, stage: Stage.UNKNOWN, sector: '', geography: '', raiseTarget: null }
      : workspace.profile,
  );
  const meeting = workspace.onboarding.meeting;
  const [name, setName] = useState(meeting?.name ?? '');
  const [firm, setFirm] = useState(meeting?.firm ?? '');
  const [date, setDate] = useState(meeting?.date ?? '');
  const [notes, setNotes] = useState(meeting?.notes ?? '');
  const [linkedin, setLinkedin] = useState(meeting?.links.linkedin ?? '');
  const [x, setX] = useState(meeting?.links.x ?? '');
  const [website, setWebsite] = useState(meeting?.links.website ?? '');
  const [currency, setCurrency] = useState<Profile['currency']>('unspecified');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedSnapshot = workspace.snapshots.find(
    (item) => item.id === workspace.onboarding.snapshotId,
  );

  async function saveStep(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await operation();
      await onRefresh();
    } catch (caught) {
      setError(
        caught instanceof z.ZodError
          ? caught.issues.map((issue) => issue.message).join(' ')
          : caught instanceof Error
            ? caught.message
            : 'Could not save. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function changeProfile(key: 'name' | 'sector' | 'geography' | 'goal', value: string): void {
    setProfile({ ...profile, [key]: value });
  }

  return (
    <div className="onboarding-shell">
      <header className="setup-header">
        <div className="brand">
          june
          <span />
        </div>
        <span>Set up your founder workspace</span>
        <button
          className="text-button"
          disabled={busy}
          title="Return to step 1. Saved data and history are kept."
          onClick={() => {
            void saveStep(async () => {
              await command('/onboarding/restart', {});
              setStep(1);
            });
          }}
        >
          Restart onboarding
        </button>
        {editing && workspace.onboarding.completedAt && (
          <button className="text-button" onClick={onCancel}>
            Back to dashboard
          </button>
        )}
      </header>
      <main className="setup-grid">
        <aside className="setup-intro">
          <div className="eyebrow">A clearer starting point</div>
          <h1>
            Your numbers.
            <br />
            Your next move.
          </h1>
          <p>A few details to make your investor preparation feel like yours.</p>
          <ol className="setup-steps">
            {['Your financials', 'Your company', 'Your conversation'].map((label, index) => (
              <li
                key={label}
                aria-current={step === index + 1 ? 'step' : undefined}
                className={step === index + 1 ? 'current' : ''}
              >
                <span>{step > index + 1 ? <Check size={17} /> : index + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {
                      [
                        'Start with the evidence',
                        'Give the numbers context',
                        'Know what to prepare for',
                      ][index]
                    }
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <p className="setup-footnote">
            Completed steps are saved to this workspace.
            <br />
            You can change these details later.
          </p>
        </aside>
        <section className="setup-form" aria-label={`Onboarding step ${step}`}>
          <div className="eyebrow">Step {step} of 3</div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {step === 1 && (
            <>
              <h2>Start with your financials.</h2>
              <p className="muted">
                Bring your monthly income statement. We’ll turn the numbers into questions worth
                preparing for.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveStep(async () => {
                    if (!file) {
                      throw new Error('Choose a CSV first.');
                    }
                    if (file.size > 2000000) {
                      throw new Error('Choose a CSV smaller than 2 MB.');
                    }
                    const result = await request('/financials', z.object({ id: z.string() }), {
                      csv: await file.text(),
                      fileName: file.name,
                      currency,
                    });
                    await command('/onboarding/financials', { snapshotId: result.id }, 'PUT');
                    setStep(2);
                  });
                }}
              >
                <div className="setup-upload">
                  <Upload size={28} />
                  <h3>Upload an income statement</h3>
                  <p>Use the supplied monthly CSV column format.</p>
                  <label>
                    Choose a CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      required
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                      }}
                    />
                  </label>
                  <label>
                    Statement currency
                    <select
                      value={currency}
                      onChange={(event) => {
                        setCurrency(profileSchema.shape.currency.parse(event.target.value));
                      }}
                    >
                      {['unspecified', 'CAD', 'USD', 'EUR', 'GBP'].map((value) => (
                        <option key={value} value={value}>
                          {value === 'unspecified' ? 'Not confirmed' : value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button secondary" disabled={busy || !file}>
                    Validate & continue <ArrowRight size={16} />
                  </button>
                </div>
              </form>
              <button
                className="sample-option"
                disabled={busy}
                onClick={() => {
                  void saveStep(async () => {
                    await command('/onboarding/sample');
                    setStep(2);
                  });
                }}
              >
                <span className="sample-icon">CSV</span>
                <span>
                  <strong>Use the Tidewell sample</strong>
                  <small>Provided dataset · October 2024–September 2026</small>
                </span>
                <ArrowRight size={18} />
              </button>
              {selectedSnapshot && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    void saveStep(async () => {
                      await command(
                        '/onboarding/financials',
                        { snapshotId: selectedSnapshot.id },
                        'PUT',
                      );
                      setStep(2);
                    });
                  }}
                >
                  Keep {selectedSnapshot.fileName} →
                </button>
              )}
              <p className="setup-hint">
                An income statement does not establish cash balance or runway. Uploaded rows must
                reconcile before they are saved.
              </p>
            </>
          )}
          {step === 2 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveStep(async () => {
                  const input = profileSchema.omit({ version: true }).strip().parse(profile);
                  await command('/onboarding/company', input, 'PUT');
                  setStep(3);
                });
              }}
            >
              <h2>What are you working toward?</h2>
              <p className="muted">
                Give the numbers context. Leave anything you haven’t confirmed blank.
              </p>
              <label>
                Company name
                <input
                  required
                  maxLength={100}
                  value={profile.name}
                  onChange={(event) => {
                    changeProfile('name', event.target.value);
                  }}
                />
              </label>
              <label>
                What do you want from your next conversation?
                <textarea
                  required
                  maxLength={1000}
                  value={profile.goal}
                  onChange={(event) => {
                    changeProfile('goal', event.target.value);
                  }}
                />
              </label>
              <div className="setup-field-grid">
                <label>
                  Company stage
                  <select
                    value={profile.stage}
                    onChange={(event) => {
                      setProfile({
                        ...profile,
                        stage: profileSchema.shape.stage.parse(event.target.value),
                      });
                    }}
                  >
                    {Object.values(Stage).map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Funding target · optional
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    placeholder="Not confirmed"
                    value={profile.raiseTarget ?? ''}
                    onChange={(event) => {
                      setProfile({ ...profile, raiseTarget: event.target.value || null });
                    }}
                  />
                </label>
              </div>
              <div className="setup-field-grid">
                <label>
                  Sector · optional
                  <input
                    placeholder="e.g. B2B software"
                    maxLength={100}
                    value={profile.sector}
                    onChange={(event) => {
                      changeProfile('sector', event.target.value);
                    }}
                  />
                </label>
                <label>
                  Geography · optional
                  <input
                    placeholder="e.g. Canada"
                    maxLength={100}
                    value={profile.geography}
                    onChange={(event) => {
                      changeProfile('geography', event.target.value);
                    }}
                  />
                </label>
              </div>
              <label>
                Funding currency
                <select
                  value={profile.currency}
                  onChange={(event) => {
                    setProfile({
                      ...profile,
                      currency: profileSchema.shape.currency.parse(event.target.value),
                    });
                  }}
                >
                  {['unspecified', 'CAD', 'USD', 'EUR', 'GBP'].map((value) => (
                    <option key={value} value={value}>
                      {value === 'unspecified' ? 'Not confirmed' : value}
                    </option>
                  ))}
                </select>
                <small>This does not relabel your financial statement.</small>
              </label>
              <div className="setup-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setStep(1);
                  }}
                >
                  ← Back
                </button>
                <button className="button" disabled={busy}>
                  Save & continue <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}
          {step === 3 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveStep(async () => {
                  const input = meetingInputSchema.parse({
                    name,
                    firm,
                    date: date || null,
                    notes,
                    links: { linkedin: linkedin || null, x: x || null, website: website || null },
                  });
                  await command('/onboarding/meeting', { meeting: input }, 'PUT');
                  await onComplete();
                });
              }}
            >
              <h2>Who’s on the other side?</h2>
              <p className="muted">
                Add an investor you’re talking to, or skip this and start with general financial
                practice.
              </p>
              <div className="setup-field-grid">
                <label>
                  Investor name
                  <input
                    maxLength={100}
                    placeholder="Person’s name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Firm
                  <input
                    maxLength={100}
                    placeholder="Investment firm"
                    value={firm}
                    onChange={(event) => {
                      setFirm(event.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="setup-divider">
                <h3>Where can we learn more about them?</h3>
                <p className="muted">
                  Optional profile links help research identify the right person.
                </p>
              </div>
              <label>
                LinkedIn profile
                <input
                  type="url"
                  maxLength={500}
                  placeholder="https://linkedin.com/in/…"
                  value={linkedin}
                  onChange={(event) => {
                    setLinkedin(event.target.value);
                  }}
                />
              </label>
              <div className="setup-field-grid">
                <label>
                  X profile
                  <input
                    type="url"
                    maxLength={500}
                    placeholder="https://x.com/…"
                    value={x}
                    onChange={(event) => {
                      setX(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Firm website or team page
                  <input
                    type="url"
                    maxLength={500}
                    placeholder="https://example.com/team"
                    value={website}
                    onChange={(event) => {
                      setWebsite(event.target.value);
                    }}
                  />
                </label>
              </div>
              <p className="setup-hint">
                Saved as research starting points, not verified evidence. Monitoring starts paused;
                choose Check now or a schedule in Investor research.
              </p>
              <label>
                Next meeting · optional
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              </label>
              <label>
                What did they ask or challenge?
                <textarea
                  maxLength={5000}
                  placeholder="Paste a question or notes from your last conversation."
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                  }}
                />
                <small>Your notes stay separate from public investor research.</small>
              </label>
              <div className="setup-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setStep(2);
                  }}
                >
                  ← Back
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void saveStep(async () => {
                      await command('/onboarding/meeting', { meeting: null }, 'PUT');
                      await onComplete();
                    });
                  }}
                >
                  Skip for now
                </button>
                <button className="button" disabled={busy}>
                  Open my workspace <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}
          {busy && (
            <p role="status" className="muted">
              Saving your workspace…
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
