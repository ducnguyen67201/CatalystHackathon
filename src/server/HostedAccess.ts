import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Environment } from './Env.js';

const cookieName = '__Host-june_access';
const sessionSeconds = 8 * 60 * 60;
const credentialsSchema = z
  .object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) })
  .strict();
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;

function loginPage(error = '', signedIn = false): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · June</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f5f1;color:#242c29;font:16px system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:420px;background:white;border:1px solid #dedfd8;border-radius:20px;padding:36px}
h1{margin:0 0 12px;font-size:30px}p{line-height:1.5;color:#58615c}label{display:block;margin:20px 0 8px;font-weight:600}
input,button,a{font:inherit}input{width:100%;padding:12px;border:1px solid #a4aca6;border-radius:8px}
button{width:100%;margin-top:24px;padding:13px;background:#284d3b;color:white;border:0;border-radius:8px;cursor:pointer}
a{color:#284d3b}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #6b967d;outline-offset:3px}.error{color:#a12a2a}
</style></head><body><main><h1>Welcome to June</h1>
<p>Sign in to the shared demo workspace. Everyone here uses the same company data and practice history.</p>
${error ? `<p class="error" role="alert">${error}</p>` : ''}
${
  signedIn
    ? '<p>You are signed in. <a href="/">Open workspace</a></p><form method="post" action="/logout"><button type="submit">Sign out</button></form>'
    : `<form method="post" action="/login">
<label for="username">Username</label><input id="username" name="username" autocomplete="username" maxlength="64" required autofocus>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required>
<button type="submit">Sign in</button></form>`
}
</main></body></html>`;
}

/** Explicit account membership and bounded, process-local sessions for one demo replica. */
export function registerHostedAccess(app: FastifyInstance, env: Environment): void {
  if (env.HOSTING_MODE !== 'hosted') return;
  app.addHook('onSend', (_request, reply, payload, done) => {
    reply.header('Cache-Control', 'private, no-store');
    done(null, payload);
  });
  if (env.HOSTED_ACCESS_MODE === 'public-demo') return;
  const accounts = env.HOSTED_ACCOUNTS;
  if (!accounts?.length) throw new Error('Hosted accounts are required.');
  const sessions = new Map<string, { username: string; expiresAt: number }>();
  const isSignedIn = (token: string): boolean => {
    const session = sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return false;
    }
    return accounts.some((account) => account.username === session.username);
  };

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      const fields = new URLSearchParams(String(body));
      const entries = [...fields.entries()];
      // Duplicate form fields must not silently override credentials.
      done(
        null,
        new Set(fields.keys()).size === entries.length ? Object.fromEntries(entries) : null,
      );
    },
  );
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname === '/api/health' || pathname === '/api/webhooks/elevenlabs') return;
    reply.header('Cache-Control', 'private, no-store');
    if (pathname === '/login' || pathname === '/logout') {
      reply.header('X-Frame-Options', 'DENY');
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      if (
        request.method !== 'GET' &&
        request.method !== 'HEAD' &&
        (request.headers.origin !== env.WEB_ORIGIN ||
          request.headers['sec-fetch-site'] === 'cross-site')
      ) {
        return reply.code(403).send({ error: 'Origin is not allowed.' });
      }
      return;
    }
    if (isSignedIn(request.cookies[cookieName] ?? '')) return;
    if ((request.method === 'GET' || request.method === 'HEAD') && !pathname?.startsWith('/api')) {
      return reply.redirect('/login', 303);
    }
    return reply.code(401).send({ error: 'Your demo session ended. Reload to sign in again.' });
  });
  app.get('/login', async (request, reply) =>
    reply.type('text/html').send(loginPage('', isSignedIn(request.cookies[cookieName] ?? ''))),
  );
  app.post(
    '/login',
    { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const credentials = credentialsSchema.safeParse(request.body);
      const account = accounts.find(
        (candidate) => credentials.success && candidate.username === credentials.data.username,
      );
      const supplied = createHash('sha256')
        .update(credentials.success ? credentials.data.password : '')
        .digest();
      const expected = Buffer.from(account?.passwordSha256 ?? '0'.repeat(64), 'hex');
      if (!timingSafeEqual(supplied, expected) || !account) {
        return reply
          .code(401)
          .type('text/html')
          .send(loginPage('Username or password is incorrect.'));
      }
      const now = Date.now();
      for (const [token, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(token);
      }
      sessions.delete(request.cookies[cookieName] ?? '');
      if (sessions.size >= 1000) {
        return reply
          .code(503)
          .type('text/html')
          .send(loginPage('Please try signing in again later.'));
      }
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { username: account.username, expiresAt: now + sessionSeconds * 1000 });
      reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: sessionSeconds });
      return reply.redirect('/', 303);
    },
  );
  app.post('/logout', async (request, reply) => {
    sessions.delete(request.cookies[cookieName] ?? '');
    reply.clearCookie(cookieName, cookieOptions);
    reply.clearCookie('june_session', cookieOptions);
    return reply.redirect('/login', 303);
  });
  app.addHook('onClose', (_instance, done) => {
    sessions.clear();
    done();
  });
}
