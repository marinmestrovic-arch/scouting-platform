# Documentation

## Quick Start for AI Agents

1. Read `/CODEX_QUICKREF.md` first
2. Check `/TASKS.md` for your current work
3. Copy from `/docs/patterns/` when writing new code

## Directory Structure

```
docs/
├── AGENTS.md              # AI coding agent rules
├── README.md              # This file
├── ADR-001-architecture.md
├── ADR-002-data-ownership-and-precedence.md
├── ADR-003-repository-layout-simplification.md
├── patterns/              # Code patterns to copy
│   ├── README.md
│   ├── route-handler-pattern.ts
│   ├── worker-job-pattern.ts
│   ├── provider-adapter-pattern.ts
│   ├── domain-service-pattern.ts
│   └── error-handling-pattern.ts
├── plans/                 # Future work (do not implement unless instructed)
│   └── ...
└── setup/
    ├── local.md
    ├── staging-railway.md
    ├── launch-readiness.md
    └── postgres-backup-restore-drill.md
```

## ADRs (Architectural Decision Records)

Create an ADR when changing:
- System shape or boundaries
- Auth model
- Queue approach
- Data precedence rules
- Hosting/deployment topology
- DB/ORM choice

### Current ADRs

| ADR | Topic | Status |
|-----|-------|--------|
| ADR-001 | Monorepo shape and service boundaries | Accepted |
| ADR-002 | Catalog canonical model and data precedence | Accepted |
| ADR-003 | Repository layout simplification | Proposed |

### ADR Template

```markdown
# ADR-XXX: Title

- Status: Proposed | Accepted | Deprecated | Superseded
- Date: YYYY-MM-DD

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing?

## Consequences
What becomes easier or harder?
```

## Code Patterns

See `/docs/patterns/README.md` for the full list.

**Rule:** When creating new code, copy the appropriate pattern first.

| Creating | Copy From |
|----------|-----------|
| API route | `patterns/route-handler-pattern.ts` |
| Background job | `patterns/worker-job-pattern.ts` |
| Provider client | `patterns/provider-adapter-pattern.ts` |
| Domain service | `patterns/domain-service-pattern.ts` |
| Error handling | `patterns/error-handling-pattern.ts` |

## Plans Directory

Files in `/docs/plans/` describe future work that is **not yet implemented**.

Each plan should have a status header:
- `Status: Draft` — Under discussion, do not implement
- `Status: Approved` — Ready for implementation when scheduled
- `Status: Deferred` — Explicitly postponed

**AI agents:** Do not implement plans unless explicitly instructed by a human.

## Setup Guides

| Guide | Purpose |
|-------|---------|
| `setup/local.md` | Local development with Docker |
| `setup/staging-railway.md` | Staging deployment runbook |
| `setup/launch-readiness.md` | Pre-launch checklist |
| `setup/postgres-backup-restore-drill.md` | Backup/restore verification |
