import { ArrowUpRight, Check, Circle, Clock3 } from 'lucide-react';
import type { GoalPosition, GoalProgressEvent } from '../contracts/GoalJourney.js';
import { preparationSteps, type chartInsights } from './GoalChartInsights.js';

export function GoalChartSteps({
  position,
  targetId,
}: {
  position: GoalPosition;
  targetId: string;
}) {
  const tracks = position.tracks.filter((track) => !targetId || track.targetId === targetId);
  if (!tracks.length) return null;
  const stages = preparationSteps
    .filter((item) => !targetId || item.id !== 'story')
    .map((item) => {
      const steps = tracks.flatMap((track) => track.steps.filter((step) => step.id === item.id));
      // Company story is shared and counted once, rather than once per investor.
      const considered = item.id === 'story' ? steps.slice(0, 1) : steps;
      const total = considered.length;
      const complete = considered.filter((step) => step.complete).length;
      const waiting = considered.filter((step) => step.status === 'running').length;
      const review = considered.some((step) =>
        ['needs_review', 'outdated', 'failed'].includes(step.status),
      );
      const ready = considered.some((step) => step.status === 'ready');
      const done = total > 0 && complete === total;
      const status = done
        ? 'Reviewed'
        : complete
          ? `${complete}/${total} reviewed${waiting ? ` · ${waiting} waiting` : ''}`
          : waiting
            ? item.id === 'practice'
              ? 'Waiting for transcript'
              : 'Processing'
            : review
              ? 'Needs review'
              : ready
                ? 'Ready to start'
                : 'Up next';
      return { ...item, done, waiting, status, steps };
    });
  const next = stages.find((stage) => !stage.done);
  return (
    <ol className="goal-chart-steps" aria-label="Current preparation step breakdown">
      {stages.map((stage) => (
        <li
          key={stage.id}
          data-state={stage.done ? 'complete' : stage.waiting ? 'waiting' : 'remaining'}
          aria-current={stage.id === next?.id ? 'step' : undefined}
          title={stage.steps.map((step) => step.reason).join('\n')}
        >
          {stage.done ? (
            <Check size={15} aria-hidden="true" />
          ) : stage.waiting ? (
            <Clock3 size={15} aria-hidden="true" />
          ) : (
            <Circle size={15} aria-hidden="true" />
          )}
          <span>{stage.label}</span>
          <small>{stage.status}</small>
        </li>
      ))}
    </ol>
  );
}

export function GoalChartMilestones({
  insights,
  onSelect,
}: {
  insights: ReturnType<typeof chartInsights>;
  onSelect: (event: GoalProgressEvent) => void;
}) {
  const changes = insights.filter((point) => point.milestone).reverse();
  const named = changes.filter(
    (point) => !['Preparation updated', 'Starting point'].includes(point.label),
  );
  const candidates = named.length ? named : changes;
  const milestones = candidates
    .filter(
      (point, index) =>
        candidates.findIndex(
          (other) => other.label === point.label && other.detail === point.detail,
        ) === index,
    )
    .slice(0, 3);
  if (!milestones.length) return null;
  return (
    <div className="goal-chart-milestones">
      <div className="goal-chart-section-label">
        Recent milestones <span>Select to inspect saved work</span>
      </div>
      <ol>
        {milestones.map(({ event, label, detail }) => (
          <li key={event.id}>
            <button type="button" onClick={() => onSelect(event)}>
              <time dateTime={event.recordedAt} title={new Date(event.recordedAt).toLocaleString()}>
                {new Date(event.recordedAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </time>
              <strong>
                {label} <ArrowUpRight size={14} aria-hidden="true" />
              </strong>
              <span>{detail}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
