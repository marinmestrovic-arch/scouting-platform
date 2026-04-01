# ADR-003: Repository Layout Simplification

- Status: Accepted
- Date: 2026-04-01

## Context

The repository originally separated code under top-level `apps/` and `packages/` directories. That preserved runtime boundaries, but it made the repo harder to scan because frontend, backend, and shared packages were mixed at the same level.

The accepted refactor goal was organizational clarity, not a runtime redesign.

## Decision

Use responsibility-oriented top-level directories:

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
```

This decision keeps the runtime architecture unchanged:
- `frontend/web` remains the Next.js app
- `backend/worker` remains the separate worker process
- `backend/packages/core` remains the domain layer
- `backend/packages/db` remains the Prisma/database layer
- `backend/packages/integrations` remains the provider adapter layer
- `shared/packages/contracts` and `shared/packages/config` remain cross-runtime packages

## Consequences

### Positive

- frontend, backend, and shared code are immediately discoverable from the repo root
- package intent is easier to infer for new contributors
- runtime boundaries stay the same, so the change is primarily navigational

### Neutral

- path-sensitive scripts, tests, and docs must stay aligned with the accepted layout
- historical ADRs still matter for context, but current path/layout docs should point to this ADR

## Notes

ADR-001 remains valuable historical context for the original service-boundary decision, but the current repository layout is governed by this ADR.
