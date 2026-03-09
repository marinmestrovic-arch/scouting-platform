# AGENTS

This file defines how human contributors and AI coding agents must work in `scouting-platform`.

## 1. Read This First

Before changing code, read in this order:
1. `/README.md`
2. `/PROJECTS_SPECS.md`
3. `/ARCHITECTURE.md`
4. `/TASKS.md`

Do not implement features from memory if the docs disagree with your assumptions.

## 2. Hard Rules

1. Postgres only.
2. Prisma migrations only. Never create or alter tables at runtime.
3. The worker is a separate process from the web app.
4. The browser must never call YouTube, OpenAI, HypeAuditor, or HubSpot directly.
5. Manual admin overrides outrank all automated sources.
6. Catalog is canonical. Runs are snapshots on top of the catalog.
7. Every privileged action must be audited.
8. Every background job must persist status and last error.
9. Do not introduce a new major subsystem unless both founders approve it.
10. If a change would alter product scope or system shape, write an ADR first.

## 3. Architecture Change Policy

A change requires an ADR in `/docs` if it affects:
- system boundaries
- auth model
- data precedence rules
- queueing approach
- deployment topology
- DB ownership or ORM choice

ADR approval requires both Ivan and Marin.

## 4. Coding Rules

- Prefer TypeScript everywhere.
- Prefer small, typed domain functions in `packages/core`.
- Keep route handlers thin.
- Keep provider logic inside `packages/integrations`.
- Validate inputs with zod at every external boundary.
- Use transactions for critical write paths.
- Keep comments rare and specific.
- Do not add new dependencies unless they solve a real repeated problem.

## 5. Security Rules

- Never log secrets.
- Never send provider secrets to the client.
- User YouTube API keys must be encrypted at rest.
- Admin-only actions must enforce authorization server-side.
- Contact emails are intentionally visible to all authenticated users.

## 6. Data Rules

Resolved field precedence is fixed:
1. admin manual edit
2. admin CSV import
3. HypeAuditor
4. LLM
5. heuristics
6. YouTube raw

## 6.1 Migration Style Policy

- Prefer deterministic Prisma-generated migration DDL.
- Avoid `IF NOT EXISTS`, conditional enum creation, and other defensive SQL guards in committed migrations unless there is a documented environment/bootstrap reason.
- If a migration intentionally uses non-deterministic or defensive DDL, explain why in the PR description and add a short comment at the top of the migration file.


Do not change this order casually.

## 7. Background Job Rules

Use `pg-boss` for async work.

Every job must have:
- typed payload
- idempotency strategy
- retry policy
- bounded concurrency
- explicit failure logging
- visible last error for operators

## 8. Testing Rules

Any non-trivial change should include the appropriate test layer:
- unit tests for domain logic
- integration tests for DB/route behavior
- Playwright for user flows when UI behavior changes

Migrations and auth changes always require tests.

## 9. Pull Request Rules

- Work from an issue in `/TASKS.md`
- Keep PRs small and milestone-aligned
- Do not mix infrastructure and feature UI work unless the issue explicitly requires both
- If a migration is included, call it out clearly in the PR description
- Request review from the other founder before merge

## 10. Ownership Split

Default ownership:
- Ivan: backend, DB, worker, integrations, CI/CD, infra
- Marin: frontend, UX, admin screens, Playwright

This is ownership, not exclusivity. Pair when a task crosses both surfaces.

## 11. Definition of Done

A task is not done until:
- code is implemented
- validation and auth are correct
- tests are updated where needed
- docs are updated if behavior changed
- the acceptance criteria from `/TASKS.md` are satisfied

## 12. What Not To Do

- Do not recreate the old mixed run/catalog architecture
- Do not add runtime DDL
- Do not make admin features publicly reachable
- Do not hide failures behind warnings
- Do not leave long-lived TODOs in critical paths
