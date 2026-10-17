import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { request } from '../src/web/ApiClient.js';
import { LocalSessionError } from '../src/contracts/LocalSession.js';

function expiredSession(): Response {
  return Response.json(
    { error: 'Session ended.', code: LocalSessionError.REQUIRED },
    { status: 401 },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser API requests', () => {
  it('renews a rejected session and replays the exact onboarding submission once', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(expiredSession())
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await request(
      '/onboarding/meeting',
      z.object({ ok: z.literal(true) }),
      { meeting: null },
      'PUT',
    );

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
      request('/onboarding/meeting', z.unknown(), { meeting: null }, 'PUT'),
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

    await expect(request('/onboarding/meeting', z.unknown(), {})).rejects.toThrow('Unavailable.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(request('/onboarding/meeting', z.unknown(), {})).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it.each([400, 401, 403, 500])('does not replay other failures (%s)', async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 'Rejected.' }, { status }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/onboarding/meeting', z.unknown(), {})).rejects.toThrow('Rejected.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay a network failure with an unknown save outcome', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request('/onboarding/meeting', z.unknown(), {})).rejects.toThrow(
      'Failed to fetch',
    );
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
