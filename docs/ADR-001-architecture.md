# ADR-001: Monorepo Shape and Service Boundaries

- Status: Accepted
- Date: 2026-03-04

## Context

`scouting-platform` is an internal company tool for campaign managers to discover, review, enrich, export, and push YouTube creators into outbound workflows. The system needs:

- authenticated internal access for admins and managers
- a canonical creator catalog backed by Postgres
- background jobs for discovery, enrichment, imports, exports, and HubSpot pushes
- durable integration with YouTube Data API, OpenAI, HypeAuditor, and HubSpot
- a stable architecture that avoids the pivots and instability seen in the previous codebase

The previous project mixed catalog logic, run logic, worker logic, and runtime schema management too loosely. That produced avoidable deployment risk, unclear data ownership, and hard-to-reason-about request flows.

## Decision

We will use a monorepo with a clear split between web, worker, and shared packages.

### Repository shape

- `apps/web`: Next.js App Router application
- `apps/worker`: background job runner
- `packages/db`: Prisma schema, migrations, and DB access helpers
- `packages/core`: domain services and application logic
- `packages/integrations`: provider clients for YouTube, OpenAI, HypeAuditor, and HubSpot
- `packages/contracts`: shared schemas and types
- `packages/config`: runtime config validation

### Runtime architecture

- The web app is the browser entrypoint and the application boundary for authenticated users.
- The worker runs separately from the web app and processes queued background jobs.
- Postgres is the only production database from day one.
- Prisma is the ORM and migrations are the only schema change mechanism.
- `pg-boss` is the job queue.
- Browser clients never call external providers directly.
- Browser clients never own company secrets.

### Deployment model

- Railway is the default hosting platform for staging and production.
- Production consists of:
  - one `web` service
  - one `worker` service
  - one Postgres database
- CI is required before merge and before deployment.

## Consequences

### Positive

- Service boundaries are clear from the start.
- Background work is isolated from user-facing request handling.
- Secrets remain server-side.
- Data changes are migration-driven and deterministic.
- The architecture is appropriate for a small internal product team and should scale comfortably for the expected v1 usage.

### Tradeoffs

- The worker is a required part of the platform, not an optional extra.
- The monorepo introduces shared package discipline that both contributors must follow.
- We are choosing speed and clarity over a more decoupled multi-service system.

## Rejected alternatives

### Separate public API service from day one

Rejected because the product is internal-only, the team is small, and the extra service boundary would add operational cost without enough benefit in v1.

### SQLite in production

Rejected because the new system needs durable jobs, concurrent access, safe migrations, and predictable deployment behavior.

### Runtime-managed queue tables and scheduler loops in the web process

Rejected because it couples job execution to web uptime and recreates problems from the previous codebase.

### Browser-to-provider calls

Rejected because provider secrets, quota control, auditability, and stable auth all require server ownership of integrations.
