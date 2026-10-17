import { CronExpressionParser } from 'cron-parser';
import type { Schedule } from '../contracts/Workspace.js';
export function nextScheduledCheck(
  schedule: Pick<Schedule, 'frequency' | 'timezone'>,
  now: Date,
): string | null {
  if (schedule.frequency === 'paused') {
    return null;
  }
  return CronExpressionParser.parse(schedule.frequency === 'weekly' ? '0 9 * * 1' : '0 9 * * 1-5', {
    currentDate: now,
    tz: schedule.timezone,
  })
    .next()
    .toISOString();
}
