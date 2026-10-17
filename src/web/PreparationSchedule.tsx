import { useRef, useState } from 'react';
import type {
  PreparationView,
  PreparationScheduleInput,
} from '../contracts/FundraisingPreparation.js';
import { preparationScheduleInputSchema } from '../contracts/FundraisingPreparation.js';
import { buildJourney, type JourneyAction } from './PreparationJourneyModel.js';
import { dayNumber, dayString, projectSchedule } from './PreparationScheduleModel.js';
import './PreparationSchedule.css';

export function PreparationSchedule({
  data,
  busy,
  onSave,
  onAction,
  onFinancialReview,
  operatingResult,
  period,
  currency,
}: {
  data: PreparationView;
  busy: boolean;
  onSave: (input: PreparationScheduleInput) => Promise<void>;
  onAction: (action: JourneyAction) => void;
  onFinancialReview: () => void;
  operatingResult: string | null;
  period: string | null;
  currency: string;
}) {
  const [pace, setPace] = useState(1);
  const [full, setFull] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const projection = projectSchedule(data, pace);
  const nodes = buildJourney(data);
  const next = nodes.find((node) => node.id === projection.next?.id);
  const act = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (node) onAction(node.action);
  };
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  const dateLabel = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const position = (day: number) =>
    Math.max(
      0,
      Math.min(100, ((day - projection.start) / (projection.end - projection.start)) * 100),
    );
  return (
    <section className="preparation-schedule" aria-label="Preparation schedule and pace">
      <div className="prep-schedule-position-strip">
        <div>
          <span>Current operating result</span>
          <strong>{operatingResult ?? 'Not available'}</strong>
          <small>
            {period ?? 'No statement selected'} · {currency}
          </small>
        </div>
        <div>
          <span>Preparation target</span>
          <strong>{data.goal?.targetDate ? dateLabel(data.goal.targetDate) : 'Not set'}</strong>
          <small>
            {data.goal?.round} · {data.goal?.timezone}
          </small>
        </div>
        <div>
          <span>Expected preparation</span>
          <strong>{projection.finish ? dateLabel(projection.finish) : 'Needs confirmation'}</strong>
          <small>
            {projection.tone === 'complete'
              ? 'Saved completion evidence'
              : pace === 1
                ? 'Conditional on saved assumptions'
                : 'What-if scenario · not saved'}
          </small>
        </div>
        <div>
          <span>Evidence still missing</span>
          <strong>Cash & runway</strong>
          <small>Income statements do not establish cash runway.</small>
        </div>
      </div>
      <div className="prep-schedule-card">
        <div className="prep-schedule-top">
          <div>
            <h3>Preparation schedule</h3>
            <p>
              You’re here: {projection.next?.title ?? 'preparation reviewed'} →{' '}
              {projection.finish
                ? `expected ${dateLabel(projection.finish)}`
                : 'confirm the path forward'}
            </p>
          </div>
          <button className="text-button" onClick={onFinancialReview}>
            Financial review ↗
          </button>
        </div>
        {data.plan?.artifacts.some((item) => item.fictional) && (
          <span className="progress-tag tone-demo">Fictional demo evidence</span>
        )}
        <div className="prep-schedule-tools">
          <button className="text-button" ref={trigger} onClick={() => dialog.current?.showModal()}>
            Assumptions & expected outcome ↗
          </button>
          <label>
            Pace · what if{' '}
            <select
              value={pace}
              onChange={(event) => setPace(Number(event.target.value))}
              disabled={!projection.current}
            >
              <option value={1}>Planned availability</option>
              <option value={0.75}>25% slower</option>
              <option value={1.25}>25% faster</option>
            </select>
          </label>
          <button className="text-button" aria-expanded={full} onClick={() => setFull(!full)}>
            {full ? 'Show active work only' : 'Show completed steps'}
          </button>
        </div>
        <div
          className="prep-schedule-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Preparation timeline. Scroll horizontally on smaller screens."
        >
          <table className="prep-schedule-table">
            <caption>Conditional schedule · founder work in sequence · calendar days</caption>
            <thead>
              <tr>
                <th scope="col">Workstream / current status</th>
                <th scope="col">
                  <div className="prep-schedule-dates">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i}>
                        {dateLabel(
                          dayString(
                            Math.round(
                              projection.start + ((projection.end - projection.start) * i) / 4,
                            ),
                          ),
                        )}
                      </span>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {projection.rows
                .filter((row) => full || row.status !== 'complete')
                .map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <button onClick={() => act(row.id)}>{row.title}</button>
                      <small>
                        {row.status === 'complete' ? 'Reviewed' : row.status.replaceAll('_', ' ')} ·{' '}
                        {row.hours === null ? 'Effort unconfirmed' : `${row.hours} h estimated`}
                      </small>
                    </th>
                    <td>
                      <div className="prep-schedule-track">
                        <span
                          className="prep-schedule-today"
                          aria-label={`You are here: ${projection.today}`}
                        />
                        {data.goal?.targetDate &&
                          dayNumber(data.goal.targetDate) >= projection.start && (
                            <span
                              className="prep-schedule-target-marker"
                              style={{ left: `${position(dayNumber(data.goal.targetDate))}%` }}
                              title={`Preparation target: ${data.goal.targetDate}`}
                            />
                          )}
                        {row.status === 'complete' ? (
                          <span className="prep-schedule-reviewed">Reviewed</span>
                        ) : projection.finish ? (
                          <button
                            className={`prep-schedule-bar ${row.status === 'blocked' ? 'is-blocked' : ''}`}
                            style={{
                              left: `${position(row.from)}%`,
                              width: `${Math.max(2, position(row.to) - position(row.from))}%`,
                            }}
                            onClick={() => act(row.id)}
                            aria-label={`${row.title}: ${dayString(Math.floor(row.from))} to ${dayString(Math.ceil(row.to))}. Conditional on planning assumptions.`}
                          >
                            {row.status === 'blocked' ? 'Dependency' : 'Planned'}
                          </button>
                        ) : (
                          <span className="prep-schedule-undated">Awaiting planning inputs</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="prep-schedule-pace" data-tone={projection.tone} aria-live="polite">
          <div>
            <strong>{projection.label}</strong>
            <p>
              {projection.reason ??
                (projection.tone === 'complete'
                  ? 'Reviewed work remains linked to saved evidence.'
                  : `Now: ${next?.title ?? 'review remaining feedback'}.${projection.tone === 'behind' || pace < 1 ? ' Protect more review time or revise remaining effort in assumptions; keep evidence checks.' : ' Confirm evidence delivery to protect the buffer.'}`)}
            </p>
            <small>
              {projection.reviewed} current artifact review{projection.reviewed === 1 ? '' : 's'}{' '}
              accepted in 7 days · scenario capacity {projection.capacity} h/day. Availability is
              assumed; review count is not a speed forecast.
            </small>
          </div>
          <div>
            <span>
              {data.milestones.filter((row) => row.status === 'complete').length} / 5 reviewed
            </span>
            {(projection.tone === 'behind' || projection.tone === 'at_risk') && (
              <button className="text-button" onClick={() => dialog.current?.showModal()}>
                Adjust recovery plan ↗
              </button>
            )}
            {pace !== 1 && (
              <button className="text-button" onClick={() => setPace(1)}>
                Restore planned pace ↗
              </button>
            )}
          </div>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="prep-dialog prep-schedule-assumptions"
        aria-labelledby="prep-schedule-assumptions-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className="prep-heading">
          <h2 id="prep-schedule-assumptions-title">Assumptions & expected outcome</h2>
          <button className="button secondary" onClick={close}>
            Close
          </button>
        </div>
        <p>
          You’re right here: {projection.next?.title ?? 'preparation reviewed'}.{' '}
          {projection.finish
            ? `At this availability, expected preparation is ${dateLabel(projection.finish)}.`
            : 'Confirm the inputs to estimate completion.'}{' '}
          The target is {data.goal?.targetDate ?? 'not set'}.
        </p>
        <p>
          Review the financial explanation → select an investor → approve the tailored brief →
          rehearse and resolve feedback. The outcome is reviewed preparation; funding and business
          results remain unknown.
        </p>
        <form
          key={data.schedule?.id ?? 'new'}
          className="prep-goal-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const parsed = preparationScheduleInputSchema.safeParse({
              dailyHours: Number(values.get('dailyHours')),
              cashExpectedDate: values.get('cashExpectedDate') || null,
              hours: {
                financial: Number(values.get('financial')),
                investor: Number(values.get('investor')),
                brief: Number(values.get('brief')),
                rehearse: Number(values.get('rehearse')),
              },
            });
            if (!parsed.success) {
              setError('Enter daily hours from 0.25 to 12 and effort from 0.25 to 80 hours.');
              return;
            }
            setError('');
            void onSave(parsed.data)
              .then(() => {
                setPace(1);
                close();
              })
              .catch((caught: unknown) =>
                setError(caught instanceof Error ? caught.message : 'Cannot save assumptions.'),
              );
          }}
        >
          <label>
            Available founder hours / calendar day
            <input
              required
              type="number"
              name="dailyHours"
              min="0.25"
              max="12"
              step="0.25"
              defaultValue={data.schedule?.dailyHours}
            />
          </label>
          <label>
            Expected cash-evidence delivery · assumed, not received
            <input
              name="cashExpectedDate"
              type="date"
              min={projection.today}
              defaultValue={data.schedule?.cashExpectedDate ?? ''}
            />
          </label>
          {(['financial', 'investor', 'brief', 'rehearse'] as const).map((id) => (
            <label key={id}>
              {data.milestones.find((row) => row.id === id)?.title} · estimated hours
              <input
                required
                name={id}
                type="number"
                min="0.25"
                max="80"
                step="0.25"
                defaultValue={data.schedule?.hours[id]}
              />
            </label>
          ))}
          <p className="muted prep-full">
            Enter estimates for remaining work. Reviewed milestones consume no future time. Founder
            work is modeled sequentially, every calendar day; the brief waits for the assumed cash
            delivery. Total fractional days round up. Changing pace is a temporary scenario and does
            not save availability or verify receipt. New plans require reconfirmation.
          </p>
          {error && (
            <p role="alert" className="prep-full">
              {error}
            </p>
          )}
          <button className="button prep-full" disabled={busy || data.outdated}>
            Save planning assumptions
          </button>
        </form>
      </dialog>
    </section>
  );
}
