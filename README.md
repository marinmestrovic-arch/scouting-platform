# scouting-platform

Internal creator scouting platform organized around active campaigns, run snapshots, and auditable outbound workflows.

## Quick Start for AI Agents

```text
1. Read /AGENTS.md
2. Read /docs/CODEX_QUICKREF.md
3. Read /docs/TASKS.md
4. Copy from /docs/patterns/
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
- Google Sheets handoff plus direct HubSpot sync and CSV fallback history

Current user-facing capabilities include:
- campaign-linked scouting runs
- creator catalog browse/detail and saved segments
- LLM enrichment
- client/campaign/dropdown reference data management
- CSV export
- resumable HubSpot contact/deal sync from prepared run snapshots
- HubSpot reference reconciliation, connection health, conflicts, and CSV fallback

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
  ARCHITECTURE.md
  CODEX_QUICKREF.md
  PROJECT_SPEC.md
  TASKS.md
  README.md
  EVALUATION.md
  ADR-001-architecture.md
  ADR-002-data-ownership-and-precedence.md
  ADR-003-repository-layout-simplification.md
  ADR-004-account-security-hardening.md
  ADR-005-hubspot-integration-boundaries.md
  patterns/
  plans/
  setup/
hubspot-app/
AGENTS.md
README.md
```

## Primary Docs

| Document | Purpose |
|----------|---------|
| [`/README.md`](./README.md) | Project overview and onboarding |
| [`/AGENTS.md`](./AGENTS.md) | Agent and contributor policy |
| [`/docs/CODEX_QUICKREF.md`](./docs/CODEX_QUICKREF.md) | Condensed contributor rules |
| [`/docs/PROJECT_SPEC.md`](./docs/PROJECT_SPEC.md) | Current product behavior |
| [`/docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Current technical architecture |
| [`/docs/TASKS.md`](./docs/TASKS.md) | Milestone plan and historical work split |
| [`/docs/EVALUATION.md`](./docs/EVALUATION.md) | Evidence-based repo evaluation |
| [`/docs/ADR-005-hubspot-integration-boundaries.md`](./docs/ADR-005-hubspot-integration-boundaries.md) | HubSpot V2 ownership, identity, queue, and portal boundaries |
| [`/docs/ADR-003-repository-layout-simplification.md`](./docs/ADR-003-repository-layout-simplification.md) | Accepted current repo layout ADR |
| [`/docs/ADR-001-architecture.md`](./docs/ADR-001-architecture.md) | Historical original repo-shape/service-boundary ADR |
| [`/docs/README.md`](./docs/README.md) | Documentation map and ADR guidance |
| [`/docs/setup/local.md`](./docs/setup/local.md) | Local environment bootstrap |
| [`/docs/setup/hubspot-v2.md`](./docs/setup/hubspot-v2.md) | HubSpot portal provisioning, rollout, webhooks, and UI extension |
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
- `GET|POST /api/database/hubspot-health`
- `GET /api/database/hubspot-conflicts`
- `GET|POST /api/database/hubspot-sync`

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
- `PATCH /api/admin/channels/:id/manual-overrides`
- `GET /api/admin/csv-import-batches`
- `POST /api/admin/csv-import-batches`
- `GET /api/admin/csv-import-batches/:id`

### Retired advanced-report endpoints (return HTTP 410)
- `POST /api/channels/:id/advanced-report-requests`
- `GET /api/admin/advanced-report-requests`
- `GET /api/admin/advanced-report-requests/:id`
- `POST /api/admin/advanced-report-requests/:id/approve`
- `POST /api/admin/advanced-report-requests/:id/reject`

### Batch history, detail, and downloads
- `GET /api/csv-export-batches`
- `POST /api/csv-export-batches`
- `GET /api/csv-export-batches/:id`
- `GET /api/csv-export-batches/:id/download`
- `GET /api/hubspot-import-batches`
- `POST /api/hubspot-import-batches`
- `GET /api/hubspot-import-batches/:id`
- `POST /api/hubspot-import-batches/:id/retry`
- `GET /api/hubspot-import-batches/:id/download`

The HubSpot import-batch family supports direct CRM Object API delivery and an explicit downloadable
CSV fallback. Legacy `hubspot-push-batches` history/endpoints remain for compatibility but are not
an active product action.

### HubSpot provider-authenticated endpoints

- `POST /api/integrations/hubspot/webhooks`
- `GET /api/integrations/hubspot/extension/context`

These two endpoints authenticate HubSpot v3 signatures rather than Auth.js sessions. See the
[HubSpot V2 operator guide](./docs/setup/hubspot-v2.md) before enabling either endpoint. All HubSpot
feature flags default off, and the repository does not claim live portal verification.

## Hosting Recommendation

Use Railway with:
- one `web` service
- one `worker` service
- one Postgres database
- separate staging and production environments
