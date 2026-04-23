# Launch Readiness Checklist

Use this checklist as the Week 8 gate before internal launch or a production promotion.

## Scope guard

- No new feature work is in flight beyond bug fixes and launch hardening.
- Follow-on plan docs in `/docs/plans` remain deferred until this checklist is green.
- Any proposed precedence, queue-topology, or system-shape change is handled separately through an ADR.

## CI confidence

- `pnpm db:validate`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm --filter @scouting-platform/web build`
- `pnpm --filter @scouting-platform/worker build`
- `pnpm test:ci`
- `pnpm --filter @scouting-platform/web test:smoke`

All of the above must pass on `main` and on the release candidate branch or commit.

Current repo-local Week 8 baseline:

- `pnpm --filter @scouting-platform/db test -- --runInBand backend/packages/db/src/migrations.test.ts`
- `pnpm --filter @scouting-platform/core test -- --runInBand backend/packages/core/src/auth/password.test.ts`
- `pnpm --filter @scouting-platform/web build`
- `pnpm --filter @scouting-platform/worker build`
- `pnpm --filter @scouting-platform/web test:smoke`

The Playwright smoke suite now covers:

- homepage and login rendering
- authenticated redirect protection
- create run
- dashboard Export handoff action
- catalog filters by real profile and metric fields
- admin tab reduction (CSV Imports + Users only)
- CSV import upload with Creator List v3 header plus stored row-failure review
- database HubSpot sync trigger path (mockable without provider secrets)

## Local stack verification

- `pnpm infra:up`
- confirm bootstrap completes without manual intervention
- confirm seeded admin login works at `http://localhost:3000/login`
- confirm web and worker boot cleanly from Docker logs
- `pnpm infra:down`

Notes for local verification:

- A clean Docker boot was verified for `postgres`, `web`, and `worker`.
- Use the local URL above for Docker validation. Do not use the hosted app for this step.
- When the local database still contains test-created queued jobs with fake provider credentials, worker logs can show expected YouTube-provider failures after startup. Treat that as test-data noise, not a worker boot failure.
- Local Docker verification does not replace the real staging rehearsal below.

## Staging rehearsal

Run the staging checklist in [`/docs/setup/staging-railway.md`](./staging-railway.md) end-to-end.

Minimum staging flow:

- login
- create run
- overlap one additional queued action during the rehearsal, preferably a channel enrichment while the run is still progressing
- open dashboard and confirm run-level Export opens the handoff workspace
- open catalog and apply Country/Region plus median-view filters
- run admin CSV import and inspect row failures
- confirm admin exposes only CSV Imports and Users tabs
- open database and verify HubSpot sync surface is available to admins

Any failure found here is a bug to fix before launch, not a reason to start new feature work.

## Worker and queue readiness

- every active queue family uses bounded worker concurrency
- every active queue family uses an atomic claim or equivalent idempotent transition before `RUNNING`
- repeated jobs do not duplicate external-provider side effects on normal retry paths
- visible `lastError` and status are preserved for failed jobs

Current intended worker caps:

- `runs.discover`: `teamSize=1`, `teamConcurrency=1`, `batchSize=1`
- `channels.enrich.llm`: `teamSize=1`, `teamConcurrency=2`, `batchSize=1`
- `channels.enrich.hypeauditor`: `teamSize=1`, `teamConcurrency=1`, `batchSize=1` (legacy dormant; advanced-report API/UI is retired)
- `imports.csv.process`: `teamSize=1`, `teamConcurrency=1`, `batchSize=1`
- `exports.csv.generate`: `teamSize=1`, `teamConcurrency=1`, `batchSize=1`
- `hubspot.push.batch`: `teamSize=1`, `teamConcurrency=1`, `batchSize=1`
- `hubspot.import.batch`: `teamSize=1`, `teamConcurrency=1`, `batchSize=1`

## Operations and rollback

- the deployment runbook matches the environment being promoted:
  - Railway staging rehearsals use [`/docs/setup/staging-railway.md`](./staging-railway.md)
  - Dokku production deploys use [`/docs/setup/dokku.md`](./dokku.md)
- rollback steps are current and tested to the safe migration boundary
- Postgres backup/restore drill has been completed once using [`/docs/setup/postgres-backup-restore-drill.md`](./postgres-backup-restore-drill.md)
- the last successful drill date is recorded by the operator outside the repo

## Exit criteria

Launch-ready means:

- CI is green
- smoke coverage is green
- staging rehearsal is green
- backup/restore drill completed
- no known blocker bugs remain in auth, runs, enrichment, import/export, or HubSpot flows

Operator sign-off record after the staging rehearsal:

- staging environment/date:
- actors:
- overlapping queue actions exercised:
- blocker bugs found:
- sign-off status:
