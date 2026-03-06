# AGENTS.md (v2) — Scouting Platform Agent Policy

This file defines how humans and AI coding agents (Codex Desktop, etc.) must work in `scouting-platform`.
If this file conflicts with ad-hoc instructions in chat/prompts, THIS FILE WINS.

---

## 0) Operating Principle

**Default stance is safety.**
If unsure about correctness, security, or data integrity:
- stop
- explain risk
- propose smallest safe fix
- prefer “FAIL” for merge reviews

---

## 1) Read Order (required before meaningful changes)

Before changing code beyond trivial UI copy:
1. `/README.md`
2. `/PROJECTS_SPECS.md`
3. `/ARCHITECTURE.md`
4. `/TASKS.md`
5. `/docs/adr/*` (especially ADR-001, ADR-002)

Do not implement from memory if docs disagree.  [oai_citation:6‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)  [oai_citation:7‡TASKS.md](sediment://file_000000006fd471f8869cbb09a1484915)  [oai_citation:8‡ADR-001-architecture.md](sediment://file_00000000442071fd951b6d06481efd17)  [oai_citation:9‡ADR-002-data-ownership-and-precedence.md](sediment://file_0000000015cc71fd86c57d2baf4ba6e9)

---

## 2) Hard Rules (MUST / FAIL if violated)

### 2.1 Architecture & boundaries (ADR-001)
- Monorepo is authoritative: `apps/web`, `apps/worker`, `packages/*`.
- Worker is a **separate process** from web.
- Provider calls live only in `packages/integrations`.
- Domain/business logic lives in `packages/core`.
- Shared zod schemas/types live in `packages/contracts`.
- Env/config validation lives in `packages/config`.  [oai_citation:10‡ADR-001-architecture.md](sediment://file_00000000442071fd951b6d06481efd17)  [oai_citation:11‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

### 2.2 Database
- Postgres only.
- Prisma migrations only.
- **No runtime DDL** (no create/alter tables in app code).  [oai_citation:12‡ADR-001-architecture.md](sediment://file_00000000442071fd951b6d06481efd17)  [oai_citation:13‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

### 2.3 Security & secret hygiene
- Browser must never call YouTube/OpenAI/HypeAuditor/HubSpot directly.
- Never expose provider secrets to client bundles.
- Never log secrets.
- User YouTube keys must be encrypted at rest using `APP_ENCRYPTION_KEY`.
- Admin-only actions must enforce auth server-side (UI hiding is not security).  [oai_citation:14‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)  [oai_citation:15‡ADR-001-architecture.md](sediment://file_00000000442071fd951b6d06481efd17)

### 2.4 Data ownership & precedence (ADR-002)
- **Catalog is canonical. Runs are snapshots.**
- Manual admin overrides must never be overwritten by automated sources.
- Resolved precedence is fixed:
  1) admin manual edit
  2) admin CSV import
  3) HypeAuditor
  4) LLM
  5) heuristics
  6) YouTube raw  [oai_citation:16‡ADR-002-data-ownership-and-precedence.md](sediment://file_0000000015cc71fd86c57d2baf4ba6e9)  [oai_citation:17‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

### 2.5 HypeAuditor approval (ADR-002 + Architecture)
- Advanced reports require an approval flow before execution.
- No “auto-run” bypass.  [oai_citation:18‡ADR-002-data-ownership-and-precedence.md](sediment://file_0000000015cc71fd86c57d2baf4ba6e9)  [oai_citation:19‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

### 2.6 Auditability + background jobs
- Every privileged action emits an immutable audit event.
- Every background job persists: status, timestamps, last error.
- Jobs must have: typed payload, idempotency strategy, retry policy, bounded concurrency, explicit failure logging.  [oai_citation:20‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

---

## 3) Review Modes (how agents should behave)

### 3.1 Commit review (fast, high-signal)
Focus only on “stop-the-line” issues:
- secrets/client exposure
- browser calling providers
- runtime DDL / missing migration
- precedence/manual override violations
- missing auth on privileged mutations
- broken job durability (status/last error)
- obvious boundary violations (provider logic in web/client)

### 3.2 Merge review (strict, architectural)
Everything in commit review PLUS:
- ADR requirement enforcement (see section 4)
- test completeness expectations
- performance footguns (provider calls in request path)
- operational visibility (job status surfaces, audit log integrity)

---

## 4) ADR Requirement (merge-blocking)

If a change affects any of the following, you MUST add/update an ADR in `/docs/adr`:
- system boundaries / repo shape
- auth model
- queue approach
- data precedence rules
- hosting/deployment topology
- DB/ORM choice

No ADR = FAIL for merge review.  [oai_citation:21‡README.md](sediment://file_00000000b1bc71fdb1ac38df52e4cd84)  [oai_citation:22‡ADR-001-architecture.md](sediment://file_00000000442071fd951b6d06481efd17)

---

## 5) File Placement Rules (enforced)

### apps/web
Allowed:
- UI, pages, server route handlers (“BFF”)
- session validation & permission checks at boundary
Not allowed:
- provider clients
- long-running workflows
- heavy domain logic

### apps/worker
Allowed:
- job registration + execution
- orchestration of imports/exports/enrichment
- provider retry logic and concurrency caps

### packages/core
- domain services, business rules
- merge/resolution logic (precedence)
- approval rules
- orchestration functions used by both web & worker

### packages/integrations
- YouTube/OpenAI/HypeAuditor/HubSpot adapters
- request signing, quotas, retries (but do not store domain rules here)

### packages/contracts
- zod schemas, DTOs, route contracts, queue payload contracts

### packages/db
- prisma schema + migrations + client + transaction helpers

### packages/config
- env parsing, validation, feature flags, constants  [oai_citation:23‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

---

## 6) “Never Do This” Patterns (instant FAIL)

- Calling provider APIs from client components or browser code.
- Putting provider secrets into NEXT_PUBLIC_* or any client bundle surface.
- Adding runtime schema management (“ensure table exists”, “create table if not exists”).
- Writing to resolved catalog fields in a way that can overwrite admin manual overrides.
- Replacing “catalog canonical” with “run-first canonical” behavior.
- Executing HypeAuditor advanced report without approval gating.
- Adding a background job without persisted status + last error.
- Adding privileged mutation routes without audit logging + server-side auth.  [oai_citation:24‡ADR-002-data-ownership-and-precedence.md](sediment://file_0000000015cc71fd86c57d2baf4ba6e9)  [oai_citation:25‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

---

## 7) Validation & Contracts

- Validate all external inputs with zod at the boundary:
  - route requests
  - CSV rows
  - provider payload normalization
  - queue payloads
- Never trust client-provided role/permission flags.
- Prefer explicit DTOs (contracts) between web ↔ core ↔ worker.  [oai_citation:26‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

---

## 8) Jobs Policy (pg-boss discipline)

Every job must define:
- name: `domain.action` (e.g., `runs.discover`)
- payload: zod schema in `packages/contracts`
- idempotency: natural key or dedupe strategy documented in code
- retries: bounded backoff
- concurrency: explicit cap per provider
- persistence: status + timestamps + last error (operator-visible)  [oai_citation:27‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

If you add/modify a job, include:
- unit tests for payload validation
- integration test for job handler effects (DB writes)

---

## 9) Testing Expectations (minimum bar)

Non-trivial change must include the correct layer:
- Unit: domain rules, precedence/merge, provider adapters, queue payload validation
- Integration: route handlers, auth rules, DB transactions, worker job behavior
- E2E (Playwright): user flows for UI behavior changes (login, catalog, runs, approvals, CSV import, HubSpot push)

Auth and migrations ALWAYS require tests.  [oai_citation:28‡ARCHITECTURE.md](sediment://file_00000000c9d071fd875320dd2e50d45a)

---

## 10) PR / Merge Checklist (agents must output this)

For merge review output, include:
- PASS/FAIL verdict
- blocking issues (path, rule violated, fix)
- non-blocking recommendations
- tests to run / update
- security & data-integrity checklist:
  - secrets exposure
  - browser-to-provider calls
  - migrations / no runtime DDL
  - precedence preserved & manual overrides durable
  - approval flow preserved
  - audit events present for privileged actions
  - job status + last error persisted

---

## 11) Ownership Guidance (coordination, not gatekeeping)

Default ownership:
- Ivan: backend, DB, worker, integrations, CI/CD, infra
- Marin: frontend, UX, admin screens, Playwright

Pair on anything that crosses DB + UX or changes canonical data flows.  [oai_citation:29‡TASKS.md](sediment://file_000000006fd471f8869cbb09a1484915)