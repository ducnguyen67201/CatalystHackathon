import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { readEnvironment } from '../src/server/Env.js';
import { registerHostedAccess } from '../src/server/HostedAccess.js';

const password = 'test-only-high-entropy-demo-credential';
const origin = 'https://june.example.com';
const env = readEnvironment({
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  HOSTING_MODE: 'hosted',
  WEB_ORIGIN: origin,
  HOSTED_ACCOUNTS: JSON.stringify([
    {
      username: 'guest',
      passwordSha256: createHash('sha256').update(password).digest('hex'),
      workspaceId: 'tidewell',
    },
  ]),
});

async function createApp() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  registerHostedAccess(app, env);
  app.get('/', () => 'Private app');
  app.post('/api/session', () => ({ ok: true }));
  app.get('/api/state', () => ({ private: true }));
  app.get('/api/health', () => ({ status: 'ready' }));
  app.post('/api/webhooks/elevenlabs', (_request, reply) =>
    reply.code(403).send({ error: 'Invalid signature' }),
  );
  return app;
}

const loginRequest = {
  method: 'POST',
  url: '/login',
  headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams({ username: 'guest', password }).toString(),
} as const;

describe('Hosted shared-workspace access', () => {
  it('offers a sign-in page without triggering browser HTTP authentication', async () => {
    const app = await createApp();
    try {
      const root = await app.inject('/');
      expect(root.statusCode).toBe(303);
      expect(root.headers.location).toBe('/login');
      expect(root.headers['www-authenticate']).toBeUndefined();
      const login = await app.inject('/login');
      expect(login.statusCode).toBe(200);
      expect(login.body).toContain('autocomplete="current-password"');
      expect(login.headers['cache-control']).toBe('private, no-store');
      expect(login.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      for (const url of ['/api/state', '/api/session']) {
        const response = await app.inject({
          method: url === '/api/session' ? 'POST' : 'GET',
          url,
          headers: { cookie: 'june_session=old; __Host-june_access=forged' },
        });
        expect(response.statusCode).toBe(401);
        expect(response.headers['www-authenticate']).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });

  it('authenticates form credentials, rotates sessions, and revokes them on logout', async () => {
    const app = await createApp();
    try {
      const login = await app.inject(loginRequest);
      expect(login.statusCode).toBe(303);
      expect(login.headers.location).toBe('/');
      const access = login.cookies[0];
      expect(access).toMatchObject({
        name: '__Host-june_access',
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
        path: '/',
      });
      const cookie = `${access?.name}=${access?.value}`;
      expect((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(200);
      const rotated = await app.inject({
        ...loginRequest,
        headers: { ...loginRequest.headers, cookie },
      });
      expect(rotated.cookies[0]?.value).not.toBe(access?.value);
      expect((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(401);
      const newCookie = `${rotated.cookies[0]?.name}=${rotated.cookies[0]?.value}`;
      expect((await app.inject({ url: '/', headers: { cookie: newCookie } })).statusCode).toBe(200);
      const logout = await app.inject({
        method: 'POST',
        url: '/logout',
        headers: { origin, cookie: newCookie },
      });
      expect(logout.statusCode).toBe(303);
      expect(logout.cookies.every((item) => item.value === '')).toBe(true);
      expect(
        (await app.inject({ url: '/api/state', headers: { cookie: newCookie } })).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects wrong, duplicate and oversized credentials and cross-site login/logout', async () => {
    const app = await createApp();
    try {
      for (const payload of [
        'username=guest&password=wrong',
        `username=unknown&password=${password}`,
        `${loginRequest.payload}&username=guest`,
        `username=guest&password=${'x'.repeat(257)}`,
      ]) {
        const response = await app.inject({ ...loginRequest, payload });
        expect(response.statusCode).toBe(401);
        expect(response.cookies).toHaveLength(0);
        expect(response.headers['www-authenticate']).toBeUndefined();
      }
      for (const url of ['/login', '/logout']) {
        for (const headers of [
          {},
          { origin: 'https://attacker.example' },
          { origin, 'sec-fetch-site': 'cross-site' },
        ]) {
          expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(403);
        }
      }
    } finally {
      await app.close();
    }
  });

  it('expires server-side sessions after eight hours', async () => {
    const app = await createApp();
    try {
      const login = await app.inject(loginRequest);
      const cookie = `${login.cookies[0]?.name}=${login.cookies[0]?.value}`;
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 60 * 60 * 1000 + 1);
      expect((await app.inject({ url: '/api/state', headers: { cookie } })).statusCode).toBe(401);
    } finally {
      vi.restoreAllMocks();
      await app.close();
    }
  });

  it('limits password attempts and leaves health and signed callbacks reachable', async () => {
    const app = await createApp();
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        expect(
          (await app.inject({ ...loginRequest, payload: 'username=guest&password=wrong' }))
            .statusCode,
        ).toBe(401);
      }
      expect((await app.inject(loginRequest)).statusCode).toBe(429);
      expect((await app.inject('/api/health')).statusCode).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: '/api/webhooks/elevenlabs' })).statusCode,
      ).toBe(403);
      expect((await app.inject('/api/health/other')).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
