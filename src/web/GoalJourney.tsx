import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, CircleHelp, Flag } from 'lucide-react';
import { Decimal } from 'decimal.js';
import {
  goalJourneyViewSchema,
  goalPaceSchema,
  goalProgressPageSchema,
  journeyCommandSchema,
  type GoalJourneyView,
  type GoalPosition,
  type GoalProgressEvent,
  type GoalTrackPosition,
  type JourneyCommand,
} from '../contracts/GoalJourney.js';
import type { RadarItem } from '../contracts/RadarDelivery.js';
import { request } from './ApiClient.js';
import './GoalJourney.css';
import { InvestorProfileEstimate } from './InvestorProfileEstimate.js';
import type { InvestorProfileEstimateView } from '../contracts/InvestorProfileEstimate.js';
import { InvestorCriteriaTable } from './InvestorCriteriaTable.js';
import { targetPreparationHref } from '../contracts/PreparationNavigation.js';
import { GoalPracticeFeedback, GoalRadarOpportunities } from './GoalPracticeFeedback.js';
import { chartInsights } from './GoalChartInsights.js';
import { GoalChartMilestones, GoalChartSteps } from './GoalChartDetails.js';

type WithoutReceipt<T> = T extends unknown ? Omit<T, 'key' | 'revision'> : never;
type JourneyAction = WithoutReceipt<JourneyCommand>;
const readinessLabels: Record<GoalPosition['readiness'], string> = {
  in_progress: 'In progress',
  assessment_pending: 'Assessment pending',
  needs_review: 'Needs review',
  reviewed_with_gaps: 'Reviewed with gaps',
  preparation_reviewed: 'Preparation reviewed',
  outdated: 'Changed evidence needs review',
  paused: 'Paused',
};
const stepLabels = {
  story: 'Company story',
  investor: 'Investor selected',
  brief: 'Tailored brief',
  practice: 'Practice',
  feedback: 'Assessment reviewed',
  revision: 'Next-work decision',
};
const timestamp = (value: string) => new Date(value).toLocaleString();
const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC' });
const internalHref = (value: string) =>
  value.startsWith('/') && !value.startsWith('//') ? value : '/';

