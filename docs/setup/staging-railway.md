# Staging Deployment (Railway)

This runbook makes staging deployment repeatable from repository configuration. Cloud provisioning is
still a manual operator step.

## Target topology

Create one Railway project with these services:
- `postgres` (Railway Postgres)
- `web` (Next.js app from `apps/web`)
- `worker` (background worker from `apps/worker`)

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
- `HYPEAUDITOR_API_KEY` (can be empty in Week 0)
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

## Rollback checklist

1. Find the last known good deployment in Railway.
2. Redeploy that version for `web` and `worker`.
3. If rollback crosses a migration boundary, stop and assess DB compatibility before any down-migration action.
4. Re-run quick verification:
   - web homepage loads
   - worker startup logs show clean boot
