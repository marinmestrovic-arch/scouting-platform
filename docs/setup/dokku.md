# Dokku Deployment

This runbook documents a Dokku deployment path for `scouting-platform`.

Current repo docs still describe Railway as the recommended staging target. Use this guide when you
want to run the current architecture on your own VPS with Dokku.

For launch gating, pair this with:

- [`/docs/setup/launch-readiness.md`](./launch-readiness.md)
- [`/docs/setup/postgres-backup-restore-drill.md`](./postgres-backup-restore-drill.md)

## Target topology

Create one Dokku host with:

- `scouting-db` as a Dokku Postgres service
- `scouting-web` as the public Next.js app
- `scouting-worker` as the private queue worker

This matches the current architecture:

- `web`: Next.js app for Auth.js, UI, and route handlers
- `worker`: separate `pg-boss` process for discovery, enrichment, imports, exports, and HubSpot jobs
- `db`: Postgres as the only persistent database

## Important repo-specific note

The web app already has a dedicated production image at [`/docker/production/Dockerfile`](../../docker/production/Dockerfile).

The worker uses [`/docker/production/worker.Dockerfile`](../../docker/production/worker.Dockerfile)
instead of the current `pnpm --filter @scouting-platform/worker start` script because the worker
needs the full monorepo workspace available at runtime in the current repository layout.

The same worker image is also used for one-off operational commands:

- Prisma migrations
- initial admin seeding

If Dokku becomes the team-standard deployment topology, add an ADR before merge. Hosting and
deployment topology changes are ADR-governed in this repo.

## Prerequisites

Before provisioning apps:

- install Dokku on the VPS
- add your SSH key to Dokku
- point the desired app domain at the VPS public IP
- install the Dokku Postgres plugin
- install the Dokku Let's Encrypt plugin if you want automatic TLS

This guide assumes you can SSH into the host and run `dokku` commands directly.

## Required environment variables

`postgres:link` injects `DATABASE_URL` for both apps, so do not set it manually.

Set these on `scouting-web`:

- `AUTH_SECRET`
- `AUTH_TRUST_HOST=true`
- `AUTH_URL` (for example `https://scouting.example.com`)
- `APP_ENCRYPTION_KEY` (must be exactly 32 characters)
- `NEXT_PUBLIC_APP_URL` (for example `https://scouting.example.com`)
- `PG_BOSS_SCHEMA=pgboss`
- `OPENAI_MODEL=gpt-5-nano`
- `LOG_LEVEL=info`
- `OPENAI_API_KEY` if LLM enrichment is enabled
- `HYPEAUDITOR_API_KEY` if advanced reports are enabled
- `HUBSPOT_API_KEY` if HubSpot flows are enabled

Set these on `scouting-worker`:

- `APP_ENCRYPTION_KEY` (must match web)
- `PG_BOSS_SCHEMA=pgboss`
- `OPENAI_MODEL=gpt-5-nano`
- `LOG_LEVEL=info`
- `OPENAI_API_KEY` if LLM enrichment is enabled
- `HYPEAUDITOR_API_KEY` if advanced reports are enabled
- `HUBSPOT_API_KEY` if HubSpot flows are enabled

Notes:

- quote secrets if they contain `$`, `:`, spaces, or other shell-sensitive characters
- `DATABASE_URL_TEST` is not needed in production
- `AUTH_SECRET` is required on `scouting-web`; it is not required on `scouting-worker`
- `AUTH_URL` should match the public HTTPS origin for the web app when running behind Dokku's proxy

## Provision the apps

Run these commands on the Dokku host:

```bash
sudo dokku plugin:install https://github.com/dokku/dokku-postgres.git
sudo dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git

dokku apps:create scouting-web
dokku apps:create scouting-worker

dokku builder:set scouting-web selected dockerfile
dokku builder:set scouting-worker selected dockerfile

dokku builder-dockerfile:set scouting-web dockerfile-path docker/production/Dockerfile
dokku builder-dockerfile:set scouting-worker dockerfile-path docker/production/worker.Dockerfile

dokku proxy:disable scouting-worker
dokku checks:disable scouting-worker

dokku postgres:create scouting-db
dokku postgres:link scouting-db scouting-web
dokku postgres:link scouting-db scouting-worker
```

## Configure app secrets

Example configuration:

