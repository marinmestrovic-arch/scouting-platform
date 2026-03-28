# Staging Deployment (Railway)

This runbook makes staging deployment repeatable from repository configuration. Cloud provisioning is
still a manual operator step.

For launch gating, pair this with:

- [`/docs/setup/launch-readiness.md`](./launch-readiness.md)
- [`/docs/setup/postgres-backup-restore-drill.md`](./postgres-backup-restore-drill.md)

## Target topology

Create one Railway project with these services:
- `postgres` (Railway Postgres)
- `web` (Next.js app from `frontend/web`)
- `worker` (background worker from `backend/worker`)

## Service commands

Use monorepo-root working directory for both services.

### Web service

- Install command: `corepack enable && corepack prepare pnpm@10.6.1 --activate && pnpm install --frozen-lockfile`
- Build command: `pnpm --filter @scouting-platform/web build`
- Start command: `pnpm --filter @scouting-platform/web start`

### Worker service

- Install command: `corepack enable && corepack prepare pnpm@10.6.1 --activate && pnpm install --frozen-lockfile`
- Build command: `pnpm --filter @scouting-platform/worker build`
- Start command: `pnpm --filter @scouting-platform/worker start`

## Required environment variables

Set these in both `web` and `worker` services unless marked otherwise:

- `DATABASE_URL` (from Railway Postgres)
- `PG_BOSS_SCHEMA=pgboss`
- `AUTH_SECRET` (required for web, optional for worker in Week 0)
- `APP_ENCRYPTION_KEY` (32-byte key)
- `NEXT_PUBLIC_APP_URL` (required for web)
- `OPENAI_API_KEY` (can be empty in Week 0)
- `OPENAI_MODEL=gpt-5-nano`
- `HYPEAUDITOR_API_KEY` (can be empty in Week 0; use `<auth_id>:<auth_token>` once enabled)
- `HUBSPOT_API_KEY` (can be empty in Week 0)
- `LOG_LEVEL=info`

## First deploy checklist

1. Create Railway project and attach Postgres service.
2. Create `web` and `worker` services from this repository.
3. Configure commands above for each service.
4. Populate required environment variables.
5. Run database migrations once against staging DB:
   - `pnpm --filter @scouting-platform/db db:migrate:deploy`
6. Deploy `web` and `worker`.
7. Verify health:
   - `web` serves `/`
   - `worker` starts and logs queue initialization
8. Keep local reliability checks green before promoting staging changes:
   - run local Week 3 DB integration prep and verification from [`/docs/setup/local.md`](./local.md)

## Staging smoke checklist

Run this after every staging deploy that is a launch candidate:

1. Sign in with a valid admin account.
2. Confirm dashboard loads and recent runs render.
3. Create a new scouting run and wait for persisted results.
4. Open a channel detail page and request LLM enrichment.
5. Request a HypeAuditor report, approve it as admin, and confirm status progression is visible.
6. Run one CSV import and confirm row-level results are visible.
7. Run one CSV export and confirm the artifact downloads.
8. Run one HubSpot flow and confirm per-row saved results are visible.
9. Exercise light queue concurrency by overlapping at least two background actions, preferably one run plus one channel enrichment, and confirm both progress without duplicate or stuck states.

Record all failures as bugs before promotion. Do not treat them as justification for unrelated feature work.

## Rollback checklist

1. Find the last known good deployment in Railway.
2. Redeploy that version for `web` and `worker`.
3. If rollback crosses a migration boundary, stop and assess DB compatibility before any down-migration action.
4. Only roll back app services automatically when the previous app version is known to be schema-compatible with the current database state.
5. If schema compatibility is uncertain, pause rollback and restore service through forward-fix or database recovery planning rather than improvising a down-migration.
6. Re-run quick verification:
   - web homepage loads
   - worker startup logs show clean boot

## Backup and restore

Before launch, complete one restore drill using [`/docs/setup/postgres-backup-restore-drill.md`](./postgres-backup-restore-drill.md).
