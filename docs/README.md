# Documentation

## Quick Start for AI Agents

1. Read [`/AGENTS.md`](../AGENTS.md) for full agent policy
2. Read [`/docs/CODEX_QUICKREF.md`](./CODEX_QUICKREF.md) for the condensed rules
3. Check [`/docs/TASKS.md`](./TASKS.md) for current work
4. Copy from [`/docs/patterns/`](./patterns/README.md) when writing new code

## Living Docs

These files should reflect the current implementation:
- [`/README.md`](../README.md)
- [`/AGENTS.md`](../AGENTS.md)
- [`/docs/PROJECT_SPEC.md`](./PROJECT_SPEC.md)
- [`/docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`/docs/CODEX_QUICKREF.md`](./CODEX_QUICKREF.md)
- [`/docs/EVALUATION.md`](./EVALUATION.md)
- this file

Files under [`/docs/plans/`](./plans/) are future-work documents, not current-state specs.

## Directory Structure

```text
docs/
├── README.md
├── ARCHITECTURE.md
├── CODEX_QUICKREF.md
├── PROJECT_SPEC.md
├── TASKS.md
├── EVALUATION.md
├── ADR-001-architecture.md
├── ADR-002-data-ownership-and-precedence.md
├── ADR-003-repository-layout-simplification.md
├── ADR-004-account-security-hardening.md
├── ADR-005-youtube-declared-country-precedence.md
├── patterns/
├── plans/
└── setup/
```

The top-level [`/AGENTS.md`](../AGENTS.md) governs agent and contributor policy.

## ADRs

Create an ADR when changing:
- system shape or boundaries
- auth model
- queue approach
- data precedence rules
- hosting/deployment topology
- DB/ORM choice

### Current ADRs

| ADR | Topic | Status |
|-----|-------|--------|
| ADR-001 | Original monorepo shape and service boundaries | Accepted, historical |
| ADR-002 | Catalog canonical model and data precedence | Accepted |
| ADR-003 | Repository layout simplification | Accepted |
| ADR-004 | Account security hardening | Accepted |
| ADR-005 | YouTube-declared creator country precedence | Accepted |

Use ADR-003 for current repository paths. Treat ADR-001 as historical context rather than the living source of truth for the current layout.

### ADR Template

```markdown
# ADR-XXX: Title

- Status: Proposed | Accepted | Deprecated | Superseded
- Date: YYYY-MM-DD

## Context
What problem or pressure makes this decision necessary?

## Decision
What are we deciding now?

## Consequences
What becomes easier or harder?
```

## Code Patterns

See [`/docs/patterns/README.md`](./patterns/README.md) for the full list.

| Creating | Copy From |
|----------|-----------|
| API route | `patterns/route-handler-pattern.ts` |
| Background job | `patterns/worker-job-pattern.ts` |
| Provider client | `patterns/provider-adapter-pattern.ts` |
| Domain service | `patterns/domain-service-pattern.ts` |
| Error handling | `patterns/error-handling-pattern.ts` |

## Plans Directory

Files in [`/docs/plans/`](./plans/) describe future work and should not be treated as current architecture or current product docs unless a plan explicitly graduates into a living doc update.

## Setup Guides

| Guide | Purpose |
|-------|---------|
| `setup/local.md` | Local development with Docker |
| `setup/staging-railway.md` | Staging deployment runbook |
| `setup/launch-readiness.md` | Pre-launch checklist |
| `setup/postgres-backup-restore-drill.md` | Backup/restore verification |
| `setup/channel-country-repair.md` | Dry-run and repair legacy creator-country labels |
