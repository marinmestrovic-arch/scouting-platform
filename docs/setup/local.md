# Local Setup

This setup targets macOS and Linux with Docker Compose-compatible runtimes.

For staging deployment, use [`/docs/setup/staging-railway.md`](./staging-railway.md).

## Prerequisites

Install:
- Git
- Docker Engine + Docker Compose
- nvm (recommended, installs Node.js 22 from `.nvmrc`)
- Corepack (bundled with modern Node)

Verify:

```bash
nvm --version
node -v
corepack --version
docker --version
docker compose version
```

## Bootstrap

From repo root:

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@10.6.1 --activate
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:wait
pnpm db:migrate
export INITIAL_ADMIN_EMAIL="admin@example.com"
export INITIAL_ADMIN_PASSWORD="replace-me-strong-password"
export INITIAL_ADMIN_NAME="Initial Admin"
pnpm db:seed:admin
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Day-to-day commands

```bash
pnpm infra:up         # start local Postgres
pnpm infra:pull       # pull latest postgres:17-alpine image
pnpm infra:refresh-postgres # pull + recreate postgres service + wait for readiness
pnpm infra:ps         # inspect container status
pnpm infra:logs       # tail Postgres logs
pnpm infra:down       # stop containers
pnpm infra:reset-db   # destroy and recreate DB volume
pnpm security:scan:postgres # advisory High/Critical CVE scan for postgres image
```

## DB integration test prep (Week 3 backend)

Run this sequence before DB-backed integration suites:

```bash
pnpm infra:up
pnpm infra:ps
docker compose exec -T postgres sh -lc "psql -U scouting -d scouting_platform -v ON_ERROR_STOP=1 -tAc \"SELECT 1 FROM pg_database WHERE datname = 'scouting_platform_test'\" | grep -q 1 || psql -U scouting -d scouting_platform -v ON_ERROR_STOP=1 -c \"CREATE DATABASE scouting_platform_test\""
pnpm db:migrate:test
pnpm verify:week3:backend
```

Notes:
- `pnpm db:migrate:test` migrates using `DATABASE_URL_TEST`.
- `pnpm verify:week3:backend` runs Week 3 core + API integration suites sequentially.

## PostgreSQL version verification

```bash
docker compose exec -T postgres psql -U scouting -d scouting_platform -tAc "show server_version;"
```

Expected output starts with `17.`.

## Weekly PostgreSQL image refresh cadence

Run this once per week (recommended):

```bash
pnpm infra:refresh-postgres
pnpm security:scan:postgres
docker compose exec -T postgres psql -U scouting -d scouting_platform -tAc "show server_version;"
```

Expected version output still starts with `17.`.

## PostgreSQL image vulnerability note (as of March 6, 2026)

- We intentionally use the official `postgres:17-alpine` image for local dev and CI service containers.
- Current Docker Scout findings are primarily tied to `gosu` built with `golang/stdlib 1.24.6` in upstream images.
- The same High/Critical cluster appears on both `postgres:17-alpine` and `postgres:17` variants right now.
- This is treated as a temporary accepted risk for foundation-phase local + CI environments only (not production hardening).

Baseline reference:

- image: `postgres:17-alpine`
- digest: `sha256:6f30057d31f5861b66f3545d4821f987aacf1dd920765f0acadea0c58ff975b1`

## When upstream fixes land

1. Run `pnpm infra:refresh-postgres` to pull and recreate the local Postgres service.
2. Run `pnpm security:scan:postgres` and compare CVE counts/severity against the previous baseline.
3. Capture new image digest with `docker image ls --digests postgres`.
4. Update this runbook with the new baseline date, digest, and CVE delta.

## Troubleshooting

### Docker daemon is not running

Symptoms:
- `Cannot connect to the Docker daemon`

Fix:
- start Docker Desktop (macOS) or Docker service (Linux), then rerun `pnpm infra:up`

### Port `5432` already in use

Symptoms:
- container fails to start with bind error

Fix:
- set an alternate local port:

```bash
POSTGRES_PORT=5433 pnpm infra:up
```

- update `DATABASE_URL` and `DATABASE_URL_TEST` in `.env` to match the new port
- rerun `pnpm db:migrate:test` before DB-backed tests

### Wrong Node version

Symptoms:
- install/build failures from unsupported engine features

Fix:
- run `nvm install` and `nvm use`, then rerun `pnpm install`

### macOS `/usr/local` permission issues

Symptoms:
- permission denied errors from globally installed Node tooling under `/usr/local`

Fix:
- avoid system Node installs; use `nvm install` and `nvm use` so Node and global tooling stay in your user-owned environment

### Prisma cannot connect

Symptoms:
- `P1001` or `Can't reach database server`

Fix:
- run `pnpm infra:ps` to confirm healthy state
- run `pnpm infra:logs` for errors
- run `pnpm db:wait` and retry `pnpm db:validate`

### Prisma user denied access (`P1010`)

Symptoms:
- `P1010 User was denied access on the database`

Common cause:
- app/tests are connecting to a different Postgres instance than the Docker compose service (often another local service on `localhost:5432`)

Fix:
- run `pnpm infra:ps` and confirm compose Postgres is up and mapped to the expected host port
- if needed, remap compose Postgres and align `.env` URLs:
  - `POSTGRES_PORT=5433 pnpm infra:up`
  - update both `DATABASE_URL` and `DATABASE_URL_TEST` to `localhost:5433`
- run `pnpm db:migrate:test`
- rerun `pnpm verify:week3:backend`
