import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { request } from '../src/web/ApiClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser API requests', () => {
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
