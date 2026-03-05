# Local Setup

This setup targets macOS and Linux with Docker Compose-compatible runtimes.

## Prerequisites

Install:
- Git
- Docker Engine + Docker Compose
- Node.js 22 (matches `.nvmrc`)
- Corepack (bundled with modern Node)

Verify:

```bash
node -v
corepack --version
docker --version
docker compose version
```

## Bootstrap

From repo root:

```bash
corepack enable
corepack prepare pnpm@10.6.1 --activate
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:wait
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Day-to-day commands

```bash
pnpm infra:up         # start local Postgres
pnpm infra:ps         # inspect container status
pnpm infra:logs       # tail Postgres logs
pnpm infra:down       # stop containers
pnpm infra:reset-db   # destroy and recreate DB volume
```

## PostgreSQL version verification

```bash
docker compose exec -T postgres psql -U scouting -d scouting_platform -tAc "show server_version;"
```

Expected output starts with `17.`.

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

### Wrong Node version

Symptoms:
- install/build failures from unsupported engine features

Fix:
- switch to Node 22 and rerun `pnpm install`

### Prisma cannot connect

Symptoms:
- `P1001` or `Can't reach database server`

Fix:
- run `pnpm infra:ps` to confirm healthy state
- run `pnpm infra:logs` for errors
- run `pnpm db:wait` and retry `pnpm db:validate`
