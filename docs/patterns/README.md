# Code Patterns

This directory contains canonical code patterns for the scouting-platform.

**For AI coding agents:** Copy these patterns when implementing new features. Do not deviate from
the structure unless you have a documented reason.

## Available Patterns

| Pattern | When to Use |
|---------|-------------|
| `route-handler-pattern.ts` | Adding a new API route in `frontend/web/app/api/` |
| `worker-job-pattern.ts` | Adding a new background job in `backend/worker/` |
| `provider-adapter-pattern.ts` | Adding a new external provider in `backend/packages/integrations/` |
| `domain-service-pattern.ts` | Adding business logic in `backend/packages/core/` |
| `error-handling-pattern.ts` | Handling errors anywhere in the codebase |

## How to Use

1. **Read the pattern file** before writing code
2. **Copy the structure** — don't invent a new shape
3. **Follow the checklist** at the bottom of each pattern
4. **Keep the pattern invariants** — these are requirements, not suggestions

These files are documentation-first examples.
They intentionally use `// @ts-nocheck` so the copies in `/docs/patterns` do not raise editor errors before being moved into their real package locations.

## Pattern Invariants (Non-Negotiable)

### Route Handlers
- Server-side auth via `requireAuthenticatedSession()` or `requireAdminSession()`
- Zod/shared-contract validation at the boundary
- Business logic delegated to `@scouting-platform/core`
- Errors normalized with `toRouteErrorResponse()`

### Worker Jobs
- Job name + payload schema defined in `shared/packages/contracts`
- Worker parses payload with `parseJobPayload()`
- Stateful claim/status transitions live in core services
- Explicit concurrency cap

### Provider Adapters
- Lives in `backend/packages/integrations` only
- Secrets from environment only
- Retry with exponential backoff
- Errors normalized to domain types
- Response validated with zod

### Domain Services
- Lives in `backend/packages/core` only
- Shared contract types enter at the service boundary
- Expected failures throw `ServiceError`
- Multi-step writes use `withDbTransaction()`
- Privileged mutations write audit events transactionally

### Error Handling
- Expected backend failures use `ServiceError`
- Routes return the repo JSON error shape: `{ error: string, details? }`
- Safe logging redacts sensitive fields
- Worker errors formatted for logs and `lastError`

## Adding New Patterns

If you need a pattern that doesn't exist:

1. Discuss with the team first
2. Create the pattern file with full example
3. Include the checklist section
4. Update this README
5. Reference from `CODEX_QUICKREF.md`
