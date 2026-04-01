# Scouting Platform - Codebase Evaluation

**Evaluated:** 2026-04-01

Measurement note:
- `frontend/`, `backend/`, and `shared/` contain 342 `*.ts`/`*.tsx` files and 60,348 TypeScript lines as of the audit date.
- The repo currently contains 123 test files, 21 markdown files, 30 Prisma models, 35 API route handlers, and 7 workspace packages.
- Treat these as point-in-time counts, not timeless claims.

## What The Repo Currently Implements

The codebase is past its initial scaffold phase. It currently implements:
- the accepted `frontend/` + `backend/` + `shared/` repo layout
- a role-based auth boundary plus a separate `userType` persona model
- campaign-linked scouting runs with stored campaign/outbound metadata
- the five primary workspace surfaces: Dashboard, New scouting, Catalog, Database, and Admin
- CSV export, HubSpot push, and HubSpot import-ready batch preparation

## Architecture Snapshot

Runtime components:
- `frontend/web`: Next.js UI and BFF route handlers
- `backend/worker`: `pg-boss` workers
- `Postgres`: only durable data store

Current workspace packages:
- `frontend/web`
- `backend/worker`
- `backend/packages/core`
- `backend/packages/db`
- `backend/packages/integrations`
- `shared/packages/contracts`
- `shared/packages/config`

Key technical anchors:
- [`backend/packages/db/prisma/schema.prisma`](../backend/packages/db/prisma/schema.prisma) defines the current user, campaign, run, batch, and reference-data model.
- [`frontend/web/lib/navigation.ts`](../frontend/web/lib/navigation.ts) defines the primary authenticated navigation surfaces.
- [`backend/packages/core/src/runs/repository.ts`](../backend/packages/core/src/runs/repository.ts) enforces campaign-linked run creation and campaign-manager validation.
- [`backend/packages/core/src/campaigns.ts`](../backend/packages/core/src/campaigns.ts) implements campaign/client reference-data behavior and `userType`-based creation rules.
- [`backend/packages/core/src/export-previews.ts`](../backend/packages/core/src/export-previews.ts) drives CSV and HubSpot preparation from stored run snapshots.
- [`backend/packages/core/src/hubspot/import-batches.ts`](../backend/packages/core/src/hubspot/import-batches.ts) implements import-ready CSV generation, blockers, row preparation, and downloads.

## Verified Strengths

- The current repo layout is coherent and fully reflected in workspace config, package locations, and imports.
- The auth model is explicit: `role` is the permission boundary, while `userType` is preserved end-to-end for business semantics.
- Run creation stores campaign context and outbound defaults on `run_requests`, which gives Dashboard, CSV preparation, and HubSpot preparation a shared snapshot to operate on.
- Outbound workflows are durable and auditable. CSV exports, HubSpot pushes, and HubSpot import batches all persist status, timestamps, and `lastError`.
- The route surface is substantial but organized: catalog, runs, campaigns, clients, dropdown values, admin workflows, previews, downloads, and batch history all have typed contracts.
- Test coverage is broad for the current repo size, with 123 test files spread across frontend, backend, and shared packages.

## Verified Constraints And Follow-Up Debt

- Session/navigation behavior is still role-driven only. `userType` matters for business workflows, but contributors have to read route guards and service rules together to understand the full auth model.
- The HubSpot workspace intentionally mixes the current import-ready batch flow with legacy push history, which keeps old behavior accessible but leaves two outbound mental models in the same surface.
- Campaign lifecycle tooling is only partially surfaced today. Campaigns have `isActive` in the schema and filtering in the UI/API, but the current API/UI surface exposes list/create rather than edit/deactivate management.

## Current Data And Queue Shape

Important implemented tables/models include:
- identity: `users`, `sessions`, `accounts`, `user_provider_credentials`
- reference data: `clients`, `markets`, `campaigns`, `dropdown_values`
- runs/outbound: `run_requests`, `run_results`, `run_hubspot_row_overrides`, `csv_export_batches`, `hubspot_push_batches`, `hubspot_import_batches`
- admin/ops: `advanced_report_requests`, `csv_import_batches`, `audit_events`

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

## Conclusion

As of 2026-04-01, the repo is past the migration narrative. The living docs should describe it as a campaign-linked scouting platform with a stable responsibility-based layout, a dual-layer auth/persona model, and implemented outbound workflows that extend beyond simple CSV export.
