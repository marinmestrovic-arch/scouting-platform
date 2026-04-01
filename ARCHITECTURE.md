# Architecture

Current-state architecture for `scouting-platform` as of 2026-04-01.

Historical note:
- [docs/ADR-001-architecture.md](./docs/ADR-001-architecture.md) preserves the original monorepo/service-boundary decision.
- [docs/ADR-003-repository-layout-simplification.md](./docs/ADR-003-repository-layout-simplification.md) is the accepted ADR that governs the current repository layout.

## 1. System Shape

The production system has three runtime components:
- `web`: Next.js application for authenticated UI, Auth.js, server-rendered pages, and route handlers
- `worker`: separate Node.js process for `pg-boss` jobs and provider orchestration
- `db`: Postgres as the only persistent database

Recommended hosting remains Railway with separate staging and production environments.

## 2. ADR-Governed Constraints

The following rules remain architectural constraints, not implementation preferences:

1. Catalog data is canonical.
2. Runs are snapshots layered on top of the catalog, not a second canonical creator model.
3. The worker remains separate from the web process.
4. Postgres is mandatory.
5. Prisma migrations are the only schema change mechanism.
6. `pg-boss` is the queue.
7. The browser never talks directly to YouTube, OpenAI, HypeAuditor, or HubSpot.
8. Manual admin overrides outrank all automated data.
9. Every async workflow persists status, timestamps, and `lastError`.
10. Every privileged action emits an audit event.

Any change to these rules requires an ADR in [`/docs`](./docs/README.md).

## 3. Repository Layout

The active repository layout is:

```text
frontend/
  web/
    app/
    components/
    lib/
    e2e/
backend/
  worker/
    src/
  packages/
    core/
      src/
    db/
      prisma/
      src/
    integrations/
      src/
shared/
  packages/
    contracts/
      src/
    config/
      src/
docs/
scripts/
docker/
```

There are no active top-level `apps/` or `packages/` workspaces in the current repo state.

## 4. Directory Responsibilities

### `frontend/web`
- authenticated workspace UI
- top-level navigation and shell
- server-rendered pages
- route handlers / BFF boundary
- session-aware access checks
- page/component tests and Playwright coverage

### `backend/worker`
- `pg-boss` bootstrap
- worker registration
- long-running discovery, enrichment, import, export, and HubSpot preparation jobs
- retry and durability handling for queued workflows

### `backend/packages/core`
- domain services
- business rules
- run creation and discovery orchestration
- campaign, client, dropdown, export, and HubSpot preparation services
- audit logging and approval workflows

### `backend/packages/db`
- Prisma schema
- migrations
- Prisma client setup
- DB access helpers and transaction helpers

### `backend/packages/integrations`
- YouTube discovery/context adapter
- OpenAI enrichment adapter
- HypeAuditor adapter
- HubSpot adapter

### `shared/packages/contracts`
- Zod request/response contracts
- queue payload schemas
- DTOs shared between UI, routes, worker, and core services

### `shared/packages/config`
- env validation
- feature flags
- shared runtime constants

## 5. Auth and User Model

Authentication is email/password through Auth.js credentials.

The user model has two layers and they serve different purposes:

### `role` is the permission boundary

Values:
- `admin`
- `user`

`role` is what the session, top-level navigation, and admin-only route guards use.

### `userType` is the business-facing persona

Values:
- `admin`
- `campaign_manager`
- `campaign_lead`
- `hoc`

`userType` does not replace `role`. It describes business responsibility inside the non-admin workspace:
- `campaign_manager` users are the only users eligible for run-level campaign manager assignment
- `campaign_lead` and `hoc` users can create campaign/client reference data
- `admin` user type is reserved for `role=admin` accounts

The important rule for contributors is:
- use `role` for permission boundaries
- use `userType` for business semantics and workflow-specific rules

## 6. Current Workspace Surfaces

The top-level authenticated navigation exposes five primary surfaces:
- `Dashboard`
- `New scouting`
- `Catalog`
- `Database`
- `Admin`

Supporting workflow pages still exist outside the top-level nav:
- `Exports` for CSV batch history and results
- `HubSpot` for import-ready batch history plus legacy push history
- run detail pages at `/runs/[runId]`
- preparation pages at `/exports/prepare/[runId]` and `/hubspot/prepare/[runId]`

Legacy compatibility routes remain in place:
- `/runs` redirects to `/dashboard`
- `/campaigns` redirects to `/database?tab=campaigns`
- `/runs/new` opens the new scouting workspace with a legacy notice

## 7. Campaign-Linked Scouting Model

Runs are now campaign-linked.

Run creation requires:
- an authenticated user with an assigned YouTube Data API key
- an active campaign
- a target count
- a scouting prompt/query
- a campaign manager selection from active `role=user` + `userType=campaign_manager` users

