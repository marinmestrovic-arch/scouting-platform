# Postgres Backup And Restore Drill

Use this drill before launch and after any significant schema or operational change.

This runbook is written for Railway-hosted staging/production and local Postgres-compatible tooling.

## Goal

Prove that operators can:

- create a logical backup
- restore it into a fresh database
- verify the restored database is usable by the app

## Prerequisites

- `pg_dump` and `psql` installed locally
- access to the target Railway Postgres instance
- a separate restore target database or disposable Postgres instance
- current app env vars for the restore target available

## 1. Capture a backup

Export a compressed custom-format dump from the source database:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=backup.dump --no-owner --no-privileges
```

Local Docker alternative:

```bash
docker compose exec -T postgres pg_dump \
  -U scouting \
  -d scouting_platform \
  --format=custom \
  --file=/tmp/backup.dump \
  --no-owner \
  --no-privileges
```

Record:

- source environment
- timestamp
- schema/migration state being backed up

## 2. Prepare a clean restore target

Create or reset a restore target database. Do not restore into the live source database.

Example:

```bash
createdb scouting_platform_restore
```

If the target already exists and is disposable:

```bash
dropdb scouting_platform_restore
createdb scouting_platform_restore
```

Local Docker alternative:

```bash
docker compose exec -T postgres psql -U scouting -d postgres -c "DROP DATABASE IF EXISTS scouting_platform_restore"
docker compose exec -T postgres psql -U scouting -d postgres -c "CREATE DATABASE scouting_platform_restore"
```

## 3. Restore the backup

Restore the dump into the clean target:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --dbname=postgresql://.../scouting_platform_restore backup.dump
```

Local Docker alternative:

```bash
docker compose exec -T postgres pg_restore \
  -U scouting \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname=scouting_platform_restore \
  /tmp/backup.dump
```

## 4. Verify basic data integrity

Run a few high-signal sanity checks:

```bash
psql postgresql://.../scouting_platform_restore -c "SELECT COUNT(*) FROM users;"
psql postgresql://.../scouting_platform_restore -c "SELECT COUNT(*) FROM channels;"
psql postgresql://.../scouting_platform_restore -c "SELECT COUNT(*) FROM run_requests;"
psql postgresql://.../scouting_platform_restore -c "SELECT COUNT(*) FROM audit_events;"
```

Local Docker alternative:

```bash
docker compose exec -T postgres psql -U scouting -d scouting_platform_restore -c "SELECT COUNT(*) FROM users;"
docker compose exec -T postgres psql -U scouting -d scouting_platform_restore -c "SELECT COUNT(*) FROM channels;"
docker compose exec -T postgres psql -U scouting -d scouting_platform_restore -c "SELECT COUNT(*) FROM run_requests;"
docker compose exec -T postgres psql -U scouting -d scouting_platform_restore -c "SELECT COUNT(*) FROM audit_events;"
```

Check that key application tables exist and row counts are plausible.

## 5. Verify app compatibility

Point a disposable app instance or local app process at the restored database and verify:

- web boots
- worker boots
- login works
- dashboard or catalog page loads

If the restore target represents staging, run the staging smoke checklist from
[`/docs/setup/staging-railway.md`](./staging-railway.md).

## 6. Record the drill

Capture:

- date
- source database/environment
- restore target
- operator
- success/failure
- any missing steps or surprises

Keep the record in your operational tracking system; do not commit environment-specific outputs to the repo.

If you used the local Docker alternative, clean up the disposable restore target and dump file afterward:

```bash
docker compose exec -T postgres psql -U scouting -d postgres -c "DROP DATABASE scouting_platform_restore"
docker compose exec -T postgres rm -f /tmp/backup.dump
```

## Failure handling

- If `pg_restore` fails on schema incompatibility, stop and identify the migration boundary mismatch.
- If the restored app cannot boot, treat it as a launch blocker until the restore path is understood.
- Do not down-migrate a live database as part of the drill.
