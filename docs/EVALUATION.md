# Scouting Platform — Codebase Evaluation

**Evaluated:** 2026-04-01
**Codebase:** ~63K lines TypeScript, 353 files, 6 monorepo packages, 40+ DB tables

---

## What It Does

Internal influencer scouting tool for campaign managers. Workflows: YouTube creator discovery, LLM + HypeAuditor enrichment, CSV import/export, HubSpot sync, admin approval gating for premium reports.

---

## Architecture

3 runtime services:
- **web** — Next.js 15 (App Router), Auth.js, route handlers (BFF)
- **worker** — pg-boss job processor, separate Node.js process
- **postgres** — Single data store, Prisma migrations only

Monorepo layout:
```
frontend/web/
backend/worker/
backend/packages/core/          domain services, merge logic, business rules
backend/packages/db/            Prisma schema + migrations
backend/packages/integrations/  YouTube, OpenAI, HypeAuditor, HubSpot adapters
shared/packages/contracts/      Zod DTOs, route/queue contracts
shared/packages/config/         env validation, feature flags
```

**Data precedence (hard-coded as `SOURCE_PRECEDENCE` constant):**
```
admin_manual > csv_import > hypeauditor > llm > heuristics > youtube_raw
```

**Locked ADR constraints:** Catalog is canonical (not runs). Worker separate from web. Browser never calls external providers. Admin overrides never auto-overwritten. Every async job tracks `status` + `lastError`. Every privileged action emits an audit event.

---

## Key Files

### Core Data Model
- `backend/packages/db/prisma/schema.prisma` — 831 lines; full entity graph (User, Channel, ChannelMetrics, ChannelInsights, ChannelAudience, ChannelManualOverride, RunRequest, RunResult, ChannelEnrichment, AdvancedReportRequest, CsvImportBatch, HubspotPushBatch, audit)

### Heaviest Domain Logic
- `backend/packages/core/src/channels/repository.ts` — 31KB; channel queries, manual override handling, precedence-safe field resolution, status resolution

### Worker Entry Point
- `backend/worker/src/index.ts` — pg-boss bootstrap, all job registration, graceful shutdown (SIGINT/SIGTERM, 30s timeout)

### Worker Jobs
- `backend/worker/src/runs-discover-worker.ts` — YouTube discovery
- `backend/worker/src/channels-enrich-llm-worker.ts` — OpenAI enrichment
- `backend/worker/src/channels-enrich-hypeauditor-worker.ts` — HypeAuditor approval gate
- `backend/worker/src/exports-csv-generate-worker.ts` — CSV export
- `backend/worker/src/imports-csv-process-worker.ts` — CSV import
- `backend/worker/src/hubspot-push-batch-worker.ts` — HubSpot sync

### Domain Services (`backend/packages/core/src/`)
- `channels/repository.ts` — channel catalog operations
- `admin.ts` — user management, credential assignment
- `exports/csv-generate.ts` — precedence-aware field selection
- `imports/csv-process.ts` — source tracking on import
- `runs/discover.ts` — YouTube discovery orchestration
- `enrichment/llm.ts` — OpenAI enrichment
- `approvals/hypeauditor.ts` — HypeAuditor approval workflow

### Canonical Implementation Patterns (read before writing new code)
- `docs/patterns/domain-service-pattern.ts` — 477 lines; precedence-safe updates, merge logic, admin overrides, field restore
- `docs/patterns/route-handler-pattern.ts` — auth validation, Zod parsing, audit emission
- `docs/patterns/worker-job-pattern.ts` — job claim, status tracking, retry/error
- `docs/patterns/provider-adapter-pattern.ts` — retry loops, error normalization, timeout
- `docs/patterns/error-handling-pattern.ts` — error shape consistency

### Integration Tests (validate multi-step flows)
- `backend/packages/core/src/week1.integration.test.ts` — auth, users, credentials
- `backend/packages/core/src/week2.integration.test.ts` — catalog, manual overrides
- `backend/packages/core/src/week3.integration.test.ts` — scouting runs, YouTube discovery
- `backend/packages/core/src/week4.integration.test.ts` — LLM + HypeAuditor enrichment
- `backend/packages/core/src/week5.integration.test.ts` — CSV import/export
- `backend/packages/core/src/week6-hubspot-push.integration.test.ts` — HubSpot sync

### AI Agent Reference
- `CODEX_QUICKREF.md` — hard stops, data precedence, file placement rules (read this first)

---

## Weaknesses

### High Priority

1. **No audit query tooling** — Audit events are emitted but no admin UI or query path exists to review them. Audit trail is write-only in practice.
2. **Retry logic scattered** — Retry strategies are defined per worker handler, not centralized in adapter classes. Inconsistent retry behavior across providers.
3. **HubSpot partial sync recovery** — No mechanism to detect or recover from mid-batch sync failures between Scouting and HubSpot.

### Medium Priority

4. **Single worker process, no scaling story** — No horizontal scaling strategy documented. Could bottleneck at high enrichment volume.
5. **CSV import unbounded** — No streaming parser or batch size limits for large file imports. Risk of OOM on large CSVs.
6. **No automatic stale-enrichment recovery** — When enrichments go stale, manual admin trigger required. No background re-queue logic.

### Low Priority

7. **Secret rotation gap** — No credential rotation mechanism documented for YouTube/HypeAuditor API keys.
8. **Timezone handling** — Campaign months are string enums + Int year. No timezone-aware timestamps for campaign scoping.
9. **Prisma enum runtime access risk** — Previously caused a bug (fixed in a recent commit); pattern could recur if the team isn't vigilant.

---

## Strengths

- Precedence enforced in code (`SOURCE_PRECEDENCE` constant + `canOverwrite()`) not just documentation
- Field-level source tracking on every enriched field (`subscriberCount` + `subscriberCountSource`)
- Admin override isolation in a separate table, unpin-able to restore automated values
- 300+ test files; week-based integration milestones validate complete workflows
- 184 markdown docs including ADRs, Codex quick-ref, pattern library
- pg-boss job durability; graceful shutdown; mandatory CI before merge
