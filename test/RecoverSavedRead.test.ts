import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRateLimitError } from '../src/web/ApiClient.js';
import { recoverSavedRead } from '../src/web/RecoverSavedRead.js';

afterEach(() => vi.useRealTimers());

describe('saved scenario read recovery', () => {
  it('waits for Retry-After and delivers the saved view without user intervention', async () => {
    vi.useFakeTimers();
    const saved = { id: 'saved-scenario' };
    const read = vi
      .fn<() => Promise<typeof saved>>()
      .mockRejectedValueOnce(new ApiRateLimitError(Date.now() + 12000))
      .mockResolvedValue(saved);
    const receive = vi.fn();
    const fail = vi.fn();
    const pause = vi.fn();
    recoverSavedRead(read, receive, fail, pause);
    await vi.advanceTimersByTimeAsync(11999);
    expect(read).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledOnce();
    expect(receive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledWith(saved);
    expect(fail).not.toHaveBeenCalled();
  });

  it('cancels a scheduled retry on navigation', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValue(new ApiRateLimitError(Date.now() + 1000));
    const receive = vi.fn();
    const fail = vi.fn();
    const cancel = recoverSavedRead(read, receive, fail, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledOnce();
    expect(receive).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it('ignores an in-flight response after navigation', async () => {
    let resolve: ((value: string) => void) | undefined;
    const read = () =>
      new Promise<string>((done) => {
        resolve = done;
      });
    const receive = vi.fn();
    const cancel = recoverSavedRead(read, receive, vi.fn(), vi.fn());
    cancel();
    resolve?.('earlier scenario');
    await Promise.resolve();
    expect(receive).not.toHaveBeenCalled();
  });

  it('stops automatic recovery after three retries', async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockImplementation(() => Promise.reject(new ApiRateLimitError(Date.now() + 1000)));
    const fail = vi.fn();
    recoverSavedRead(read, vi.fn(), fail, vi.fn());
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(fail).toHaveBeenCalledOnce();
  });

  it.each(['Unavailable saved scenario.', 'Failed to fetch'])(
    'does not repeatedly retry a non-rate-limit error: %s',
    async (message) => {
      vi.useFakeTimers();
      const error = new Error(message);
      const read = vi.fn().mockRejectedValue(error);
      const fail = vi.fn();
      recoverSavedRead(read, vi.fn(), fail, vi.fn());
      await vi.advanceTimersByTimeAsync(60000);
      expect(read).toHaveBeenCalledOnce();
      expect(fail).toHaveBeenCalledWith(error);
    },
  );
});
