# Local Setup

This setup targets macOS and Linux with Docker Compose-compatible runtimes.

For staging deployment, use [`/docs/setup/staging-railway.md`](./staging-railway.md).

## Prerequisites

Required for the container-only path:
- Git
- Docker Engine + Docker Compose

Optional for host-side workspace commands:
- nvm (recommended, installs Node.js 22 from `.nvmrc`)
- Corepack (bundled with modern Node)

If you plan to run host-side workspace commands, verify:

```bash
nvm --version
node -v
corepack --version
docker --version
docker compose version
```

## Bootstrap

From repo root:

Fastest container-only path:

```bash
cp .env.example .env
docker compose up --build
```

This boots Postgres, runs bootstrap setup, applies Prisma migrations, seeds the initial admin, and
starts both the web app and worker entirely inside Docker.

If you also want host-side `pnpm` commands available, use the longer toolchain setup:

```bash
nvm install
nvm use
corepack enable
corepack prepare pnpm@10.6.1 --activate
cp .env.example .env
pnpm infra:up
pnpm infra:ps
pnpm infra:logs
```

`pnpm infra:up` is the host-side shorthand for the same full-stack Docker Compose bring-up.

Then sign in at `http://localhost:3000/login` with:

```text
email: admin@example.com
password: StrongAdminPassword123
```

The Compose bootstrap service now installs dependencies, waits for Postgres, ensures the test DB
exists, applies Prisma migrations, and idempotently seeds the initial admin before `web` and
`worker` start.

The first `pnpm infra:up` can take a few minutes because the bootstrap container installs the
workspace dependencies into Docker-managed volumes.

Optional host-side verification after the stack is up:

```bash
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Day-to-day commands

```bash
pnpm infra:up         # build and start postgres + bootstrap + web + worker
pnpm dev:stack        # alias for the full local dev stack
pnpm infra:pull       # pull latest postgres:17-alpine image
pnpm infra:refresh-postgres # pull + recreate postgres service + wait for readiness
pnpm infra:ps         # inspect container status
pnpm infra:logs       # tail stack logs
pnpm infra:down       # stop containers
pnpm infra:reset-db   # destroy and recreate DB volume
pnpm security:scan:postgres # advisory High/Critical CVE scan for postgres image
```

Advanced helper:

```bash
pnpm infra:db:up      # start only local Postgres for edge-case troubleshooting
```

## DB integration test prep (Week 3 backend)

Run this sequence before DB-backed integration suites:

```bash
docker compose up --build
# or: pnpm infra:up
pnpm infra:ps
pnpm db:migrate:test
pnpm verify:week3:backend
```

Notes:
- `pnpm infra:up` already ensures `scouting_platform_test` exists as part of the bootstrap service.
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
- rerun `pnpm infra:up`

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

### Invalid app encryption key

Symptoms:
- bootstrap, web, or worker exits quickly with `APP_ENCRYPTION_KEY must be exactly 32 characters`

Fix:
- set `APP_ENCRYPTION_KEY` in `.env` to a real 32-character value
- rerun `pnpm infra:up`

### Docker login fails with native `argon2` error

Symptoms:
- login page shows `Unable to sign in right now. Please try again.`
- `pnpm infra:logs` or `docker compose logs web` shows `No native build was found ... webpack=true`
- the same log mentions `.next/server/vendor-chunks`
- or `docker compose logs web` shows `CallbackRouteError` with `RUNTIME_REQUIRE is not a function`

Fix:
- keep native password hashing externalized in `apps/web/next.config.ts` and runtime-resolved in `packages/core/src/auth/password.ts`
- restart the web service so Next picks up the config change:

```bash
docker compose up -d --build web
```

- if the stack was started before the fix landed, rerun `pnpm infra:up`

### Prisma user denied access (`P1010`)

Symptoms:
- `P1010 User was denied access on the database`

Common cause:
- app/tests are connecting to a different Postgres instance than the Docker compose service (often another local service on `localhost:5432`)

Fix:
- run `pnpm infra:ps` and confirm compose Postgres is up and mapped to the expected host port
- if needed, remap the full stack and align `.env` URLs:
  - `POSTGRES_PORT=5433 pnpm infra:up`
  - update both `DATABASE_URL` and `DATABASE_URL_TEST` to `localhost:5433`
- run `pnpm db:migrate:test`
- rerun `pnpm verify:week3:backend`