At run creation time, the system copies campaign-derived metadata onto `run_requests` so the run remains a durable snapshot:
- campaign context: `campaignId`, `campaignName`, `client`, `market`, `briefLink`, `month`, `year`
- ownership/outbound context: `campaignManagerUserId`, `dealOwner`, `dealName`, `pipeline`, `dealStage`
- HubSpot preparation defaults: `currency`, `dealType`, `activationType`, `hubspotInfluencerType`, `hubspotInfluencerVertical`, `hubspotCountryRegion`, `hubspotLanguage`

The current creation flow is:
1. Validate session and assigned YouTube key.
2. Validate that the selected campaign exists and is active.
3. Validate that the selected campaign manager is an active Campaign Manager user.
4. Create a `run_requests` snapshot row with campaign-derived metadata.
5. Queue `runs.discover`.
6. Worker searches both the existing catalog and YouTube discovery.
7. Worker upserts new channels and stores `run_results`.
8. Dashboard and run detail pages use the stored snapshot plus results.

## 8. Current Data Model Direction

### Identity and auth
- `users`
- `sessions`
- `accounts`
- `user_provider_credentials`

### Catalog and enrichment
- `channels`
- `channel_contacts`
- `channel_metrics`
- `channel_enrichments`
- `channel_manual_overrides`
- `channel_source_snapshots`
- `channel_provider_payloads`

### Reference data
- `clients`
- `markets`
- `campaigns`
- `dropdown_values`

### Runs and outbound workflows
- `run_requests`
- `run_results`
- `run_hubspot_row_overrides`
- `csv_import_batches`
- `csv_import_rows`
- `csv_export_batches`
- `hubspot_push_batches`
- `hubspot_push_batch_rows`
- `hubspot_import_batches`
- `hubspot_import_batch_rows`

### Admin and operational
- `advanced_report_requests`
- `audit_events`
- `saved_segments`
- `pgboss.*` queue tables

## 9. Data Precedence

Resolved catalog/profile data follows the accepted precedence order:

1. `admin_manual`
2. `csv_import`
3. `hypeauditor`
4. `llm`
5. `heuristics`
6. `youtube_raw`

The system stores both raw/source payloads and resolved creator data used by the UI.

## 10. API Boundary

The web app exposes the current BFF surface through route families in `frontend/web/app/api`:

### Auth
- `/api/auth/[...nextauth]`

### Catalog and saved segments
- `/api/channels`
- `/api/channels/[id]`
- `/api/channels/[id]/enrich`
- `/api/channels/[id]/advanced-report-requests`
- `/api/segments`
- `/api/segments/[id]`

### Campaign/reference data and scouting metadata
- `/api/campaigns`
- `/api/clients`
- `/api/users/campaign-managers`
- `/api/admin/dropdown-values`

### Runs and preparation previews
- `/api/runs`
- `/api/runs/[id]`
- `/api/runs/[id]/csv-preview`
- `/api/runs/[id]/hubspot-preview`

### Admin workflows
- `/api/admin/dashboard`
- `/api/admin/users`
- `/api/admin/users/[id]`
- `/api/admin/users/[id]/password`
- `/api/admin/users/[id]/youtube-key`
- `/api/admin/advanced-report-requests`
- `/api/admin/advanced-report-requests/[id]`
- `/api/admin/advanced-report-requests/[id]/approve`
- `/api/admin/advanced-report-requests/[id]/reject`
- `/api/admin/channels/[id]/manual-overrides`
- `/api/admin/csv-import-batches`
- `/api/admin/csv-import-batches/[id]`

### Batch result and download flows
- `/api/csv-export-batches`
- `/api/csv-export-batches/[id]`
- `/api/csv-export-batches/[id]/download`
- `/api/hubspot-push-batches`
- `/api/hubspot-push-batches/[id]`
- `/api/hubspot-import-batches`
- `/api/hubspot-import-batches/[id]`
- `/api/hubspot-import-batches/[id]/download`

## 11. Background Jobs

Current job names are:
- `runs.discover`
- `runs.recompute`
- `channels.enrich.llm`
- `channels.enrich.hypeauditor`
- `imports.csv.process`
- `exports.csv.generate`
- `hubspot.import.batch`
- `hubspot.push.batch`
- `maintenance.refresh-stale`

Every job family uses stable payload contracts in [`shared/packages/contracts/src/jobs.ts`](./shared/packages/contracts/src/jobs.ts), and every persisted workflow stores status/timestamps/`lastError`.

## 12. Security Rules

- Encrypt user YouTube keys at rest with `APP_ENCRYPTION_KEY`.
- Never expose company secrets to the browser.
- Enforce authorization server-side for every protected mutation.
- Keep audit events immutable.
- Keep provider calls in backend packages and workers only.

## 13. Testing Strategy

### Unit
- domain rules
- merge precedence
- adapter behavior
- utility contracts and helpers

### Integration
- Prisma repositories and transactions
- route handlers
- auth rules
- queued job execution
- migration safety

### End-to-end
- login
- catalog browse/detail
- new scouting flow
- dashboard/run review
- admin approvals/imports
- export and HubSpot preparation flows
