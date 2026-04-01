# AGENTS.md (v3) — Scouting Platform Agent Policy

This file defines how humans and AI coding agents work in `scouting-platform`.

**Quick start:** Read `/CODEX_QUICKREF.md` first for the condensed rules.

---

## 0. Operating Principle

**Default stance is safety.**

If unsure about correctness, security, or data integrity:
- Stop
- Explain risk
- Propose smallest safe fix
- Prefer "FAIL" for merge reviews

---

## 1. Read Order

Before making meaningful changes, read in this order:

1. `/CODEX_QUICKREF.md` — condensed rules and checklists
2. `/TASKS.md` — current milestone and your assigned work
3. `/docs/patterns/` — copy patterns for new code

For deeper context when needed:
- `/ARCHITECTURE.md` — system design
- `/PROJECTS_SPECS.md` — product scope
- `/docs/ADR-*.md` — architectural decisions

Do not implement from memory if docs disagree.

---

## 2. Hard Rules (MUST / FAIL if violated)

### 2.1 Architecture & Boundaries
| Rule | Violation |
|------|-----------|
| Provider calls in `backend/packages/integrations` only | Browser calling YouTube/OpenAI/HypeAuditor/HubSpot |
| Domain logic in `backend/packages/core` only | Business rules in route handlers or UI |
| Worker is separate process from web | Long-running work in request handlers |
| Postgres + Prisma migrations only | Runtime DDL, `CREATE TABLE IF NOT EXISTS` |

### 2.2 Security
| Rule | Violation |
|------|-----------|
| Secrets server-side only | `NEXT_PUBLIC_*` containing API keys |
| User YouTube keys encrypted at rest | Plaintext credential storage |
| Auth enforced server-side | UI hiding as security |
| Audit events for privileged actions | Admin mutations without audit trail |

### 2.3 Data Precedence (ADR-002)
```
1. admin_manual      ← NEVER auto-overwritten
2. csv_import
3. hypeauditor
4. llm
5. heuristics
6. youtube_raw
```

Manual admin overrides must never be overwritten by automated sources.

### 2.4 Approval Flows
- HypeAuditor advanced reports require admin approval before execution
- No bypass mechanism permitted

### 2.5 Job Durability
Every background job must persist:
- Status (queued → running → completed/failed)
- Timestamps (startedAt, completedAt)
- lastError on failure

---

## 3. File Placement

See `/CODEX_QUICKREF.md` for the full table. Summary:

| Directory | What Goes Here |
|-----------|----------------|
| `frontend/web/app/` | Pages, route handlers, server actions |
| `backend/worker/src/` | Job handlers, queue bootstrap |
| `backend/packages/core/` | Domain services, business rules |
| `backend/packages/integrations/` | Provider adapters |
| `backend/packages/db/` | Prisma schema, migrations |
| `shared/packages/contracts/` | Zod schemas, DTOs |

---

## 4. Code Patterns

**Always copy from `/docs/patterns/` when creating:**

| New Code | Pattern File |
|----------|--------------|
| API route | `route-handler-pattern.ts` |
| Background job | `worker-job-pattern.ts` |
| Provider client | `provider-adapter-pattern.ts` |
| Domain service | `domain-service-pattern.ts` |
| Error handling | `error-handling-pattern.ts` |

Each pattern includes a checklist. Complete it before PR.

---

## 5. "Never Do This" (Instant FAIL)

1. Calling provider APIs from client components or browser code
2. Putting provider secrets into `NEXT_PUBLIC_*`
3. Adding runtime schema management
4. Overwriting admin manual overrides from automated sources
5. Executing HypeAuditor without approval gating
6. Adding jobs without status + lastError persistence
7. Adding privileged routes without audit logging + server-side auth

---

## 6. ADR Requirement

Changes to these require an ADR in `/docs/` before merge:
- System boundaries / repo shape
- Auth model
- Queue approach
- Data precedence rules
- Hosting/deployment topology
- DB/ORM choice

No ADR = FAIL for merge review.

---

## 7. Testing Requirements

| Change Type | Required Test |
|-------------|---------------|
| New route handler | Integration test |
| New domain function | Unit test |
| New/changed migration | Migration safety test |
| Auth changes | Auth integration test (**required**) |
| New worker job | Job handler integration test |
| Provider adapter change | Adapter unit test with mocks |

---

## 8. PR Checklist

Output this for every merge review:

```
□ No secrets exposed to browser
□ No browser-to-provider calls
□ Migrations use Prisma only
□ Admin overrides preserved
□ Approval flows intact
□ Audit events for privileged actions
□ Jobs have status + lastError
□ Server-side auth on mutations
□ Tests added for change type
□ Pattern checklist completed
```

---

## 9. Review Modes

### Commit Review (fast)
Focus on stop-the-line issues:
- Secrets/client exposure
- Browser calling providers
- Runtime DDL
- Missing auth
- Broken job durability

### Merge Review (strict)
Everything above PLUS:
- ADR requirement check
- Test completeness
- Pattern compliance
- Performance (no provider calls in request path)

---

## 10. Ownership

| Owner | Scope |
|-------|-------|
| Ivan | Backend, DB, worker, integrations, CI/CD, infra |
| Marin | Frontend, UX, admin screens, Playwright |

**Pair on:** Schema changes, ADR decisions, DB + UX crossover.

---

## 11. Plans Directory

Files in `/docs/plans/` describe future work.

**Do not implement** unless explicitly instructed. Each plan file should have a status header:
- `Status: Draft` — under discussion
- `Status: Approved` — ready for implementation
- `Status: Deferred` — not yet scheduled

---

## 12. Migration Style

- Prefer deterministic Prisma-generated DDL
- Avoid `IF NOT EXISTS`, conditional enum creation
- If defensive DDL is needed, explain in PR and add comment in migration file
