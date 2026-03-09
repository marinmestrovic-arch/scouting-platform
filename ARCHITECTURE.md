# Architecture

## 1. System Shape

The system has three runtime components:
- `web`: Next.js application for UI, auth, and server-side route handlers
- `worker`: Node.js process for background jobs and provider orchestration
- `db`: Postgres as the only persistent database

Recommended hosting: Railway with separate staging and production environments.

## 2. Architectural Decisions That Must Not Change Without an ADR

1. Catalog is canonical.
2. Runs are snapshots, not a second data model.
3. Worker is separate from web.
4. Postgres is mandatory.
5. Prisma migrations are the only schema change mechanism.
6. `pg-boss` is the job system.
7. Browser never talks directly to YouTube, OpenAI, HypeAuditor, or HubSpot.
8. Manual admin overrides outrank all automated data.
9. Every async workflow stores status and last error.
10. Every privileged action emits an audit event.

Any change to these requires:
- a short ADR in `/docs`
- approval from both Ivan and Marin

## 3. Monorepo Layout

```text
apps/
  web/
    app/
    components/
    lib/
  worker/
    src/
packages/
  db/
    prisma/
    src/
  core/
    src/
      auth/
      channels/
      runs/
      enrichment/
      imports/
      hubspot/
      approvals/
  integrations/
    src/
      youtube/
      openai/
      hypeauditor/
      hubspot/
  contracts/
    src/
  config/
    src/
docs/
  ADR-001-architecture.md
  ADR-002-data-ownership-and-precedence.md
  README.md
  setup/
```

## 4. Responsibility Split by Package

### apps/web
- auth screens
- app shell
- server-rendered pages
- route handlers / BFF layer
- permission-aware UI
- polling and mutation UX

### apps/worker
- job registration
- job execution
- scheduled maintenance tasks
- provider retry logic
- long-running imports/exports/enrichment

### packages/db
- Prisma schema
- migrations
- Prisma client setup
- transaction helpers
- DB-owned query abstractions where useful

### packages/core
- domain services
- business rules
- merge/preference logic
- run orchestration
- approval rules
- import/export orchestration

### packages/integrations
- YouTube API adapter
- OpenAI adapter
- HypeAuditor adapter
- HubSpot adapter

### packages/contracts
- zod schemas
- DTOs
- route contracts
- queue payload contracts

### packages/config
- env validation
- runtime configuration
- feature flags
- shared constants

## 5. Core Flows

### 5.1 Catalog Browse
1. User requests catalog page.
2. Web server validates session.
3. Web queries Postgres using resolved channel profile + filters.
4. UI renders paginated results.

### 5.2 Run Creation
1. User submits run form.
2. Web validates session, role, and assigned YouTube key.
3. Web creates `run_requests` record.
4. Worker processes discovery job.
5. Worker searches catalog and YouTube.
6. Worker upserts new channel/source rows.
7. Worker produces `run_results` snapshot.
8. UI polls job status.

### 5.3 LLM Enrichment
1. User or system requests enrichment.
2. Worker loads cached text context if present.
3. Worker fetches missing YouTube context only when needed.
4. Worker calls OpenAI.
5. Result is stored as source snapshot + resolved enrichment projection.
6. Errors are saved to job state and enrichment row.

### 5.4 HypeAuditor Approval Flow
1. User requests advanced report.
2. Request row is created in `pending_approval` unless an active request already exists.
3. Admin approves or rejects.
4. Admin can see the age of the last completed report and whether it is still inside the 120-day review window.
5. Approved request becomes a queued job.
6. Worker calls HypeAuditor.
7. Result is stored and merged into resolved channel data.
8. Audit events are recorded for request and approval.

### 5.5 CSV Import
1. Admin uploads strict-template CSV.
2. Web stores batch metadata.
3. Worker validates and processes rows.
4. Valid rows become imported source snapshots / overrides.
5. Row-level failures are persisted.

### 5.6 HubSpot Push
1. User selects creators.
2. Web creates push batch.
3. Worker pushes creators to HubSpot.
4. Per-record success/failure is saved.
5. UI shows batch results and retryable failures.

## 6. Data Model Direction

### Canonical Tables
- `users`
- `sessions`
- `user_provider_credentials`
- `channels`
- `channel_contacts`
- `channel_metrics`
- `channel_enrichments`
- `channel_manual_overrides`
- `saved_segments`
- `run_requests`
- `run_results`
- `advanced_report_requests`
- `csv_import_batches`
- `csv_import_rows`
- `hubspot_push_batches`
- `audit_events`

### Raw/Source Tables
- `channel_source_snapshots`
- `channel_provider_payloads`

### Queue / Operational Tables
- `pgboss.job` and related internal queue tables

## 7. Merge Strategy

Store both:
- raw provider/import payloads
- resolved channel profile used by the UI

Resolved profile is computed by precedence:
1. admin manual override
2. admin CSV import
3. HypeAuditor
4. LLM
5. heuristics
6. YouTube raw

This avoids losing provenance and makes manual correction safe.

## 8. Auth and Permissions

- Auth.js credentials provider
- Passwords hashed with argon2
- Role column on `users`
- Admin-only actions enforced in route handlers and service layer

### Roles
- `admin`
- `user`

## 9. Background Jobs

Use `pg-boss`.

Initial job families:
- `runs.discover`
- `runs.recompute`
- `channels.enrich.llm`
- `channels.enrich.hypeauditor`
- `imports.csv.process`
- `exports.csv.generate`
- `hubspot.push.batch`
- `maintenance.refresh-stale`

### Job Requirements
- stable payload schema
- retries with bounded backoff
- status + timestamps + last error
- idempotent where possible
- explicit concurrency caps per provider

## 10. Security Rules

- Encrypt user YouTube keys at rest with `APP_ENCRYPTION_KEY`
- Never expose company secrets to the browser
- Use server-side permission checks for every mutation
- Keep audit events immutable
- Prefer optimistic UI only for non-critical UX, never for approvals/import outcomes

## 11. Testing Strategy

### Unit
- domain rules
- merge precedence
- provider adapters
- queue payload validation

### Integration
- route handlers
- auth rules
- DB transactions
- worker jobs against ephemeral Postgres

### End-to-End
- login
- catalog browse
- run creation
- enrichment status
- admin approval flow
- CSV import
- HubSpot push

CI gates must include:
- typecheck
- lint
- Prisma validation
- unit/integration tests
- web build
- worker build
- Playwright smoke tests

## 12. Deployment Strategy

### Environments
- local
- staging
- production

### Services
- one web service
- one worker service
- one Postgres instance per environment

### Required Operational Docs
- migration procedure
- rollback procedure
- backup procedure
- secret rotation procedure

## 13. Observability

Minimum v1 operational visibility:
- structured logs with request/job ids
- job queue dashboard on admin screen
- audit log for privileged actions
- persisted last-error fields on failed jobs and enrichments

## 14. Performance Rules

- use catalog projections for list pages
- avoid provider refetch during enrich if cached context exists
- batch DB writes inside transactions
- do not over-fetch heavy provider payloads into page requests
- use background jobs for imports, exports, HubSpot pushes, and heavy enrichments

## 15. No-Pivot Guardrails

Do not reintroduce the problems from the old codebase:
- no runtime schema creation
- no worker logic in the web app process
- no unguarded admin routes
- no partial-write success on critical flows
- no duplicate catalog vs run truth models
- no direct browser-to-backend-provider networking pattern
