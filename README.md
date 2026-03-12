# scouting-platform

Internal creator scouting platform for campaign managers.

This repository is the clean rewrite of the current creator scouting tool. It starts from an
explicit architecture, a fixed scope, and a controlled delivery plan so the team does not have to
make major pivots after implementation begins.

## Product Summary

The app lets campaign managers:
- browse a shared catalog of discovered YouTube creators
- inspect creator detail pages with contacts, metrics, enrichment, and audit history
- create new scouting runs using their own YouTube Data API key
- reuse creators already stored in the catalog during new runs
- request LLM enrichment and HypeAuditor advanced reports
- export creators to CSV
- push selected creators to HubSpot

Admins can additionally:
- create and manage user accounts
- assign user YouTube API keys
- import contacts and metrics via CSV
- manually edit channel/contact fields
- approve or reject HypeAuditor requests
- manage system settings and monitor background jobs

## Locked v1 Principles

- Internal-only tool
- Postgres from day one
- Catalog is the canonical data model
- Runs are snapshots on top of the catalog, not a second source of truth
- Worker is a separate process from the web app
- Browser never calls external providers directly
- Manual admin edits override automated data
- No runtime schema creation or alteration
- Full CI is required before feature delivery

## Recommended Stack

- Monorepo: `pnpm` workspaces + `turbo`
- Web: `Next.js` App Router
- Worker: Node.js process in `apps/worker`
- DB: Postgres
- ORM: Prisma
- Queue: pg-boss
- Auth: Auth.js credentials provider + argon2
- Validation: zod
- Logging: pino
- Testing: Vitest + Playwright
- Hosting: Railway

## Repo Layout

```text
apps/
  web/
  worker/
packages/
  db/
  core/
  integrations/
  contracts/
  config/
docs/
  ADR-001-architecture.md
  ADR-002-data-ownership-and-precedence.md
  README.md
  setup/
.github/
```

## Primary Docs

- `/README.md`: project overview and onboarding
- `/PROJECTS_SPECS.md`: locked product scope and behavior
- `/ARCHITECTURE.md`: target system design and technical rules
- `/TASKS.md`: milestone plan and GitHub issue backlog
- `/AGENTS.md`: contributor and AI-agent rules for working in this repo
- `/docs/setup/local.md`: local environment bootstrap (Docker + tooling)
- `/docs/setup/staging-railway.md`: staging deployment runbook (Railway)

## Delivery Strategy

The team should build in this order:
1. foundation and CI
2. auth and identity
3. catalog and manual overrides
4. runs and YouTube discovery
5. worker and background jobs
6. LLM enrichment
7. HypeAuditor approval workflow
8. CSV import/export and HubSpot push
9. stabilization and launch hardening

Do not add new product branches until the items in `/TASKS.md` for the active milestone are done.

## Local Setup

Use the local runbook at [`/docs/setup/local.md`](./docs/setup/local.md).

## Local Development Setup

Fastest container-only path:

```bash
cp .env.example .env
docker compose up --build
```

That is enough to boot Postgres, install dependencies in Docker volumes, run migrations, seed the
initial admin, and start both the web app and worker. Host-side `nvm`/`pnpm` setup is only needed
if you want to run workspace commands directly on your machine outside Docker.

Required for the container-only path:
- git
- Docker

Optional for host-side workspace commands:
- nvm
- pnpm

If you also want the host-side shorthand for the same full-stack Docker flow, use:

```bash
nvm install
nvm use

corepack enable
corepack prepare pnpm@10.6.1 --activate

cp .env.example .env

pnpm infra:up
```

`pnpm infra:up` is just the scripted shorthand for bringing up the same Docker Compose stack.
Sign in with the seeded initial admin from `.env` or `.env.example`:

```text
email: admin@example.com
password: StrongAdminPassword123
```

Weekly Postgres image maintenance (advisory):

```bash
pnpm infra:refresh-postgres
pnpm security:scan:postgres
```

Troubleshooting:
- If you hit macOS permission errors from system Node installs under `/usr/local`, use `nvm install` and `nvm use` to keep Node and global tooling in your user-owned environment.

## Staging Setup

Use the staging runbook at [`/docs/setup/staging-railway.md`](./docs/setup/staging-railway.md).

## API Quick Reference

Backend endpoints available for Marin UI integration:

- `POST /api/auth/[...nextauth]` credentials callback via Auth.js
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/:id/password`
- `PUT /api/admin/users/:id/youtube-key`
- `GET /api/admin/dashboard`
- `GET /api/channels`
- `GET /api/channels/:id`
- `POST /api/channels/:id/enrich`
- `POST /api/channels/:id/advanced-report-requests`
- `GET /api/admin/advanced-report-requests`
- `GET /api/admin/advanced-report-requests/:id`
- `POST /api/admin/advanced-report-requests/:id/approve`
- `POST /api/admin/advanced-report-requests/:id/reject`
- `POST /api/admin/csv-import-batches`
- `GET /api/admin/csv-import-batches`
- `GET /api/admin/csv-import-batches/:id`
- `POST /api/csv-export-batches`
- `GET /api/csv-export-batches`
- `GET /api/csv-export-batches/:id`
- `GET /api/csv-export-batches/:id/download`
- `GET /api/runs`
- `POST /api/runs`
- `GET /api/runs/:id`

## Hosting Recommendation

Use Railway with:
- one `web` service
- one `worker` service
- one Postgres database
- separate staging and production environments

This is the simplest stable deployment model for an internal product with ~20 users and background
jobs.
