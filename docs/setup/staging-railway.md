# Staging Deployment (Railway)

This runbook makes staging deployment repeatable from repository configuration. Cloud provisioning is
still a manual operator step.

Important:
- treat this as the Railway staging runbook
- the repository's automated production deploy currently targets Dokku; use [`/docs/setup/dokku.md`](./dokku.md) for that path

For launch gating, pair this with:

- [`/docs/setup/launch-readiness.md`](./launch-readiness.md)
- [`/docs/setup/postgres-backup-restore-drill.md`](./postgres-backup-restore-drill.md)
- [`/docs/setup/hubspot-v2.md`](./hubspot-v2.md) when the HubSpot integration is configured

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
- `HUBSPOT_ACCESS_TOKEN` (preferred; leave empty when HubSpot is not configured)
- `LOG_LEVEL=info`

Do not introduce new deployments with `HUBSPOT_API_KEY`; it is a deprecated fallback only. When
HubSpot is configured, copy the complete portal/property mapping from `.env.example` to both
services and use the canonical [`hubspot-v2.md`](./hubspot-v2.md) provisioning guide. At minimum,
set the numeric portal ID, both unique-property internal names, and the client/campaign custom-object
mappings.

Every first V2 deploy must use these values on both services:

```text
HUBSPOT_DIRECT_SYNC_ENABLED=false
HUBSPOT_WEBHOOKS_ENABLED=false
HUBSPOT_WEBHOOK_JOURNAL_ENABLED=false
HUBSPOT_UI_EXTENSIONS_ENABLED=false
```

Add `HUBSPOT_CLIENT_SECRET` through Railway's secret configuration when preparing signed
webhook/UI-extension requests, and add the numeric `HUBSPOT_APP_ID` when enabling the UI extension.
`HUBSPOT_CLIENT_ID` is reserved for a future OAuth flow and is not accepted as the signed extension
`appId`. Never expose any of these values as `NEXT_PUBLIC_*` variables.

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
8. Sign in as an admin and run the read-only Database HubSpot health check while all flags are off.
   Resolve scopes, unique properties, custom-object mappings, owner/pipeline references, and
   association blockers before any write test.
9. Keep local reliability checks green before promoting staging changes:
   - run local Week 3 DB integration prep and verification from [`/docs/setup/local.md`](./local.md)

## Staging smoke checklist

Run this after every staging deploy that is a launch candidate:

1. Sign in with a valid admin account.
2. Confirm dashboard loads and recent runs render.
3. Create a new scouting run and wait for persisted results.
4. Open a channel detail page and request LLM enrichment.
5. Open Dashboard and confirm each run row has the `Export` action to the handoff workspace.
6. Open Catalog and verify Country/Region plus median-view filters behave correctly.
7. Run one CSV import using the Creator List v3 header and confirm row-level results are visible.
8. Confirm Admin shows only CSV Imports and Users tabs.
9. Open Database and validate HubSpot health, object/reference sync, and conflict surfaces are
   admin-only. The fresh health action must not create portal records.
10. After the developer-test portal is provisioned, enable direct sync and validate one controlled
    run: one deal per run, persisted contact/deal links, intended associations, and visible partial
    row errors. Confirm **Download HubSpot CSV** still works as a fallback.
11. Exercise light queue concurrency by overlapping at least two background actions, preferably one run plus one channel enrichment, and confirm both progress without duplicate or stuck states.

Configure `https://<railway-public-origin>/api/integrations/hubspot/webhooks` only after the signed
route is deployed and `HUBSPOT_CLIENT_SECRET` is set. Standard push webhooks cover supported
contact/deal events; client/campaign custom objects continue through incremental/daily
reconciliation. Upload/install `/hubspot-app` separately in a developer test account; Railway does
not deploy that project.

Record all failures as bugs before promotion. Do not treat them as justification for unrelated feature work.

## Rollback checklist

1. Set `HUBSPOT_DIRECT_SYNC_ENABLED=false`, `HUBSPOT_WEBHOOKS_ENABLED=false`,
   `HUBSPOT_WEBHOOK_JOURNAL_ENABLED=false`, and `HUBSPOT_UI_EXTENSIONS_ENABLED=false` on both
   services. Keep CSV fallback available.
2. Find the last known good deployment in Railway.
3. Redeploy that version for `web` and `worker`.
4. If rollback crosses a migration boundary, stop and assess DB compatibility before any down-migration action.
5. Only roll back app services automatically when the previous app version is known to be schema-compatible with the current database state.
6. If schema compatibility is uncertain, pause rollback and restore service through forward-fix or database recovery planning rather than improvising a down-migration.
7. Preserve HubSpot portal/link, webhook, conflict, and batch rows, then re-run quick verification:
   - web homepage loads
   - worker startup logs show clean boot
   - read-only HubSpot health reports expected disabled/degraded state without a provider write

## Backup and restore

Before launch, complete one restore drill using [`/docs/setup/postgres-backup-restore-drill.md`](./postgres-backup-restore-drill.md).
