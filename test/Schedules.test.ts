import { describe, it, expect } from 'vitest';
import { nextScheduledCheck } from '../src/features/Schedules.js';
describe('Persistent schedule calculation', () => {
  it('honors the local time across daylight-saving transitions and weekends', () => {
    expect(
      nextScheduledCheck(
        { frequency: 'weekdays', timezone: 'America/Toronto' },
        new Date('2026-03-06T15:00:00Z'),
      ),
    ).toBe('2026-03-09T13:00:00.000Z');
  });
  it('does not schedule a paused radar', () => {
    expect(
      nextScheduledCheck({ frequency: 'paused', timezone: 'America/Toronto' }, new Date()),
    ).toBeNull();
  });
});
