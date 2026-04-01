# CODEX_QUICKREF.md

Quick reference for AI coding agents. Read this first, then dive into full docs as needed.

---

## File Placement (one rule per directory)

| Directory | What Goes Here | What Does NOT Go Here |
|-----------|----------------|----------------------|
| `frontend/web/app/` | Pages, route handlers, server actions | Domain logic, provider calls |
| `frontend/web/components/` | React components, UI primitives | Business rules, API calls to providers |
| `backend/worker/src/` | Job registration, queue bootstrap, job handlers | UI code, domain rules |
| `backend/packages/core/src/` | Domain services, business rules, merge logic | Provider HTTP calls, UI code |
| `backend/packages/db/` | Prisma schema, migrations, DB helpers | Business logic, provider calls |
| `backend/packages/integrations/src/` | YouTube/OpenAI/HypeAuditor/HubSpot adapters | Domain rules, UI code |
| `shared/packages/contracts/src/` | Zod schemas, DTOs, route/queue contracts | Implementation code |
| `shared/packages/config/src/` | Env validation, feature flags, constants | Business logic |

---

## Hard Stops (instant PR FAIL)

1. **Browser calling providers** — YouTube/OpenAI/HypeAuditor/HubSpot calls MUST go through backend
2. **Secrets in `NEXT_PUBLIC_*`** — Never expose provider keys to client bundles
3. **Runtime DDL** — No `CREATE TABLE IF NOT EXISTS` in app code; Prisma migrations only
4. **Overwriting admin manual overrides** — Automated sources never replace `admin_manual` fields
5. **HypeAuditor without approval** — Every advanced report requires admin approval before execution
6. **Jobs without durability** — Every job MUST persist `status` + `lastError` + timestamps
7. **Privileged mutations without audit** — Admin actions MUST emit audit events
8. **Missing server-side auth** — UI hiding is not security; enforce in route handlers

---

## Data Precedence (memorize this order)

```
1. admin_manual      ← highest, never auto-overwritten
2. csv_import
3. hypeauditor
4. llm
5. heuristics
6. youtube_raw       ← lowest
```

---

## Test Requirements (when to add tests)

| Change Type | Required Test |
|-------------|---------------|
| New route handler | Integration test in `*.test.ts` or `e2e/` |
| New domain function | Unit test in same package |
| New/changed migration | Migration safety test |
| Auth changes | Auth integration test (required, not optional) |
| New worker job | Job handler integration test |
| Provider adapter change | Adapter unit test with mocked responses |

---

## Before Every PR (checklist)

```
□ No secrets exposed to browser
□ No browser-to-provider calls
□ Migrations use Prisma only (no runtime DDL)
□ Admin overrides preserved (precedence respected)
□ Approval flows intact (HypeAuditor gated)
□ Audit events for privileged actions
□ Jobs have status + lastError persistence
□ Server-side auth on all mutations
□ Tests added for change type (see table above)
```

---

## Patterns (copy these)

See `docs/patterns/` for working examples:
- `route-handler-pattern.ts` — auth + validation + audit
- `worker-job-pattern.ts` — claim + status + retry + error
- `provider-adapter-pattern.ts` — retry + error normalization
- `domain-service-pattern.ts` — precedence-safe updates
- `error-handling-pattern.ts` — consistent error shapes

---

## Quick Links

| Need | Document |
|------|----------|
| Full architecture | `/ARCHITECTURE.md` |
| Product scope | `/PROJECTS_SPECS.md` |
| Current tasks | `/TASKS.md` |
| Agent rules (full) | `/docs/AGENTS.md` |
| ADR template | `/docs/README.md` |
| Local setup | `/docs/setup/local.md` |

---

## When to Stop and Ask

- Changing anything in the precedence list
- Adding a new queue family
- Modifying auth model
- Changing DB schema beyond additive columns
- Anything that might need an ADR (see `/docs/README.md`)
