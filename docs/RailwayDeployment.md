# Shared Railway demo

The deployment has three services: `web` (Fastify plus built React assets), `worker`
(the existing PostgreSQL-backed queue and scheduler), and `Postgres` with persistent storage.
The same Dockerfile builds web and worker with Node 24 and pnpm 11.16.0.
Only web needs a public HTTPS domain. Use one replica per application service initially.

## Access and shared data

The current demo explicitly uses `HOSTED_ACCESS_MODE=public-demo`: anyone with its link
can open and edit the same workspace, without an account or password. The browser still
establishes its API cookie automatically, and origin checks, rate limits and signed provider
callbacks remain enforced. Provider credentials stay on the server.

`HOSTING_MODE=hosted` always requires an HTTPS `WEB_ORIGIN`. The default
`HOSTED_ACCESS_MODE=accounts` instead requires `HOSTED_ACCOUNTS` containing
an array of `{ "username": "guest", "passwordSha256": "<64 lowercase hex characters>",
"workspaceId": "tidewell" }` entries. Generate each password from at least 24 random bytes;
the SHA-256 value is appropriate here only for generated high-entropy credentials, not
human-selected passwords. Store account configuration in service secrets.

In accounts mode, browsers use the `/login` sign-in page, which works without browser HTTP authentication
popups. Successful sign-in sets a Secure, HttpOnly, SameSite=Strict cookie; every private
HTML and API request requires a valid session and membership in the existing workspace. All members can see and change
the same company data, financials, research and practice history. There are no private guest
workspaces or read-only roles. Removing an account or changing its hash revokes its next request
after redeployment. Sessions expire after eight hours or when the web process restarts.
They are held in a bounded in-memory store, so keep the web service at one replica.
Visit `/login` to sign out, which revokes that session immediately. Login and logout require
a matching Origin; password attempts are rate-limited. Use a private window on shared devices. Health is public and reveals no workspace data.
ElevenLabs callbacks bypass account login but still require the original signed webhook checks.

One voice/video rehearsal can be active across this shared workspace at a time. Guests take
turns. Use fictional data for demos and preserve its labels. Existing financial snapshots and
history must not be overwritten to reset a demonstration.

## Runtime configuration

- Both app services: `DATABASE_URL` references the Railway Postgres private URL,
  `HOSTING_MODE=hosted` and `WEB_ORIGIN=https://<web-domain>`. Set
  `HOSTED_ACCESS_MODE=public-demo` for the open shared demo; accounts mode requires `HOSTED_ACCOUNTS`.
- Web: `PORT=8080`, start command `pnpm start`, healthcheck `/api/health`.
- Worker: start command `pnpm worker`; no public domain or HTTP healthcheck. Keep it running
  for schedules and queued work; inspect the existing worker heartbeat.
- Provider settings come from the June project's own configuration. Keep API keys server-side.
  OpenAI/Exa enable research, ElevenLabs enables voice, LiveAvatar enables video, and Resend
  enables opted-in founder alerts. Existing provider usage is billed separately from hosting.
- Set the ElevenLabs post-call callback to `https://<web-domain>/api/webhooks/elevenlabs`.
  Preserve HMAC authentication. A local ngrok tunnel is unnecessary for hosted callbacks.

The image generates Prisma and builds the application without provider secrets. Prisma
generation uses a nonconnecting placeholder URL. Railway's pre-deploy command runs
`pnpm db:deploy` against the real database; the image retains Prisma CLI/config dependencies.
The repository `railway.toml` supplies this command and restart policy. Vite build does not
apply local-development origin validation to the hosted URL.

## Automatic releases from main

Both Railway services connect to `ducnguyen67201/CatalystHackathon2026`, branch `main`,
with GitHub autodeploy enabled and **Wait for CI** enabled. The `Verify` GitHub Actions
workflow runs on pull requests and pushes to `main`. It checks lint, formatting, types,
unit tests, frontend/backend builds, and integration tests against a temporary PostgreSQL
18 database, including applying the committed migrations. No production secrets are needed
in GitHub Actions.

After CI succeeds, Railway builds the repository Dockerfile for each service. `pnpm build`
produces the frontend in `dist/web` and backend/worker code in `dist/server`. Web runs
`pnpm start`, serving the frontend and API at the existing public URL; worker runs
`pnpm worker` against the same private database.

The committed `railway.toml` runs `pnpm db:deploy` before either new process starts.
That command uses `prisma migrate deploy`, applying pending files from `prisma/migrations`
without resetting or seeding the hosted database. Prisma tracks applied migrations and
locks concurrent migration runs. A failed migration blocks that service's new deployment.
Commit each schema change with its migration; `prisma db push` is not part of deployment.
Migrations must remain compatible with the previous app version during the rollout.

Railway settings can be reconnected with:

```sh
railway service source connect --repo ducnguyen67201/CatalystHackathon2026 --branch main --service web
railway service source connect --repo ducnguyen67201/CatalystHackathon2026 --branch main --service worker
```

Enable **Wait for CI** for both source triggers after connecting. Check that a release's
commit SHA matches `main`, both deployments succeed, pre-deploy logs show migration
completion, the public workspace loads, and the worker heartbeat advances.

## Data transfer and rollout

Take a consistent PostgreSQL dump of the existing June database and restore it into the
new, empty Railway database before starting the application services. Keep dumps private,
outside the image and version control. Compare table counts and preserved content before
enabling the worker. Keep the local database intact; the hosted copy becomes independent,
so later local edits are not synchronized. Existing queue and schedule state is copied too.

Deploy the web service after all required checks pass, then the worker. Confirm access matches
the configured mode (direct entry for public demo, sign-in for accounts), direct SPA routes load,
health responds, the worker heartbeat advances, and an invalid webhook signature is rejected.
Do not start paid voice/video or inference calls merely to check deployment health.

Before handing off implementation changes, run `pnpm lint`, `pnpm format:check`,
`pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:integration`.
Enable database backups and verify a restore before relying on the hosted copy as the only
source of business data. Application rollback does not undo database migrations.

The initial deployment account's Railway API requires Pro for native scheduled and manual
volume backups. No plan upgrade was made. A private local dump preserves the initial import;
it is not an ongoing backup of subsequent hosted edits.

## References checked October 17, 2026

- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command)
- [Public HTTPS networking](https://docs.railway.com/networking/public-networking)
- [PostgreSQL](https://docs.railway.com/databases/postgresql)
- [Backups](https://docs.railway.com/volumes/backups)
- [Pricing](https://railway.com/pricing)
- [Doppler integration](https://docs.doppler.com/docs/railway)
