import { ApiRateLimitError } from './ApiClient.js';

/** Bounded recovery for a read-only view. Never use this to replay provider starts or saves. */
export function recoverSavedRead<T>(
  read: () => Promise<T>,
  receive: (value: T) => void,
  fail: (error: unknown) => void,
  pause: () => void,
): () => void {
  let cancelled = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = async () => {
    try {
      const value = await read();
      if (!cancelled) receive(value);
    } catch (error) {
      if (cancelled) return;
      if (error instanceof ApiRateLimitError && attempts < 3) {
        attempts += 1;
        pause();
        timer = setTimeout(() => void load(), Math.max(1000, error.retryAt - Date.now()));
      } else fail(error);
    }
  };
  void load();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
