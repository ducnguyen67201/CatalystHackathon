import { useEffect, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import type { StateResponse } from '../contracts/Workspace.js';
import {
  deckClaimInputSchema,
  deckClaimsViewSchema,
  type DeckClaimsCommand,
  type DeckClaimsView,
} from '../contracts/DeckClaims.js';
import { request, command } from './ApiClient.js';
import './DeckClaims.css';

const statusLabels = {
  supported: 'Matches saved metric',
  contradicted: 'Needs correction',
  insufficient_evidence: 'Missing evidence',
  ambiguous: 'Clarify claim',
  not_checked: 'Not checked',
};
const metricLabels = {
  revenue: 'Total revenue',
  operating_income: 'Operating income',
  net_income: 'Net income',
  other_income_credit: 'Other income / credit',
  gross_margin: 'Booked gross margin',
  support_adjusted_margin: 'Gross margin including support',
  arr: 'ARR',
  logo_churn: 'Monthly logo churn',
  nrr: 'Net revenue retention',
  cac: 'Fully loaded CAC',
  cac_payback: 'CAC payback',
  runway: 'Cash runway',
};
type InputCommand = DeckClaimsCommand extends infer C
  ? C extends DeckClaimsCommand
    ? Omit<C, 'version' | 'key'>
    : never
  : never;

export function DeckClaims({ state, onChange }: { state: StateResponse; onChange: () => void }) {
  const [data, setData] = useState<DeckClaimsView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [panel, setPanel] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<{ signature: string; command: DeckClaimsCommand } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void request('/deck-claims', deckClaimsViewSchema, undefined, 'GET')
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Cannot load claims.');
      });
    return () => {
      cancelled = true;
    };
  }, [reload, state.workspace.revision]);
  useEffect(() => {
    if (panel && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [panel]);
  const selected = data?.results.find((item) => item.claim.id === panel);
  const snapshot = state.workspace.snapshots.find(
    (item) => item.id === state.workspace.onboarding.snapshotId,
  );
  function close() {
    dialog.current?.close();
    setPanel(null);
    setError('');
    trigger.current?.focus();
  }
  async function save(input: InputCommand) {
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      const signature = JSON.stringify(input);
      if (pending.current?.signature !== signature)
        pending.current = {
          signature,
          command: { ...input, version: data.version, key: crypto.randomUUID() },
        };
      await command('/deck-claims/commands', pending.current.command);
      const next = await request('/deck-claims', deckClaimsViewSchema, undefined, 'GET');
      setData(next);
      pending.current = null;
      onChange();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cannot save claim.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="deck-claims" aria-label="Deck claims and evidence" id="deck-claims">
      <div className="deck-claims-heading">
        <div>
          <span className="eyebrow">Investor preparation · evidence review</span>
          <h3>Check the story behind your claims</h3>
          <p>
            Inspect the evidence, calculation and proposed wording. Saved drafts still need review.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy || !data}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setPanel('add');
          }}
        >
          Add a claim
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            pending.current = null;
            setReload((n) => n + 1);
          }}
        >
          Refresh claims
        </button>
      </div>
      {error && !panel && (
        <p role="alert">
          {error} <button onClick={() => setReload((n) => n + 1)}>Refresh claims</button>
        </p>
      )}
      {!data ? (
        <p role="status">Loading saved claims…</p>
      ) : (
        <>
          {data.results.length === 0 ? (
            <div className="deck-empty">
              <p>
                Add an exact claim from your deck or pitch. Monthly income-statement checks are
                available; ARR, retention, CAC and runway need additional datasets.
              </p>
              {data.demoAvailable && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void save({ action: 'demo' })}
                >
                  Load fictional example claims
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="deck-coverage">
                {data.results.length} saved claims ·{' '}
                {data.results.filter((item) => item.status === 'contradicted').length} need
                correction ·{' '}
                {
                  data.results.filter((item) =>
                    ['insufficient_evidence', 'ambiguous', 'not_checked'].includes(item.status),
                  ).length
                }{' '}
                need evidence or clarification. Calculations use each claim’s pinned statement.
              </p>
              <div
                className="deck-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Claim comparison table. Scroll horizontally on small screens."
              >
                <table className="deck-table">
                  <caption>Claims, saved evidence and review actions</caption>
                  <thead>
                    <tr>
                      <th scope="col">Claim</th>
                      <th scope="col">Evidence says</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((item) => (
                      <tr key={item.claim.id}>
                        <th scope="row">
                          <q>{item.claim.quote}</q>
                          <small>{item.claim.location}</small>
                          {item.fictional && (
                            <span className="deck-tag">Fictional demo evidence</span>
                          )}
                        </th>
                        <td>
                          {item.value !== null ? (
                            <>
                              <strong>
                                {item.claim.unit === 'percent'
                                  ? `${new Decimal(item.value).toFixed(2)}%`
                                  : `${item.value} ${item.claim.unit}`}
                              </strong>
                              <small>
                                {metricLabels[item.claim.metric]} · {item.claim.period}
                              </small>
                            </>
                          ) : (
                            <span>{item.explanation}</span>
                          )}
                        </td>
                        <td>
                          <span className={`deck-status is-${item.status}`}>
                            {statusLabels[item.status]}
                          </span>
                          {item.stale && <small>Earlier financial snapshot</small>}
                          {item.claim.drafts.length > 0 && (
                            <small>Draft saved · review required</small>
                          )}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            aria-label={`Inspect claim: ${item.claim.quote}`}
                            onClick={(event) => {
                              trigger.current = event.currentTarget;
                              setDraft(
                                item.claim.drafts.at(-1)?.text ??
                                  item.suggestion ??
                                  item.claim.quote,
                              );
                              setPanel(item.claim.id);
                            }}
                          >
                            Inspect →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {panel && (
        <dialog
          ref={dialog}
          className="deck-dialog"
          aria-labelledby="deck-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="deck-dialog-heading">
            <h2 id="deck-dialog-title">
              {panel === 'add' ? 'Add a deck claim' : 'Claim & evidence'}
            </h2>
            <button className="button secondary" onClick={close}>
              Close
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {panel === 'add' ? (
            <form
              className="deck-form"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                const parsed = deckClaimInputSchema.safeParse({
                  quote: values.get('quote'),
                  location: values.get('location'),
                  metric: values.get('metric'),
                  value: values.get('value'),
                  period: values.get('period'),
                  unit: values.get('unit'),
                  kind: values.get('kind'),
                  precision: Number(values.get('precision')),
                });
                if (!parsed.success) {
                  setError('Check the claim, number, period, unit and source location.');
                  return;
                }
                void save({ action: 'add', claim: parsed.data }).then((ok) => {
                  if (ok) close();
                });
              }}
            >
              <label>
                Exact claim
                <textarea
                  name="quote"
                  required
                  maxLength={2000}
                  placeholder="Paste the exact wording, including the number."
                />
              </label>
              <label>
                Deck slide / page or pitch location
                <input
                  name="location"
                  required
                  maxLength={200}
                  placeholder="For example: Seed deck, slide 6"
                />
              </label>
              <label>
                Metric
                <select name="metric" defaultValue="gross_margin">
                  {Object.entries(metricLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Claimed number
                <input name="value" required inputMode="decimal" placeholder="For example: 92" />
              </label>
              <label>
                Reporting month
                <input
                  name="period"
                  type="month"
                  required
                  defaultValue={snapshot?.rows.at(-1)?.month ?? ''}
                />
              </label>
              <label>
                Unit
                <select name="unit" defaultValue="percent">
                  {['percent', 'months', 'unspecified', 'CAD', 'USD', 'EUR', 'GBP'].map((value) => (
                    <option key={value} value={value}>
                      {value === 'unspecified' ? 'Currency unconfirmed' : value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Claim type
                <select name="kind" defaultValue="actual">
                  <option value="actual">Historical actual</option>
                  <option value="forecast">Forecast / planned</option>
                </select>
              </label>
              <label>
                Comparison decimal places
                <select name="precision" defaultValue="0">
                  {[0, 1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                The metric interpretation is supplied by you. Currency must match the saved
                statement. Missing datasets remain missing; no AI generation or paid session starts.
              </p>
              <button className="button" disabled={busy}>
                Save claim & check evidence
              </button>
            </form>
          ) : (
            selected && (
              <>
                {selected.fictional && <p className="deck-tag">Fictional demo evidence</p>}
                {selected.stale && (
                  <p className="deck-warning">
                    This check uses an earlier financial snapshot. Original evidence is preserved;
                    add a new claim to compare with the currently selected statement.
                  </p>
                )}
                <section>
                  <h3>Your claim</h3>
                  <blockquote>{selected.claim.quote}</blockquote>
                  <p>
                    {selected.claim.location} · {selected.claim.period} · {selected.claim.kind}
                  </p>
                  <p>
                    Founder-supplied interpretation: {metricLabels[selected.claim.metric]},{' '}
                    {selected.claim.value} {selected.claim.unit}.
                  </p>
                </section>
                <section>
                  <h3>Supporting evidence</h3>
                  <p>
                    {selected.fileName ??
                      'No financial statement was selected when this claim was saved.'}
                  </p>
                  {selected.sourceRows.length ? (
                    <table className="deck-source">
                      <caption>Saved supporting cells</caption>
                      <thead>
                        <tr>
                          <th>CSV row</th>
                          <th>Column</th>
                          <th>Original / reconciled value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.sourceRows.flatMap((row) =>
                          Object.entries(row.cells).map(([column, value]) => (
                            <tr key={`${row.row}:${column}`}>
                              <td>{row.row}</td>
                              <th scope="row">{column}</th>
                              <td>{value}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <p>{selected.explanation}</p>
                  )}
                </section>
                <section>
                  <h3>Calculation</h3>
                  <p>{selected.formula}</p>
                  {selected.value !== null && (
                    <strong>
                      Result: {selected.value} {selected.claim.unit}
                    </strong>
                  )}
                </section>
                <section>
                  <h3>Why it matters</h3>
                  <p>{selected.explanation}</p>
                  <p>
                    Historical results, assumptions and founder wording stay separate. A matching
                    number does not establish funding readiness.
                  </p>
                </section>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save({
                      action: 'save_draft',
                      claimId: selected.claim.id,
                      text: draft.trim(),
                    }).then((ok) => {
                      if (ok) close();
                    });
                  }}
                >
                  <label className="deck-draft">
                    Proposed wording · editable draft
                    <textarea
                      value={draft}
                      maxLength={3000}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  </label>
                  <p>
                    Saving retains the original claim and adds a draft version. The evidence check
                    is unchanged until a new numerical claim is added and checked.
                  </p>
                  <div className="deck-actions">
                    <a className="text-button" href="/?preparationStep=story">
                      Continue financial-story review →
                    </a>
                    <button
                      className="button"
                      disabled={
                        busy || !draft.trim() || draft.trim() === selected.claim.drafts.at(-1)?.text
                      }
                    >
                      Save revised draft
                    </button>
                  </div>
                </form>
                {selected.claim.drafts.length > 0 && (
                  <details>
                    <summary>Saved draft history ({selected.claim.drafts.length})</summary>
                    {selected.claim.drafts
                      .slice()
                      .reverse()
                      .map((item) => (
                        <article key={item.id}>
                          <small>
                            {new Date(item.createdAt).toLocaleString()} · Founder draft, not
                            verified
                          </small>
                          <blockquote>{item.text}</blockquote>
                        </article>
                      ))}
                  </details>
                )}
              </>
            )
          )}
        </dialog>
      )}
    </section>
  );
}
