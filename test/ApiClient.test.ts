import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as ApiClient from '../src/web/ApiClient.js';
import { LocalSessionError } from '../src/contracts/LocalSession.js';

function expiredSession(): Response {
  return Response.json(
    { error: 'Session ended.', code: LocalSessionError.REQUIRED },
    { status: 401 },
  );
}

let request: typeof ApiClient.request;
beforeEach(async () => {
  vi.resetModules();
  request = (await import('../src/web/ApiClient.js')).request;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Browser API requests', () => {
  it('coalesces simultaneous reads and validates each consumer without caching completed reads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.allSettled([
      request('/state', z.object({ ok: z.literal(true) }), undefined, 'GET'),
      request('/state', z.object({ missing: z.string() }), undefined, 'GET'),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(fetchMock).toHaveBeenCalledOnce();
    await request('/state', z.unknown(), undefined, 'GET');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let an earlier in-flight read satisfy a post-command refresh', async () => {
    let resolve: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ version: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const earlier = request('/state', z.unknown(), undefined, 'GET');
    await request('/profile', z.unknown(), { name: 'Updated' }, 'PUT');
    await expect(request('/state', z.unknown(), undefined, 'GET')).resolves.toEqual({ version: 2 });
    resolve?.(Response.json({ version: 1 }));
    await expect(earlier).resolves.toEqual({ version: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears a failed shared read so an explicit retry can recover', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.allSettled([
      request('/state', z.unknown(), undefined, 'GET'),
      request('/state', z.unknown(), undefined, 'GET'),
    ]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    await expect(request('/state', z.unknown(), undefined, 'GET')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renews a rejected session and replays the exact form submission once', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await request('/profile', z.object({ ok: z.literal(true) }), { name: 'Example' }, 'PUT');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/session', { method: 'POST' }]);
    expect(fetchMock.mock.calls[2]).toEqual(fetchMock.mock.calls[0]);
  });

  it('shares session renewal between simultaneous rejected requests', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(expiredSession())
      .mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      request('/state', z.unknown(), undefined, 'GET'),
      request('/profile', z.unknown(), { name: 'Example' }, 'PUT'),
    ]);

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('stops after a second session rejection', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(expiredSession());
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/state', z.unknown(), undefined, 'GET')).rejects.toThrow(
      'Session ended.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps the submission rejected when renewal fails and permits a later retry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(Response.json({ error: 'Unavailable.' }, { status: 503 }))
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/profile', z.unknown(), {})).rejects.toThrow('Unavailable.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(request('/profile', z.unknown(), {})).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it.each([400, 401, 403, 500])('does not replay other failures (%s)', async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 'Rejected.' }, { status }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/profile', z.unknown(), {})).rejects.toThrow('Rejected.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pauses all polling and submissions after a rate limit, then permits a later explicit retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: 'Busy.' }, { status: 429, headers: { 'retry-after': '12' } }),
      )
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/preparation-plan', z.unknown(), undefined, 'GET')).rejects.toThrow(
      '12 seconds',
    );
    await expect(request('/state', z.unknown(), undefined, 'GET')).rejects.toThrow('12 seconds');
    await expect(request('/profile', z.unknown(), { name: 'Example' }, 'PUT')).rejects.toThrow(
      '12 seconds',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(12000);
    await expect(request('/state', z.unknown(), undefined, 'GET')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('backs off session renewal without replaying a write when recovery is rate limited', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(Response.json({ error: 'Busy.' }, { status: 429 }))
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/profile', z.unknown(), {})).rejects.toThrow('60 seconds');
    await expect(request('/state', z.unknown(), undefined, 'GET')).rejects.toThrow('60 seconds');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60000);
    await expect(request('/state', z.unknown(), undefined, 'GET')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/profile')).toHaveLength(1);
  });

  it('honors a Retry-After HTTP date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T01:00:00Z'));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {},
          { status: 429, headers: { 'retry-after': 'Sun, 18 Oct 2026 01:00:20 GMT' } },
        ),
      )
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/state', z.unknown(), undefined, 'GET')).rejects.toThrow('20 seconds');
    vi.advanceTimersByTime(20000);
    await expect(request('/state', z.unknown(), undefined, 'GET')).resolves.toEqual({ ok: true });
  });

  it('does not replay a network failure with an unknown save outcome', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/profile', z.unknown(), {})).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not advertise an empty body as JSON when starting the local session', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('/session', z.object({ ok: z.boolean() }));
    expect(fetchMock).toHaveBeenCalledWith('/api/session', { method: 'POST' });
  });

  it('serializes and validates requests with JSON bodies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('/profile', z.object({ ok: z.boolean() }), { name: 'Example' }, 'PUT');
    expect(fetchMock).toHaveBeenCalledWith('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Example"}',
    });
  });
});