/** Reads are visibility-aware and never activate a journey, assess fit, or start providers. */
export function useGoalJourney(revision: number) {
  const [data, setData] = useState<GoalJourneyView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const mutation = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    let loading = false;
    const load = async () => {
      if (document.hidden || loading || mutation.current) return;
      loading = true;
      const observedGeneration = generation.current;
      try {
        const next = await request(
          '/goal-journeys/current',
          goalJourneyViewSchema,
          undefined,
          'GET',
        );
        if (active && observedGeneration === generation.current) {
          setData(next);
          setError('');
        }
      } catch (caught) {
        if (active && observedGeneration === generation.current)
          setError(caught instanceof Error ? caught.message : 'Unable to load goal progress.');
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    const visible = () => void load();
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
    // Workspace revisions can change on every worker tick. Keep one steady polling clock.
  }, [reload]);
  const act = async (action: JourneyAction): Promise<GoalJourneyView> => {
    if (!data || mutation.current) throw new Error('Wait for the saved goal to finish loading.');
    mutation.current = true;
    generation.current += 1;
    setBusy(true);
    setError('');
    try {
      const body = journeyCommandSchema.parse({
        ...action,
        revision: data.revision,
        ...(data.journey ? { journeyId: data.journey.id } : {}),
        key: crypto.randomUUID(),
      });
      const next = await request('/goal-journeys/commands', goalJourneyViewSchema, body);
      setData(next);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the goal.');
      setReload((value) => value + 1);
      throw caught;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return {
    data,
    error,
    busy,
    act,
    workspaceRevision: revision,
    refresh: () => setReload((value) => value + 1),
  };
}

type JourneyController = ReturnType<typeof useGoalJourney>;
type DisplayPosition = { completed: number; required: number; percentage: string };
function displayPosition(position: GoalPosition, targetId: string): DisplayPosition | null {
  if (!targetId) return position;
  const track = position.tracks.find((item) => item.targetId === targetId);
  if (!track) return null;
  return {
    completed: track.completed,
    required: track.required,
    percentage: new Decimal(track.completed).div(track.required).mul(100).toFixed(1),
  };
}

/** Geometry uses only saved observations. A changed denominator visibly breaks the line. */
export function GoalJourneyChart({
  events,
  position,
  targetId = '',
  selectedId,
  onSelect,
}: {
  events: GoalProgressEvent[];
  position: GoalPosition | null;
  targetId?: string;
  selectedId?: string | undefined;
  onSelect: (event: GoalProgressEvent) => void;
}) {
  const [hint, setHint] = useState<string | null>(null);
  const hintId = useId();
  const insights = chartInsights(events, targetId, selectedId);
  const ordered = insights.flatMap((point) => {
    const { event } = point;
    const value = displayPosition(event.position, targetId);
    return value ? [{ ...point, value }] : [];
  });
  const grouped = ordered.filter((point) => !point.showMarker).length;
  const current = position ? displayPosition(position, targetId) : null;
  const earliest = ordered[0]?.event.recordedAt;
  const latest = ordered.at(-1)?.event.recordedAt;
  const start = earliest ? Date.parse(earliest) : 0;
  const end = latest ? Date.parse(latest) : start;
  const x = (value: string) =>
    end > start ? 65 + ((Date.parse(value) - start) / (end - start)) * 565 : 350;
  const y = (percentage: string) => 202 - Math.max(0, Math.min(100, Number(percentage))) * 1.5;
  const currentY = y(current?.percentage ?? '0');
  const savedHint = ordered.find(({ event }) => event.id === hint);
  const focusedTrack = position?.tracks.find((track) => track.targetId === targetId);
  const nextAction = focusedTrack?.nextAction ?? position?.nextAction;
  const nextHref = internalHref(focusedTrack?.href ?? position?.href ?? '/');
  const forecast = position?.paceScenarios?.find(
    (scenario) => scenario.pace === (position.pace ?? 1),
  );
  const guide = savedHint
    ? {
        heading: savedHint.label,
        detail: timestamp(savedHint.event.recordedAt),
        progress: `${savedHint.value.completed}/${savedHint.value.required} reviewed · ${savedHint.value.percentage}%`,
        explanation: savedHint.detail,
        next: `Next at that time: ${targetId ? (savedHint.event.position.tracks.find((track) => track.targetId === targetId)?.nextAction ?? savedHint.event.position.nextAction) : savedHint.event.position.nextAction}`,
        anchor: x(savedHint.event.recordedAt),
      }
    : position && hint === 'current'
      ? {
          heading: 'You are here',
          detail: targetId ? (focusedTrack?.name ?? 'Selected investor') : 'Whole goal',
          progress: `${current?.completed ?? position.completed}/${current?.required ?? position.required} reviewed`,
          explanation: 'Each reviewed step moves your preparation forward.',
          next: `Next: ${nextAction}`,
          anchor: 700,
        }
      : position && hint === 'forecast'
        ? {
            heading: 'Your preparation forecast',
            detail: 'Whole-goal planning estimate',
            progress: `${position.remainingHours} estimated hours remaining`,
            explanation: position.estimatedReadyDate
              ? `Estimated ready: ${dateLabel(position.estimatedReadyDate)}. This is planned work, not recorded progress.`
              : 'Review changed sources and remaining work to refresh this estimate.',
            next: 'Try a faster or slower pace below to compare dates.',
            anchor: 845,
          }
        : null;
  return (
    <figure
      className="goal-journey-chart"
      onMouseLeave={(event) => {
        if (
          !event.currentTarget.contains(document.activeElement) ||
          !document.activeElement?.hasAttribute('data-chart-guide')
        )
          setHint(null);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHint(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && hint) {
          setHint(null);
          event.stopPropagation();
        }
      }}
    >
      <figcaption>
        <span>Preparation progress · {targetId ? 'selected investor track' : 'whole goal'}</span>
        <span className="goal-chart-instruction">
          <CircleHelp size={14} aria-hidden="true" /> Hover or focus for guidance · select a dot for
          details
        </span>
      </figcaption>
      {position && current && (
        <div className="goal-chart-summary">
          <div>
            <strong>{current.percentage}%</strong>
            <span>
              {current.completed} of {current.required} preparation steps reviewed
            </span>
          </div>
          <span>
            {current.required - current.completed} remaining ·{' '}
            {focusedTrack ? focusedTrack.name : 'whole goal'}
          </span>
        </div>
      )}
      {position && <GoalChartSteps position={position} targetId={targetId} />}
      <div
        className="goal-chart-scroll"
        role="region"
        aria-label="Preparation graph. Scroll horizontally on small screens."
        tabIndex={0}
      >
        <div className="goal-chart-canvas">
          <svg
            viewBox="0 0 1000 270"
            role="group"
            aria-label="Saved preparation history, current position, and separate remaining-work estimate"
          >
            <rect x="740" y="35" width="245" height="183" fill="#f5f2e9" />
            {[0, 50, 100].map((value) => (
              <g key={value}>
                <line
                  x1="55"
                  y1={y(String(value))}
                  x2="985"
                  y2={y(String(value))}
                  stroke="#dce3de"
                />
                <text x="47" y={y(String(value)) + 4} textAnchor="end" fontSize="11">
                  {value}%
                </text>
              </g>
            ))}
            <text x="65" y="22" fontSize="12">
              Recorded history
            </text>
            <text x="700" y="22" fontSize="12" textAnchor="middle">
              Current
            </text>
            <text x="760" y="22" fontSize="12">
              Planned remaining work
            </text>
            {ordered.map(({ event, value, showMarker, label }, index) => {
              const previous = ordered[index - 1];
              const changed =
                previous &&
                (previous.event.position.scopeVersionId !== event.position.scopeVersionId ||
                  previous.event.position.goalVersionId !== event.position.goalVersionId ||
                  previous.value.required !== value.required);
              return (
                <g key={event.id}>
                  {previous && !changed && (
                    <path
                      d={`M ${x(previous.event.recordedAt)} ${y(previous.value.percentage)} H ${x(event.recordedAt)} V ${y(value.percentage)}`}
                      fill="none"
                      stroke="#456c59"
                      strokeWidth="2"
                    />
                  )}
                  {changed && (
                    <line
                      x1={x(event.recordedAt)}
                      y1="40"
                      x2={x(event.recordedAt)}
                      y2="218"
                      stroke="#9b793a"
                      strokeDasharray="4 4"
                    >
                      <title>
                        Goal or preparation scope changed. Historical counts retain their original
                        denominator.
                      </title>
                    </line>
                  )}
                  {showMarker && (
                    <>
                      <circle
                        cx={x(event.recordedAt)}
                        cy={y(value.percentage)}
                        r="12"
                        fill="transparent"
                        stroke={selectedId === event.id ? '#ab6b32' : 'transparent'}
                        strokeWidth="2"
                        tabIndex={0}
                        role="button"
                        data-chart-guide="history"
                        aria-describedby={hint === event.id ? hintId : undefined}
                        aria-label={`Inspect saved point ${event.sequence}: ${timestamp(event.recordedAt)}, ${value.completed} of ${value.required} reviewed. ${label}. ${event.reason}`}
                        aria-pressed={selectedId === event.id}
                        onMouseEnter={() => setHint(event.id)}
                        onFocus={() => setHint(event.id)}
                        onClick={() => {
                          setHint(null);
                          onSelect(event);
                        }}
                        onKeyDown={(keyboard) => {
                          if (keyboard.key === 'Enter' || keyboard.key === ' ') {
                            keyboard.preventDefault();
                            setHint(null);
                            onSelect(event);
                          }
                        }}
                      >
                        <title>{event.reason}</title>
                      </circle>
                      <circle
                        cx={x(event.recordedAt)}
                        cy={y(value.percentage)}
                        r="5"
                        fill={
                          selectedId === event.id
                            ? '#ab6b32'
                            : hint === event.id
                              ? '#244b39'
                              : '#456c59'
                        }
                        stroke="white"
                        strokeWidth="2"
                        pointerEvents="none"
                        aria-hidden="true"
                      />
                    </>
                  )}
                </g>
              );
            })}
            <line x1="700" y1="35" x2="700" y2="218" stroke="#334a3f" strokeDasharray="3 3" />
            {current && (
              <>
                <circle cx="700" cy={currentY} r="7" fill="#334a3f" />
                <text x="687" y={Math.max(45, currentY - 13)} textAnchor="end" fontSize="12">
                  {current.completed}/{current.required} reviewed
                </text>
              </>
            )}
            {!position && (
              <text x="685" y="110" textAnchor="end" fontSize="12">
                Not tracked yet
              </text>
            )}
            <text x="760" y="85" fontSize="13">
              {position ? <>{position.remainingHours} estimated hours</> : 'Estimate not set'}
            </text>
            <text x="760" y="110" fontSize="12">
              Preparation ready:
            </text>
            <text x="760" y="132" fontSize="13">
              {position?.estimatedReadyDate
                ? dateLabel(position.estimatedReadyDate)
                : position
                  ? 'Review remaining work'
                  : 'Save goal to estimate'}
            </text>
            {forecast && (
              <text x="760" y="154" fontSize="11">
                {forecast.dailyHours}h/day · {forecast.workDays} work days
              </text>
            )}
            <text x="760" y="175" fontSize="11">
              Estimate · not recorded progress
            </text>
            <text x="65" y="244" fontSize="11">
              {earliest ? timestamp(earliest) : 'No saved observations yet'}
            </text>
            <text x="630" y="244" fontSize="11" textAnchor="end">
              {latest && latest !== earliest ? timestamp(latest) : ''}
            </text>
            <text x="700" y="264" fontSize="11" textAnchor="middle">
              Now
            </text>
          </svg>
          {position && current && (
            <>
              <button
                type="button"
                className="goal-chart-hotspot goal-chart-current-guide"
                style={{ left: '70%', top: `${(currentY / 270) * 100}%` }}
                data-chart-guide="current"
                aria-label="Explain my current preparation and next step"
                aria-describedby={hint === 'current' ? hintId : undefined}
                onMouseEnter={() => setHint('current')}
                onFocus={() => setHint('current')}
                onClick={() => setHint('current')}
              />
              <button
                type="button"
                className="goal-chart-hotspot goal-chart-forecast-guide"
                data-chart-guide="forecast"
                aria-label="Explain the preparation forecast and how to adjust pace"
                aria-describedby={hint === 'forecast' ? hintId : undefined}
                onMouseEnter={() => setHint('forecast')}
                onFocus={() => setHint('forecast')}
                onClick={() => setHint('forecast')}
              />
            </>
          )}
          {guide && (
            <div
              className="goal-chart-hover-card"
              role="tooltip"
              id={hintId}
              style={{
                left: `clamp(8px, calc(${guide.anchor / 10}% - 138px), calc(100% - 284px))`,
              }}
            >
              <span className="goal-chart-guide-heading">{guide.heading}</span>
              <small>{guide.detail}</small>
              <strong>{guide.progress}</strong>
              <p>{guide.explanation}</p>
              <div className="goal-chart-guide-next">
                <ArrowRight size={14} aria-hidden="true" />
                <span>{guide.next}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="goal-chart-legend" aria-label="Graph legend">
        <span>
          <i className="goal-legend-history" />
          Reviewed steps
        </span>
        <span>
          <i className="goal-legend-boundary" />
          Goal or plan changed
        </span>
        <span>
          <i className="goal-legend-forecast" />
          Work estimate
        </span>
        {grouped > 0 && <span>{grouped} unchanged snapshots grouped · full history below</span>}
      </div>
      <GoalChartMilestones insights={insights} onSelect={onSelect} />
      {position && (
        <div className="goal-chart-next-action">
          <Flag size={18} aria-hidden="true" />
          <div>
            <span>Your next step{focusedTrack ? ` · ${focusedTrack.name}` : ''}</span>
            <strong>{nextAction}</strong>
          </div>
          <a className="text-button" href={nextHref}>
            Continue preparation <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      )}
      <p className="muted">
        {position
          ? 'History tracks reviewed preparation, not speaking performance. Future work is estimated.'
          : 'No progress is recorded in this workspace yet. Save your goal to start the graph.'}
      </p>
      {targetId && (
        <p className="muted">
          The graph shows this investor’s five preparation steps. Shared company-story review is
          counted once in the whole-goal view. The planning estimate remains goal-wide and includes
          all investors in the saved plan.
        </p>
      )}
    </figure>
  );
}

function PracticeEvidenceHistory({
  position,
  targetId = '',
  historical = false,
}: {
  position: GoalPosition;
  targetId?: string;
  historical?: boolean;
}) {
  const practices = position.practices.filter(
    (practice) => !targetId || practice.targetId === targetId,
  );
  return (
    <section
      aria-label={
        historical
          ? 'Practice evidence at this saved observation'
          : 'Saved practice evidence history'
      }
    >
      <h3>{historical ? 'Practice evidence at this observation' : 'Practice evidence history'}</h3>
      <p className="muted">
        Per-session evidence counts are separate from reviewed preparation progress. Sessions may
        cover different claims; completing a session or accepting wording does not establish
        improvement. Up to 100 recent linked practices are shown.
      </p>
      {practices.length ? (
        <div
          className="goal-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Practice assessment evidence table"
        >
          <table>
            <caption>
              {historical ? 'Results saved by this historical point' : 'Current saved results'} · no
              average speaking or investor-match score
            </caption>
            <thead>
              <tr>
                <th>Practice saved at</th>
                <th>State</th>
                <th>Assessed</th>
                <th>Supported</th>
                <th>Contradicted</th>
                <th>Unresolved</th>
                <th>Improved</th>
                <th>Exact evidence</th>
              </tr>
            </thead>
            <tbody>
              {practices.map((practice) => (
                <tr key={practice.sessionId}>
                  <td>
                    {timestamp(practice.createdAt)}
                    {practice.fictional && <strong> · Fictional evidence</strong>}
                  </td>
                  <td>
                    {practice.status}
                    {practice.partial && ' · partial assessment'}
                  </td>
                  <td>{practice.status === 'assessed' ? practice.assessed : '—'}</td>
                  <td>{practice.status === 'assessed' ? practice.supported : '—'}</td>
                  <td>{practice.status === 'assessed' ? practice.contradicted : '—'}</td>
                  <td>{practice.status === 'assessed' ? practice.unresolved : '—'}</td>
                  <td>{practice.status === 'assessed' ? practice.improved : '—'}</td>
                  <td>
                    <a
                      href={`/?page=followups&session=${encodeURIComponent(practice.sessionId)}#practice-${encodeURIComponent(practice.sessionId)}`}
                    >
                      Saved transcript and assessment
                    </a>
                    <small>
                      Session {practice.sessionId}
                      <br />
                      Evaluation {practice.evaluationId ?? 'Not available'}
                      <br />
                      Target {practice.targetId}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          No linked practice evidence was saved {historical ? 'at this point' : 'for this scope'}.
        </p>
      )}
    </section>
  );
}

function HistoricalTrack({ track }: { track: GoalTrackPosition }) {
  const cycle = track.cycleId ? `&preparationCycleId=${encodeURIComponent(track.cycleId)}` : '';
  const target = `&targetId=${encodeURIComponent(track.targetId)}`;
  return (
    <section className="goal-history-track">
      <h4>
        {track.name}{' '}
        {track.fictional && <span className="progress-tag tone-demo">Fictional evidence</span>}
      </h4>
      <p>
        {track.completed}/{track.required} reviewed · {track.nextAction}
      </p>
      <dl className="goal-identifiers">
        <div>
          <dt>Cycle</dt>
          <dd>{track.cycleId ?? 'Not created'}</dd>
        </div>
        <div>
          <dt>Company story version</dt>
          <dd>{track.pitchId ?? 'Not created'}</dd>
        </div>
        <div>
          <dt>Brief version</dt>
          <dd>{track.briefVersionId ?? 'Not created'}</dd>
        </div>
        <div>
          <dt>Practice session</dt>
          <dd>{track.sessionId ?? 'Not started'}</dd>
        </div>
        <div>
          <dt>Evaluation</dt>
          <dd>{track.evaluationId ?? 'Not available'}</dd>
        </div>
      </dl>
      <ul>
        {track.steps.map((step) => (
          <li key={step.id}>
            <strong>{stepLabels[step.id]}:</strong> {step.status.replaceAll('_', ' ')}.{' '}
            {step.reason}
          </li>
        ))}
      </ul>
      <div className="goal-actions">
        {track.cycleId && (
          <a className="text-button" href={`/?preparationStep=history${cycle}${target}`}>
            Inspect exact saved preparation and sources
          </a>
        )}
        {track.sessionId && (
          <a
            className="text-button"
            href={`/?page=followups&session=${encodeURIComponent(track.sessionId)}#practice-${encodeURIComponent(track.sessionId)}`}
          >
            Open saved practice and assessment
          </a>
        )}
      </div>
    </section>
  );
}

export function GoalJourney({
  revision,
  onEditGoal,
}: {
  revision: number;
  onEditGoal?: () => void;
}) {
  const controller = useGoalJourney(revision);
  const { data, error } = controller;
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [history, setHistory] = useState<GoalProgressEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [boundary, setBoundary] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);
  const [selected, setSelected] = useState<GoalProgressEvent | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const journeyId = data?.journey?.id;
  const lastSequence = data?.journey?.lastSequence;
  const [snapshotSequence, setSnapshotSequence] = useState<number | undefined>();
  const [olderLoaded, setOlderLoaded] = useState(false);
  const historyRequest = useRef(0);
  const select = (event: GoalProgressEvent) => {
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(event);
  };
  const close = () => {
    dialog.current?.close();
    setSelected(null);
    restoreFocus.current?.focus();
  };
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  const loadPage = useCallback(
    async (nextCursor?: number) => {
      if (!journeyId || lastSequence === undefined) return;
      const requestId = ++historyRequest.current;
      setHistoryBusy(true);
      setHistoryError('');
      const upper = nextCursor === undefined ? lastSequence : boundary;
      const query = new URLSearchParams({
        limit: '30',
        ...(upper ? { beforeSequence: String(upper) } : {}),
        ...(nextCursor === undefined ? {} : { cursor: String(nextCursor) }),
        ...(targetId ? { targetId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      try {
        const page = await request(
          `/goal-journeys/${journeyId}/progress/events?${query}`,
          goalProgressPageSchema,
          undefined,
          'GET',
        );
        if (requestId !== historyRequest.current) return;
        setHistory((previous) =>
          nextCursor === undefined
            ? page.items
            : [
                ...previous,
                ...page.items.filter((item) => !previous.some((saved) => saved.id === item.id)),
              ],
        );
        setCursor(page.nextCursor);
        setBoundary(page.beforeSequence);
        setOlderLoaded(nextCursor !== undefined);
        if (nextCursor === undefined) setSnapshotSequence(lastSequence);
      } catch (caught) {
        if (requestId === historyRequest.current)
          setHistoryError(
            caught instanceof Error ? caught.message : 'Unable to load progress history.',
          );
      } finally {
        if (requestId === historyRequest.current) setHistoryBusy(false);
      }
    },
    [journeyId, lastSequence, boundary, targetId, from, to],
  );
  const latestLoad = useRef(loadPage);
  latestLoad.current = loadPage;
  useEffect(() => {
    if (journeyId) void latestLoad.current();
    return () => {
      historyRequest.current += 1;
    };
  }, [journeyId, targetId, from, to, historyReload]);
  useEffect(() => {
    if (
      snapshotSequence !== undefined &&
      lastSequence !== snapshotSequence &&
      !olderLoaded &&
      !selected
    )
      void latestLoad.current();
  }, [lastSequence, snapshotSequence, olderLoaded, selected]);
  const activeTargets = data?.targets.filter((target) => target.status === 'active') ?? [];
  const actionHref =
    activeTargets.length && data?.position ? internalHref(data.position.href) : '/?page=radar';
  const reviewed = data?.position?.readiness === 'preparation_reviewed';
  const nextHref = reviewed
    ? actionHref.replace('preparationStep=revision', 'preparationStep=history')
    : actionHref;
  const nextStep = new URLSearchParams(nextHref.split('?')[1] ?? '').get('preparationStep');
  const nextLabels: Record<string, string> = {
    story: 'Review company story',
    investor: 'Review investor',
    brief: 'Review tailored brief',
    practice: 'Start practice',
    feedback: 'Review feedback',
    revision: 'Review next steps',
    history: 'Review progress',
  };
  const nextLabel = !activeTargets.length
    ? 'Find investors'
    : reviewed
      ? 'Review progress'
      : nextHref.includes('page=radar')
        ? 'Review investor match'
        : (nextLabels[nextStep ?? ''] ?? 'Continue preparation');
  const nextTrackId = new URLSearchParams(nextHref.split('?')[1] ?? '').get('targetId');
  const waitingForCall =
    nextStep === 'practice' &&
    data?.practiceUpdates.some(
      (update) =>
        update.targetId === nextTrackId &&
        ['awaiting_transcript', 'queued'].includes(update.status),
    );
  return (
    <section className="goal-journey" aria-labelledby="goal-journey-title">
      <div className="goal-overview-header">
        <div className="goal-heading">
          <div>
            <div className="eyebrow">Your goal</div>
            <h2 id="goal-journey-title">Your preparation journey</h2>
            <p>{data?.intent || 'What do you want to achieve?'}</p>
          </div>
          {onEditGoal && (
            <button className="button secondary" onClick={onEditGoal}>
              {data?.intent.trim() ? 'Edit goal' : 'Set goal'}
            </button>
          )}
        </div>
        <ol className="goal-flow" aria-label="Goal to progress flow">
          {[
            'Goal',
            'Investor match',
            'Target investor',
            'Tailored brief',
            'Practice',
            'Review progress',
          ].map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
      </div>
      {error && (
        <p role="alert">
          {error} {data && 'The last saved view remains visible.'}{' '}
          <button className="text-button" onClick={controller.refresh}>
            Retry
          </button>
        </p>
      )}
      {!data && !error && <p role="status">Loading saved goal progress…</p>}
      {data && !data.journey && (
        <div className="goal-current" aria-label="Preparation tracking has not started">
          <div>
            <span>Current position</span>
            <strong>Not tracked yet</strong>
          </div>
          <div>
            <span>Estimated preparation ready</span>
            <strong>Save goal to estimate</strong>
          </div>
        </div>
      )}
      {data?.position && (
        <>
          <div className="goal-current" aria-live="polite">
            <div>
              <span>Current position</span>
              <strong>
                {data.position.completed}/{data.position.required} reviewed ·{' '}
                {data.position.percentage}%
              </strong>
              <small>{readinessLabels[data.position.readiness]}</small>
              <div className="goal-summary-meter" aria-hidden="true">
                <i
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(data.position.percentage)))}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <span>Estimated preparation ready</span>
              <strong>
                {data.position.estimatedReadyDate
                  ? dateLabel(data.position.estimatedReadyDate)
                  : 'Review remaining work'}
              </strong>
              <small>{data.position.remainingHours} hours remaining · goal-wide plan</small>
              {data.position.paceScenarios && (
                <label className="goal-pace-control" id="goal-pace">
                  Preparation pace
                  <select
                    value={data.position.pace ?? 1}
                    disabled={controller.busy}
                    onChange={(event) => {
                      const pace = goalPaceSchema.parse(Number(event.target.value));
                      void controller.act({ action: 'set_pace', pace }).catch(() => undefined);
                    }}
                  >
                    <option value={0.75}>25% slower</option>
                    <option value={1}>Planned pace</option>
                    <option value={1.25}>25% faster</option>
                  </select>
                </label>
              )}
            </div>
            <div className="goal-summary-targets">
              <span>Target investors</span>
              <strong>
                {activeTargets.filter((target) => target.included).length} in your plan
              </strong>
              <small>{activeTargets.length} saved · independent practice tracks</small>
              <a className="text-button" href="#goal-targets">
                View investors →
              </a>
            </div>
            <div className="journey-next">
              <span>
                Next:{' '}
                {activeTargets.length
                  ? data.position.nextAction
                  : 'Choose an investor for this goal.'}
              </span>
              <a className="button" href={nextHref}>
                {waitingForCall ? 'View call status' : nextLabel} →
              </a>
            </div>
          </div>
        </>
      )}
      <div className={`goal-workspace-grid${data?.journey ? ' has-sidebar' : ''}`}>
        <div className="goal-workspace-primary">
          {historyError && (
            <p role="alert">
              History could not refresh. Previously loaded observations remain visible.{' '}
              <button
                className="text-button"
                onClick={() => setHistoryReload((value) => value + 1)}
              >
                Retry history
              </button>
            </p>
          )}
          <GoalJourneyChart
            events={
              data?.position
                ? history.length || targetId || from || to
                  ? history
                  : data.events.slice(-30)
                : []
            }
            position={data?.position ?? null}
            targetId={targetId}
            selectedId={selected?.id}
            onSelect={select}
          />
          {data?.position?.paceScenarios && (
            <div className="goal-pace-scenarios" aria-label="Goal preparation date scenarios">
              {data.position.paceScenarios.map((scenario) => (
                <div
                  key={scenario.pace}
                  aria-current={scenario.pace === (data.position?.pace ?? 1) ? 'true' : undefined}
                >
                  <span>
                    {scenario.pace === 1
                      ? 'Planned pace'
                      : scenario.pace > 1
                        ? '25% faster'
                        : '25% slower'}
                  </span>
                  <strong>
                    {scenario.estimatedReadyDate
                      ? dateLabel(scenario.estimatedReadyDate)
                      : 'Review remaining work'}
                  </strong>
                  <small>
                    {scenario.dailyHours} hours/day · {scenario.workDays} work days
                  </small>
                </div>
              ))}
              <p>
                Saved planning pace changes the forecast only. Completed work and call performance
                stay separate.
              </p>
            </div>
          )}
        </div>
        {data?.journey && (
          <aside className="goal-workspace-sidebar" aria-label="Practice and investor radar">
            <GoalPracticeFeedback data={data} />
            <GoalRadarOpportunities items={data.radarOpportunities} />
          </aside>
        )}
      </div>
      {data?.position && (
        <>
          <details className="journey-details goal-progress-details">
            <summary>History, filters & planning details</summary>
            <p className="muted">
              Solid steps are saved observations. Dashed boundaries mark changed goals or scope;
              earlier counts retain their original denominator. Preparation counts do not measure
              mastery or funding likelihood.
            </p>
            <p className="muted">{data.position.estimateReason}</p>
            <div className="goal-history-controls">
              <label>
                Graph scope
                <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Whole goal</option>
                  {data.targets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.status === 'archived' ? ' · archived' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                History from
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                History through
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={historyBusy}
                onClick={() => setHistoryReload((value) => value + 1)}
              >
                Refresh history
              </button>
            </div>
            {lastSequence !== snapshotSequence && snapshotSequence !== undefined && (
              <p role="status">
                New progress is available. Refresh history to include the latest saved events; the
                current position above is up to date.
              </p>
            )}
            <details className="goal-history-table">
              <summary>
                Inspect chronological history · {history.length} loaded observations
              </summary>
              <div
                className="goal-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Chronological preparation history"
              >
                <table>
                  <caption>
                    Saved observations with their original goal and scope. Select a row to inspect
                    exact versions.
                  </caption>
                  <thead>
                    <tr>
                      <th>Recorded at</th>
                      <th>Reviewed steps</th>
                      <th>Scope</th>
                      <th>Change</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history]
                      .sort((a, b) => a.sequence - b.sequence)
                      .map((event) => {
                        const value = displayPosition(event.position, targetId);
                        return (
                          value && (
                            <tr key={event.id}>
                              <td>{timestamp(event.recordedAt)}</td>
                              <td>
                                {value.completed}/{value.required} · {value.percentage}%
                              </td>
                              <td>Version {event.position.scopeVersion}</td>
                              <td>{event.reason}</td>
                              <td>
                                <button className="text-button" onClick={() => select(event)}>
                                  Inspect #{event.sequence}
                                </button>
                              </td>
                            </tr>
                          )
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </details>
            {history.length === 0 && !historyBusy && (
              <p>
                No saved observations in this history filter. Current preparation is shown
                separately above.
              </p>
            )}
            {cursor !== null && (
              <button
                className="button secondary"
                disabled={historyBusy}
                onClick={() => void loadPage(cursor)}
              >
                Load older saved observations
              </button>
            )}
            {historyBusy && <p role="status">Loading saved history…</p>}
            <PracticeEvidenceHistory position={data.position} targetId={targetId} />
          </details>
          <TargetInvestors controller={controller} />
        </>
      )}
      {selected && (
        <dialog
          ref={dialog}
          className="prep-dialog goal-history-dialog"
          aria-labelledby="goal-point-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="goal-heading">
            <h2 id="goal-point-title">Saved progress #{selected.sequence}</h2>
            <button className="button secondary" onClick={close}>
              Close
            </button>
          </div>
          <p>
            {timestamp(selected.recordedAt)} · {selected.reason}
          </p>
          <p>
            <strong>
              {selected.position.completed}/{selected.position.required} reviewed ·{' '}
              {selected.position.percentage}%
            </strong>{' '}
            · {readinessLabels[selected.position.readiness]}
          </p>
          <dl className="goal-identifiers">
            <div>
              <dt>Goal revision</dt>
              <dd>{selected.position.goalVersionId}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>
                {selected.position.scopeVersionId} · version {selected.position.scopeVersion}
              </dd>
            </div>
            <div>
              <dt>Projection</dt>
              <dd>{selected.position.projectionVersion}</dd>
            </div>
          </dl>
          <p>{selected.position.estimateReason}</p>
          <p>
            Estimated remaining work at this observation: {selected.position.remainingHours} hours.{' '}
            {selected.position.estimatedReadyDate
              ? `Preparation-ready estimate: ${dateLabel(selected.position.estimatedReadyDate)}.`
              : 'No ready date was established.'}
          </p>
          {selected.position.tracks
            .filter((track) => !targetId || track.targetId === targetId)
            .map((track) => (
              <HistoricalTrack key={track.targetId} track={track} />
            ))}
          <PracticeEvidenceHistory position={selected.position} targetId={targetId} historical />
          <p className="muted">
            Historical inspection leaves current investor focus and approvals unchanged. Artifacts
            retain their original evidence; a previous assessment does not approve today’s brief.
          </p>
        </dialog>
      )}
    </section>
  );
}

function TargetMatchReview({
  target,
  controller,
}: {
  target: GoalJourneyView['targets'][number];
  controller: JourneyController;
}) {
  const { data, busy, act } = controller;
  const [profileView, setProfileView] = useState<InvestorProfileEstimateView | null>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [rationale, setRationale] = useState(target.rationale);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const candidate = assessmentId
    ? data?.assessments.find((assessment) => assessment.id === assessmentId)
    : target.assessment;
  const assessment = candidate?.assessment;
  const needsAcknowledgement = assessment?.status !== 'scored';
  const outdated = !assessmentId && target.matchOutdated;
  async function assess() {
    setError('');
    setMessage('');
    setAcknowledged(false);
    try {
      const next = await act({ action: 'assess', investorId: target.investorId });
      const latest = next.assessments.findLast((entry) => entry.investorId === target.investorId);
      if (latest) setAssessmentId(latest.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to assess the current saved evidence.',
      );
    }
  }
  async function confirm() {
    if (!assessmentId || !candidate) return;
    setError('');
    try {
      await act({
        action: 'shortlist',
        investorId: target.investorId,
        assessmentId,
        rationale,
        included: target.included,
      });
      setMessage(
        'Reviewed match saved for this target. Open tailored preparation to review the refreshed brief.',
      );
      setAssessmentId(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Inputs changed. Reassess before confirming this match.',
      );
    }
  }
  return (
    <details open={target.matchOutdated}>
      <summary>Review current match</summary>
      <p className="muted">
        Review changed eligibility and evidence before re-pinning this investor to the goal.
        Assessing saved research does not approve a brief or start monitoring.
      </p>
      <button
        className="button secondary"
        disabled={busy || target.status !== 'active'}
        onClick={() => void assess()}
      >
        Assess current saved research
      </button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {assessment && (
        <>
          <InvestorProfileEstimate
            investorId={target.investorId}
            revision={controller.workspaceRevision}
            onView={setProfileView}
          />
          <p>
            <strong>
              {outdated
                ? 'Previous match · needs reassessment'
                : assessment.status === 'scored'
                  ? `${assessment.score}/10 match`
                  : assessment.status === 'outside_mandate'
                    ? 'Outside stated mandate'
                    : 'Needs verification'}
            </strong>{' '}
            · {new Decimal(assessment.coverage).mul(100).toFixed(0)}% weighted evidence coverage
          </p>
          <p className="muted">
            {assessment.rubricVersion} · Assessed {timestamp(assessment.assessedAt)}. Match
            describes goal alignment, not investment probability. Current inputs are checked again
            when you save.
          </p>
          <InvestorCriteriaTable
            assessment={assessment}
            goal={data?.matchGoal ?? null}
            profile={profileView}
            outdated={outdated}
          />
          <details>
            <summary>Original sources and dates · {assessment.sources.length}</summary>
            {assessment.sources.map((source, index) => (
              <blockquote key={`${source.evidenceId}-${index}`}>
                <p>{source.quote}</p>
                <small>
                  {source.fictional && 'Fictional evidence · '}Published{' '}
                  {source.publishedAt ?? 'Unknown'} · Retrieved {timestamp(source.retrievedAt)}
                </small>
                {source.url && (
                  <p>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      Open source
                    </a>
                  </p>
                )}
              </blockquote>
            ))}
          </details>
        </>
      )}
      {assessmentId && (
        <form
          className="goal-shortlist-form"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label>
            Why keep this investor as a target?
            <textarea
              required
              maxLength={1000}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
          {needsAcknowledgement && (
            <label className="goal-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I reviewed the unknowns, conflicts, or mandate exclusions. My rationale does not
              establish verified eligibility.
            </label>
          )}
          <button
            className="button"
            disabled={busy || !rationale.trim() || (needsAcknowledgement && !acknowledged)}
          >
            Confirm reviewed match for this target
          </button>
        </form>
      )}
    </details>
  );
}

export function TargetInvestors({ controller }: { controller: JourneyController }) {
  const { data, busy, act } = controller;
  const [message, setMessage] = useState('');
  const requestedTargetId =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('targetId');
  const selectedTarget = data?.targets.find((target) => target.id === requestedTargetId)?.id;
  useEffect(() => {
    if (selectedTarget) {
      const card = document.getElementById(`goal-target-${selectedTarget}`);
      card?.scrollIntoView({ behavior: 'instant', block: 'center' });
      card?.focus({ preventScroll: true });
    }
  }, [selectedTarget]);
  const operate = async (action: JourneyAction) => {
    setMessage('');
    try {
      const next = await act(action);
      setMessage(`Investor plan updated. ${next.position?.nextAction ?? ''}`);
    } catch {
      /* The shared controller preserves the saved view and shows the error. */
    }
  };
  return (
    <section className="goal-targets" id="goal-targets" aria-label="Target investors for this goal">
      <div className="goal-heading">
        <div>
          <h3>Target investors</h3>
          <p>
            Each investor has its own brief, practice and feedback. Adding another expands your
            plan; earlier progress stays saved.
          </p>
        </div>
        <a className="text-button" href="/?page=radar">
          Review investor matches →
        </a>
      </div>
      {message && <p role="status">{message}</p>}
      {!data?.targets.length && (
        <p>
          No target investors yet. Review a Radar match, then save why you want to prepare for that
          investor.
        </p>
      )}
      <div className="goal-target-grid">
        {data?.targets.map((target) => (
          <article
            key={target.id}
            className="goal-target-card"
            id={`goal-target-${target.id}`}
            tabIndex={-1}
            aria-current={selectedTarget === target.id ? 'true' : undefined}
          >
            <div className="eyebrow">
              {target.status === 'archived'
                ? 'Archived · history retained'
                : target.included
                  ? 'Included in preparation plan'
                  : 'Saved · outside current plan'}
            </div>
            <h4>{target.name}</h4>

            <p>
              <strong>
                {target.matchOutdated
                  ? 'Match needs reassessment'
                  : target.assessment?.assessment.status === 'scored'
                    ? `${target.assessment.assessment.score}/10 match`
                    : target.assessment?.assessment.status === 'outside_mandate'
                      ? 'Outside stated mandate'
                      : 'Match needs verification'}
              </strong>
              {target.assessment &&
                ` · ${new Decimal(target.assessment.assessment.coverage).mul(100).toFixed(0)}% weighted evidence coverage`}
            </p>
            {target.track && (
              <>
                <p>
                  {target.track.completed}/{target.track.required} investor steps reviewed · shared
                  story separate
                  {target.track.fictional && ' · Fictional evidence'}
                  {target.track.outdated && ' · Changed evidence needs review'}
                </p>
                <p>{target.track.nextAction}</p>
                {data.practiceUpdates.find((update) => update.targetId === target.id)?.summary && (
                  <details className="journey-details">
                    <summary>Latest practice feedback</summary>
                    <p>
                      {
                        data.practiceUpdates.find((update) => update.targetId === target.id)
                          ?.summary
                      }
                    </p>
                  </details>
                )}
              </>
            )}
            <div className="goal-actions">
              {target.status === 'active' ? (
                <>
                  <a className="button" href={targetPreparationHref(target)}>
                    Continue preparation →
                  </a>
                  <details className="journey-details target-management">
                    <summary>Investor details & options</summary>
                    <p>{target.rationale}</p>
                    <TargetMatchReview target={target} controller={controller} />
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void operate({
                          action: target.included ? 'exclude' : 'include',
                          targetId: target.id,
                        })
                      }
                    >
                      {target.included ? 'Remove from plan scope' : 'Include in plan scope'}
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void operate({ action: 'archive', targetId: target.id })}
                    >
                      Archive target
                    </button>
                    {target.track?.cycleId && (
                      <a
                        className="text-button"
                        href={`/?preparationStep=history&preparationCycleId=${encodeURIComponent(target.track.cycleId)}&targetId=${encodeURIComponent(target.id)}`}
                      >
                        Saved preparation history
                      </a>
                    )}
                  </details>
                </>
              ) : (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void operate({ action: 'resume', targetId: target.id })}
                >
                  Resume target
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function InvestorMatchDialog({
  item,
  controller,
  onClose,
}: {
  item: RadarItem;
  controller: JourneyController;
  onClose: () => void;
}) {
  const { data, busy, act } = controller;
  const [profileView, setProfileView] = useState<InvestorProfileEstimateView | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [rationale, setRationale] = useState(
    () => data?.targets.find((target) => target.investorId === item.investorId)?.rationale ?? '',
  );
  const [included, setIncluded] = useState(
    () => data?.targets.find((target) => target.investorId === item.investorId)?.included ?? true,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const focus = useRef<Element | null>(null);
  const saved = assessmentId
    ? data?.assessments.find((entry) => entry.id === assessmentId)
    : data?.assessments.findLast(
        (entry) =>
          entry.investorId === item.investorId || entry.evidenceIds.includes(item.evidenceId),
      );
  const assessment = saved?.assessment;
  const target = data?.targets.find(
    (entry) => entry.investorId === (saved?.investorId ?? item.investorId),
  );
  const outdated =
    (target?.matchOutdated && target.assessmentId === saved?.id) ||
    (saved && saved.goalVersionId !== data?.journey?.currentGoalId) ||
    (!!assessment?.nextReviewAt && Date.parse(assessment.nextReviewAt) <= Date.now());
  const needsOverride = assessment?.status !== 'scored' || outdated;
  useEffect(() => {
    focus.current = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (focus.current instanceof HTMLElement) focus.current.focus();
    };
  }, []);
  async function assess() {
    setLocalError('');
    setMessage('');
    try {
      const next = await act({ action: 'assess', eventId: item.id });
      const latest =
        next.assessments.findLast(
          (entry) =>
            entry.investorId === item.investorId || entry.evidenceIds.includes(item.evidenceId),
        ) ?? next.assessments.at(-1);
      if (latest) setAssessmentId(latest.id);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Unable to assess saved research.');
    }
  }
  async function shortlist() {
    setLocalError('');
    try {
      const next = await act({
        action: 'shortlist',
        eventId: item.id,
        ...(saved ? { investorId: saved.investorId, assessmentId: saved.id } : {}),
        rationale,
        included,
      });
      const chosen = next.targets.find(
        (entry) =>
          entry.investorId === (saved?.investorId ?? item.investorId) || entry.eventId === item.id,
      );
      if (chosen) window.location.assign(targetPreparationHref(chosen));
      setMessage(
        'Investor saved under this goal. Open tailored preparation to review the brief or complete its company-story prerequisite.',
      );
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Unable to save this target.');
    }
  }
  return (
    <dialog
      ref={dialog}
      className="prep-dialog investor-match-dialog"
      aria-labelledby="investor-match-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="goal-heading">
        <div>
          <div className="eyebrow">Match before preparation</div>
          <h2 id="investor-match-title">{item.investorName}</h2>
        </div>
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted">Choose whether to prepare for this investor under your saved goal.</p>
      {item.fictional && <p className="progress-tag tone-demo">Fictional example evidence</p>}
      {(localError || controller.error) && <p role="alert">{localError || controller.error}</p>}
      {!data?.journey ? (
        <p>
          Confirm the goal on Overview and start tracking current preparation before assessing an
          investor. <a href="/">Open goal</a>
        </p>
      ) : (
        <>
          {!assessment && (
            <button className="button" disabled={busy} onClick={() => void assess()}>
              Review saved match
            </button>
          )}
          {assessment ? (
            <>
              <div className="goal-match-summary">
                <strong>
                  {assessment.status === 'scored' && !outdated
                    ? `${assessment.score}/10 match`
                    : assessment.status === 'outside_mandate'
                      ? 'Outside stated mandate'
                      : 'Needs verification'}
                </strong>
                <span>
                  {new Decimal(assessment.coverage).mul(100).toFixed(0)}% weighted evidence coverage
                </span>
              </div>
              <p className="muted">
                {assessment.status === 'scored' && !outdated
                  ? 'Supported alignment with your goal. Review the sources before choosing.'
                  : 'Some eligibility details are unconfirmed. You can research them or choose this investor with the gaps acknowledged.'}
              </p>
              <InvestorProfileEstimate
                key={saved.investorId}
                investorId={saved.investorId}
                revision={controller.workspaceRevision}
                onView={setProfileView}
              />
              {needsOverride && (
                <a
                  className="button secondary"
                  href={`/?page=investors&investor=${encodeURIComponent(saved.investorId)}`}
                >
                  Research missing details →
                </a>
              )}
              <details className="journey-details">
                <summary>Match criteria, goal & sources</summary>
                <p>Goal: {data.intent}</p>
                <p className="muted">
                  {assessment.rubricVersion} · Assessed {timestamp(assessment.assessedAt)}. Match
                  measures alignment with your goal, not the probability of investment.
                  {outdated &&
                    ' This assessment is outdated; reassess before treating it as current.'}
                </p>
                <InvestorCriteriaTable
                  assessment={assessment}
                  goal={data.matchGoal}
                  profile={profileView}
                  outdated={outdated}
                />
                <details>
                  <summary>
                    Supporting sources and exact passages · {assessment.sources.length}
                  </summary>
                  {assessment.sources.map((source, index) => (
                    <div key={`${source.evidenceId}-${index}`} className="goal-match-source">
                      {source.fictional && <strong>Fictional evidence</strong>}
                      <blockquote>{source.quote}</blockquote>
                      <p>
                        Published {source.publishedAt ?? 'Unknown'} · Retrieved{' '}
                        {timestamp(source.retrievedAt)}
                      </p>
                      {source.url && (
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          Open supporting source
                        </a>
                      )}
                    </div>
                  ))}
                  {!assessment.sources.length && (
                    <p>
                      No qualifying mandate source was saved. A news announcement alone does not
                      establish eligibility.
                    </p>
                  )}
                </details>
                <button className="text-button" disabled={busy} onClick={() => void assess()}>
                  Refresh match from saved research
                </button>
                <p className="muted">
                  Uses saved evidence only. New research is available through Research missing
                  details.
                </p>
              </details>
            </>
          ) : (
            <p>
              Assess the saved research to see priorities, eligibility, supported check sizes, and
              unknowns.
            </p>
          )}
          {target && target.assessmentId === saved?.id && !outdated ? (
            <div role="status">
              <p>{message || 'Already saved as a target for this goal.'}</p>
              {target.status === 'active' && (
                <a className="button" href={targetPreparationHref(target)}>
                  Continue preparation →
                </a>
              )}
              {target.status === 'archived' && (
                <p>Resume this target in Target investors to continue preparing.</p>
              )}
            </div>
          ) : (
            <form
              className="goal-shortlist-form"
              onSubmit={(event) => {
                event.preventDefault();
                void shortlist();
              }}
            >
              <h3>Prepare for this investor?</h3>
              <label>
                Why this investor?
                <textarea
                  required
                  minLength={1}
                  maxLength={1000}
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  placeholder="Your reason, and anything you still want to confirm."
                  rows={2}
                />
              </label>
              {needsOverride && (
                <label className="goal-check">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  I am choosing this investor with unknown, conflicting, outdated, or excluded fit.
                  My rationale does not verify the mandate.
                </label>
              )}
              <details className="journey-details">
                <summary>Preparation plan options</summary>
                <label className="goal-check">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={(event) => setIncluded(event.target.checked)}
                  />
                  Include this investor’s preparation in my goal plan.
                </label>
              </details>
              <button
                className="button"
                disabled={busy || !saved || !rationale.trim() || (needsOverride && !acknowledged)}
              >
                Choose investor & continue →
              </button>
            </form>
          )}
        </>
      )}
    </dialog>
  );
}
