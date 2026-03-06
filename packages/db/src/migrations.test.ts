import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const pgbossMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260305174500_pgboss_setup/migration.sql",
);
const week1MigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260305213000_week1_auth_catalog/migration.sql",
);
const week2MigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260306123000_week2_saved_segments/migration.sql",
);
const week2ManualOverridesMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260306163000_week2_channel_manual_overrides/migration.sql",
);
const week3RunsFoundationMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260306190000_week3_runs_foundation/migration.sql",
);

describe("pg-boss migration", () => {
  it("installs the pgboss schema and version table", () => {
    const migrationSql = readFileSync(pgbossMigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE SCHEMA IF NOT EXISTS pgboss");
    expect(migrationSql).toContain("CREATE TABLE pgboss.version");
    expect(migrationSql).toContain("INSERT INTO pgboss.version(version)");
  });
});

describe("week 1 auth/catalog migration", () => {
  it("creates auth, credentials, channel, and audit tables", () => {
    const migrationSql = readFileSync(week1MigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS sessions");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS user_provider_credentials");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS channels");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS audit_events");
  });
});

describe("week 2 segments migration", () => {
  it("creates saved_segments with ownership and list indexes", () => {
    const migrationSql = readFileSync(week2MigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS saved_segments");
    expect(migrationSql).toContain("REFERENCES users (id) ON DELETE CASCADE");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS saved_segments_user_id_idx");
    expect(migrationSql).toContain(
      "CREATE INDEX IF NOT EXISTS saved_segments_user_id_updated_at_idx",
    );
  });
});

describe("week 2 manual overrides migration", () => {
  it("creates override enum, table, and indexes", () => {
    const migrationSql = readFileSync(week2ManualOverridesMigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE TYPE channel_manual_override_field AS ENUM");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS channel_manual_overrides");
    expect(migrationSql).toContain("ON channel_manual_overrides (channel_id, field)");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS channel_manual_overrides_channel_id_idx");
    expect(migrationSql).toContain(
      "CREATE INDEX IF NOT EXISTS channel_manual_overrides_created_by_user_id_idx",
    );
    expect(migrationSql).toContain(
      "CREATE INDEX IF NOT EXISTS channel_manual_overrides_updated_by_user_id_idx",
    );
  });
});

describe("week 3 runs foundation migration", () => {
  it("creates run_requests and run_results with lifecycle indexes", () => {
    const migrationSql = readFileSync(week3RunsFoundationMigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE TYPE run_request_status AS ENUM");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS run_requests");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS run_results");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS run_requests_status_idx");
    expect(migrationSql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS run_results_run_request_id_channel_id_key",
    );
  });
});
