import { Decimal } from 'decimal.js';
import type { PreparationView } from '../contracts/FundraisingPreparation.js';

const dayMs = 86400000;
export const defaultPreparationAssumptions = {
  dailyHours: 2,
  cashExpectedDate: null,
  hours: { financial: 2, investor: 2, brief: 2, rehearse: 4 },
};
export function preparationDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / dayMs;
export const dayString = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);
export type ScheduleTone = 'unknown' | 'on_track' | 'ahead' | 'at_risk' | 'behind' | 'complete';
export function projectSchedule(view: PreparationView, pace = 1, now = new Date()) {
  const today = preparationDay(now, view.goal?.timezone ?? 'UTC');
  const start = dayNumber(today);
  const assumption = view.schedule;
  const current = !!assumption && assumption.goalId === view.goal?.id && !view.outdated;
  const estimates = current ? assumption : defaultPreparationAssumptions;
  const automatic = !current;
  const reused = current && assumption.planId !== view.plan?.id;
  const cashDate = current ? assumption.cashExpectedDate : null;
  const validCash = !!cashDate && cashDate >= today;
  const complete = view.milestones.every((item) => item.status === 'complete') && !view.outdated;
  const reason = complete
    ? null
    : view.outdated
      ? 'Saved evidence changed. Refresh the plan.'
      : automatic
        ? 'Automatic work-only estimate: 2 hours/day; financial review 2h, investor selection 2h, brief 2h, practice and feedback 4h. Edit these assumptions to match your availability. Cash-evidence delivery is unconfirmed.'
        : !validCash
          ? 'Work-only estimate. Cash-evidence delivery is missing or overdue; external waiting time is excluded. Confirm its date to include it.'
          : reused
            ? 'Using your saved effort and availability for the updated plan. Completed work is excluded; review remaining effort when the scope changes.'
            : null;
  const capacity = new Decimal(estimates.dailyHours).mul(pace);
  let cursor = new Decimal(start);
  const rows = view.milestones.map((milestone) => {
    const key = milestone.id;
    const hours =
      key !== 'strategy' &&
      (key === 'financial' || key === 'investor' || key === 'brief' || key === 'rehearse')
        ? estimates.hours[key]
        : null;
    if (key === 'brief' && milestone.status !== 'complete' && validCash)
      cursor = Decimal.max(cursor, dayNumber(cashDate));
    const from = cursor.toNumber();
    if (milestone.status !== 'complete' && hours !== null)
      cursor = cursor.plus(new Decimal(hours).div(capacity));
    return { ...milestone, hours, from, to: cursor.toNumber() };
  });
  const finish = complete ? today : view.outdated ? null : dayString(cursor.ceil().toNumber());
  const buffer =
    finish && view.goal?.targetDate ? dayNumber(view.goal.targetDate) - dayNumber(finish) : null;
  const tone: ScheduleTone = complete
    ? 'complete'
    : !finish || buffer === null || automatic || !validCash
      ? 'unknown'
      : buffer < 0
        ? 'behind'
        : buffer === 0
          ? 'at_risk'
          : pace > 1
            ? 'ahead'
            : 'on_track';
  const label =
    tone === 'complete'
      ? 'Preparation reviewed'
      : !finish
        ? 'Pace unknown'
        : automatic || !validCash
          ? 'Provisional work estimate'
          : buffer === null
            ? 'Set a preparation target to assess pace'
            : buffer < 0
              ? `Behind target · ${-buffer} day${buffer === -1 ? '' : 's'} late`
              : buffer === 0
                ? 'At risk · no buffer'
                : `${pace > 1 ? 'Ahead in this scenario' : 'On track'} · ${buffer} day${buffer === 1 ? '' : 's'} of buffer`;
  // Unique current accepted artifacts only; re-accepting or revoked reviews do not inflate this count.
  const reviewed = new Set(
    view.decisions
      .filter(
        (decision) =>
          decision.kind === 'accepted' &&
          Date.parse(decision.createdAt) <= now.getTime() &&
          Date.parse(decision.createdAt) >= now.getTime() - 7 * dayMs &&
          view.decisions.findLast((item) => item.artifactId === decision.artifactId)?.id ===
            decision.id,
      )
      .map((decision) => decision.artifactId),
  ).size;
  const next = rows.find((row) => row.status !== 'complete');
  return {
    today,
    start,
    rows,
    finish,
    buffer,
    tone,
    label,
    reason,
    current,
    automatic,
    reused,
    estimates,
    workOnly: !validCash,
    reviewed,
    next,
    capacity: capacity.toString(),
    end: Math.max(
      start + 7,
      finish ? dayNumber(finish) + 1 : start + 7,
      view.goal?.targetDate ? dayNumber(view.goal.targetDate) + 1 : start + 7,
    ),
  };
}
