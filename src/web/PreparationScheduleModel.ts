import { Decimal } from 'decimal.js';
import type { PreparationView } from '../contracts/FundraisingPreparation.js';

const dayMs = 86400000;
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
  const saved = view.schedule;
  const savedCurrent = !!saved && saved.goalId === view.goal?.id && saved.planId === view.plan?.id;
  const suggested = !savedCurrent;
  const assumption = savedCurrent
    ? saved
    : {
        dailyHours: 0.5,
        cashExpectedDate: null,
        hours: { financial: 0.5, investor: 0.5, brief: 0.5, rehearse: 1 },
      };
  const current = !!view.goal && !!view.plan && !view.outdated;
  const cashDate = current ? assumption.cashExpectedDate : null;
  const validCash = !!cashDate && cashDate >= today;
  const complete = view.milestones.every((item) => item.status === 'complete') && !view.outdated;
  const reason = view.outdated
    ? 'Saved evidence changed. Refresh the plan.'
    : !current
      ? 'Set your goal to prepare the next steps.'
      : cashDate !== null && !validCash
        ? 'Confirm a future cash-evidence delivery date; receipt is not verified.'
        : null;
  const capacity = new Decimal(assumption.dailyHours).mul(pace);
  let cursor = new Decimal(start);
  const rows = view.milestones.map((milestone) => {
    const key = milestone.id;
    const hours =
      current &&
      key !== 'strategy' &&
      (key === 'financial' || key === 'investor' || key === 'brief' || key === 'rehearse')
        ? assumption.hours[key]
        : null;
    if (key === 'brief' && validCash) cursor = Decimal.max(cursor, dayNumber(cashDate));
    const from = cursor.toNumber();
    if (milestone.status !== 'complete' && hours !== null)
      cursor = cursor.plus(new Decimal(hours).div(capacity));
    return { ...milestone, hours, from, to: cursor.toNumber() };
  });
  const finish = complete ? today : reason ? null : dayString(cursor.ceil().toNumber());
  const buffer =
    finish && view.goal?.targetDate ? dayNumber(view.goal.targetDate) - dayNumber(finish) : null;
  const tone: ScheduleTone = complete
    ? 'complete'
    : !finish || buffer === null
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
    suggested,
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
