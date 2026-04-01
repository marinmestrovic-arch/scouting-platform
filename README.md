# scouting-platform

Internal creator scouting platform organized around active campaigns, run snapshots, and auditable outbound workflows.

## Quick Start for AI Agents

```text
1. Read /CODEX_QUICKREF.md
2. Read /TASKS.md
3. Copy from /docs/patterns/
```

## Current Product Summary

The authenticated workspace is centered on five top-level surfaces:
- `Dashboard`
- `New scouting`
- `Catalog`
- `Database`
- `Admin`

Supporting workflow pages handle:
- run detail review
- CSV preparation and export batch history
- HubSpot preparation, import-ready CSV history, and legacy push history

Current user-facing capabilities include:
- campaign-linked scouting runs
- creator catalog browse/detail and saved segments
- LLM enrichment and approval-gated HypeAuditor requests
- client/campaign/dropdown reference data management
- CSV export
- HubSpot push
- HubSpot import batch preparation from run snapshots

## Auth Model

The app uses two user concepts and they are intentionally separate:

- `role`: permission boundary used by sessions, navigation, and protected routes. Values: `admin`, `user`.
- `userType`: business-facing persona stored on users. Values: `admin`, `campaign_manager`, `campaign_lead`, `hoc`.

Current behavior:
- `campaign_manager` users are the only valid campaign-manager assignments for runs
- `campaign_lead` and `hoc` users can create campaign/client reference data
- `admin` powers remain role-gated

## Core Product Rules

- Catalog data is canonical
- Runs are snapshots, not a second canonical creator model
- New scouting starts from an active campaign
- Campaign-derived metadata is stored on each run snapshot
- Browser clients never call providers directly
- Manual admin edits outrank automated data
- Prisma migrations are the only schema change mechanism
- Worker jobs persist status, timestamps, and `lastError`

## Repo Layout

```text
frontend/
  web/
backend/
  worker/
  packages/
    core/
    db/
    integrations/
shared/
  packages/
    contracts/
    config/
docs/
  AGENTS.md
  ADR-001-architecture.md
  ADR-002-data-ownership-and-precedence.md
  ADR-003-repository-layout-simplification.md
  EVALUATION.md
  README.md
  patterns/
  plans/
  setup/
CODEX_QUICKREF.md
```

## Primary Docs

| Document | Purpose |
|----------|---------|
| [`/CODEX_QUICKREF.md`](./CODEX_QUICKREF.md) | Condensed contributor rules |
| [`/README.md`](./README.md) | Project overview and onboarding |
| [`/PROJECTS_SPECS.md`](./PROJECTS_SPECS.md) | Current product behavior |
| [`/ARCHITECTURE.md`](./ARCHITECTURE.md) | Current technical architecture |
| [`/docs/EVALUATION.md`](./docs/EVALUATION.md) | Evidence-based repo evaluation |
| [`/docs/ADR-003-repository-layout-simplification.md`](./docs/ADR-003-repository-layout-simplification.md) | Accepted current repo layout ADR |
| [`/docs/ADR-001-architecture.md`](./docs/ADR-001-architecture.md) | Historical original repo-shape/service-boundary ADR |
| [`/docs/README.md`](./docs/README.md) | Documentation map and ADR guidance |
| [`/docs/setup/local.md`](./docs/setup/local.md) | Local environment bootstrap |
| [`/docs/setup/staging-railway.md`](./docs/setup/staging-railway.md) | Staging deployment runbook |

## Local Setup

Use the local runbook at [`/docs/setup/local.md`](./docs/setup/local.md).

### Fastest Path

```bash
cp .env.example .env
docker compose up --build
```

That boots Postgres, installs dependencies, runs migrations, seeds the initial admin, and starts both the web app and worker.

### Host-Side Tools

```bash
nvm install
nvm use

corepack enable
corepack prepare pnpm@10.6.1 --activate

cp .env.example .env

pnpm infra:up
```

Sign in at `http://localhost:3000/login`:

```text
email: admin@example.com
password: StrongAdminPassword123
```

## Staging Setup

Use the staging runbook at [`/docs/setup/staging-railway.md`](./docs/setup/staging-railway.md).

## API Quick Reference

Current UI-facing route families:

### Auth
- `POST /api/auth/[...nextauth]`

### Catalog and segments
- `GET /api/channels`
- `GET /api/channels/:id`
- `POST /api/channels/:id/enrich`
- `POST /api/channels/:id/advanced-report-requests`
- `GET /api/segments`
- `POST /api/segments`
- `PUT /api/segments/:id`
- `DELETE /api/segments/:id`

### Campaign and reference data
- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/clients`
- `POST /api/clients`
- `GET /api/users/campaign-managers`
- `GET /api/admin/dropdown-values`
- `PUT /api/admin/dropdown-values`

### Runs and previews
- `GET /api/runs`
- `POST /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/csv-preview`
- `GET /api/runs/:id/hubspot-preview`
- `PATCH /api/runs/:id/hubspot-preview`

### Admin
- `GET /api/admin/dashboard`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `PUT /api/admin/users/:id/password`
- `PUT /api/admin/users/:id/youtube-key`
- `GET /api/admin/advanced-report-requests`
- `GET /api/admin/advanced-report-requests/:id`
- `POST /api/admin/advanced-report-requests/:id/approve`
- `POST /api/admin/advanced-report-requests/:id/reject`
- `PATCH /api/admin/channels/:id/manual-overrides`
- `GET /api/admin/csv-import-batches`
- `POST /api/admin/csv-import-batches`
- `GET /api/admin/csv-import-batches/:id`

### Batch history, detail, and downloads
- `GET /api/csv-export-batches`
- `POST /api/csv-export-batches`
- `GET /api/csv-export-batches/:id`
- `GET /api/csv-export-batches/:id/download`
- `GET /api/hubspot-push-batches`
- `POST /api/hubspot-push-batches`
- `GET /api/hubspot-push-batches/:id`
- `GET /api/hubspot-import-batches`
- `POST /api/hubspot-import-batches`
- `GET /api/hubspot-import-batches/:id`
- `GET /api/hubspot-import-batches/:id/download`

## Hosting Recommendation

Use Railway with:
- one `web` service
- one `worker` service
- one Postgres database
- separate staging and production environments