```bash
dokku config:set scouting-web \
  AUTH_SECRET='replace-with-long-random-secret' \
  AUTH_TRUST_HOST='true' \
  AUTH_URL='https://scouting.example.com' \
  APP_ENCRYPTION_KEY='32-char-random-string-goes-here' \
  NEXT_PUBLIC_APP_URL='https://scouting.example.com' \
  PG_BOSS_SCHEMA='pgboss' \
  OPENAI_MODEL='gpt-5-nano' \
  LOG_LEVEL='info'

dokku config:set scouting-worker \
  APP_ENCRYPTION_KEY='32-char-random-string-goes-here' \
  PG_BOSS_SCHEMA='pgboss' \
  OPENAI_MODEL='gpt-5-nano' \
  LOG_LEVEL='info'
```

Add provider keys to both apps when those integrations are enabled.

## First deploy

From your local clone, add Dokku remotes:

```bash
git remote add dokku-web dokku@your-vps-host:scouting-web
git remote add dokku-worker dokku@your-vps-host:scouting-worker
```

Deploy the worker first so you can use it for one-off DB operations:

```bash
git push dokku-worker main
```

Apply Prisma migrations from the worker app:

```bash
dokku run scouting-worker pnpm --filter @scouting-platform/db db:migrate:deploy
```

Seed the initial admin account:

```bash
dokku config:set scouting-worker \
  INITIAL_ADMIN_EMAIL='admin@example.com' \
  INITIAL_ADMIN_PASSWORD='replace-with-real-password' \
  INITIAL_ADMIN_NAME='Initial Admin'

dokku run scouting-worker pnpm --filter @scouting-platform/db db:seed:admin

dokku config:unset scouting-worker \
  INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_NAME
```

Then deploy the web app:

```bash
git push dokku-web main
```

Attach the public domain and enable TLS:

```bash
dokku domains:add scouting-web scouting.example.com
dokku letsencrypt:enable scouting-web
```

## Verification

After the first deploy:

- `dokku logs scouting-web -t`
- `dokku logs scouting-worker -t`
- `curl -I https://scouting.example.com/login`
- sign in with the seeded admin account
- create a scouting run and confirm the worker logs show queue activity
- exercise at least one queued workflow such as enrichment, export, or HubSpot prep

Minimum worker success signal:

- the worker boots cleanly
- queue names are created without startup failure
- a queued job transitions out of `queued`

## Routine deploy order

For follow-on deploys:

1. push `scouting-worker`
2. run `dokku run scouting-worker pnpm --filter @scouting-platform/db db:migrate:deploy`
3. push `scouting-web`
4. run the post-deploy smoke checks

This order matters because the web image is intentionally slim and is not the place to run Prisma
migration commands.

## GitHub Actions auto-deploy

The repository CI workflow can auto-deploy to Dokku after a successful push to `main`.

Important:

- the deploy job is guarded to run only in the upstream repository: `bobasaki/scouting-platform`
- pushes to fork branches or `origin/main` will still run CI, but they will not deploy
- deploy order stays the same as the manual runbook: worker -> migrations -> web -> smoke check

Configure these in the upstream GitHub repository under Settings -> Secrets and variables -> Actions.

Repository variables:

- `DOKKU_HOST` (for example `46.225.18.236`)
- `DOKKU_WEB_APP=scouting-web`
- `DOKKU_WORKER_APP=scouting-worker`
- `DOKKU_WEB_URL` (for example `https://scouting.example.com`)

Repository secrets:

- `DOKKU_DEPLOY_SSH_KEY`
- `DOKKU_KNOWN_HOSTS`

Recommended values:

- `DOKKU_DEPLOY_SSH_KEY` should be the private key for a Dokku deploy user/keypair that has access to both apps
- `DOKKU_KNOWN_HOSTS` should be the exact host key line for the Dokku server, for example:

```bash
ssh-keyscan -H 46.225.18.236
```

After those are configured in the upstream repo, every successful push to `upstream/main` will:

1. push the current commit to `scouting-worker`
2. run `db:migrate:deploy` through the worker app
3. push the same commit to `scouting-web`
4. smoke-check the login page URL

If deployment fails, the workflow tails recent Dokku logs for both apps to make diagnosis faster.

## Rollback notes

If you need to roll back:

1. identify the last known good app revision for `scouting-web` and `scouting-worker`
2. confirm the current DB schema is still compatible with that app revision
3. roll back the worker and web app services
4. re-run basic verification:
   - login page loads
   - worker boots cleanly
   - one queued job can be claimed and completed

Do not improvise a Prisma down-migration during an incident. If rollback crosses a schema boundary,
prefer a forward-fix or a database recovery plan.
