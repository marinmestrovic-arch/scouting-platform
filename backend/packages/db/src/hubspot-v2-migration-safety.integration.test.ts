import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

const require = createRequire(import.meta.url);
const { Client } = require("pg") as {
  Client: new (options: { connectionString: string }) => PgClient;
};

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../prisma/migrations");
const v2MigrationName = "20260720120000_hubspot_integration_v2";
const collaborationMigrationName = "20260721150000_hubspot_collaboration_history";

function databaseNameFromUrl(value: string): string {
  return decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
}

integration("HubSpot V2 migration safety", () => {
  let admin: PgClient;
  let migrated: PgClient;
  let temporaryDatabaseName = "";

  beforeAll(async () => {
    const sourceDatabaseName = databaseNameFromUrl(databaseUrl);
    if (!/(^|[_-])test($|[_-])/i.test(sourceDatabaseName)) {
      throw new Error("HubSpot migration safety requires a dedicated test database");
    }

    temporaryDatabaseName = `scouting_hs_v2_${randomUUID().replaceAll("-", "").slice(0, 12)}_test`;
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${temporaryDatabaseName}"`);

    const temporaryUrl = new URL(databaseUrl);
    temporaryUrl.pathname = `/${temporaryDatabaseName}`;
    temporaryUrl.searchParams.delete("schema");
    migrated = new Client({ connectionString: temporaryUrl.toString() });
    await migrated.connect();

    const migrationNames = (await readdir(migrationsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const v2Index = migrationNames.indexOf(v2MigrationName);
    if (v2Index < 1) {
      throw new Error("HubSpot V2 migration must follow the existing schema migrations");
    }

    for (const migrationName of migrationNames.slice(0, v2Index)) {
      const sql = await readFile(
        path.join(migrationsDir, migrationName, "migration.sql"),
        "utf8",
      );
      await migrated.query(sql);
    }

    await migrated.query(`
      INSERT INTO users (id, email, password_hash, role)
      VALUES ('11111111-1111-4111-8111-111111111111', 'migration@example.com', 'hash', 'admin');

      INSERT INTO channels (id, youtube_channel_id, title)
      VALUES ('22222222-2222-4222-8222-222222222222', 'UC-migration-safety', 'Migration Creator');

      INSERT INTO run_requests (id, requested_by_user_id, name, query, status)
      VALUES (
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        'Legacy run',
        'legacy query',
        'completed'
      );

      INSERT INTO hubspot_import_batches (
        id, requested_by_user_id, run_request_id, file_name, schema_version,
        status, total_row_count, prepared_row_count, failed_row_count, csv_content, updated_at
      ) VALUES (
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
        'legacy.csv',
        'week7-hubspot-import-v2',
        'completed',
        1,
        1,
        0,
        'Email\\ncreator@example.com',
        CURRENT_TIMESTAMP
      );

      INSERT INTO hubspot_import_batch_rows (
        id, batch_id, channel_id, contact_email, first_name, last_name,
        payload, status, updated_at
      ) VALUES (
        '55555555-5555-4555-8555-555555555555',
        '44444444-4444-4444-8444-444444444444',
        '22222222-2222-4222-8222-222222222222',
        'creator@example.com',
        'Legacy',
        'Creator',
        '{"csv":{"Email":"creator@example.com"}}'::jsonb,
        'prepared',
        CURRENT_TIMESTAMP
      );

      INSERT INTO hubspot_push_batches (
        id, requested_by_user_id, scope_payload, status, total_row_count,
        pushed_row_count, failed_row_count, updated_at
      ) VALUES (
        '66666666-6666-4666-8666-666666666666',
        '11111111-1111-4111-8111-111111111111',
        '{"type":"selected","channelIds":["22222222-2222-4222-8222-222222222222"]}'::jsonb,
        'completed',
        1,
        1,
        0,
        CURRENT_TIMESTAMP
      );

      INSERT INTO hubspot_push_batch_rows (
        id, batch_id, channel_id, contact_email, status, hubspot_object_id, updated_at
      ) VALUES (
        '77777777-7777-4777-8777-777777777777',
        '66666666-6666-4666-8666-666666666666',
        '22222222-2222-4222-8222-222222222222',
        'creator@example.com',
        'pushed',
        'hubspot-contact-1',
        CURRENT_TIMESTAMP
      );

      INSERT INTO dropdown_values (id, field_key, value, updated_at)
      VALUES (
        '88888888-8888-4888-8888-888888888888',
        'activation_type',
        'Organic',
        CURRENT_TIMESTAMP
      );
    `);

    const v2Sql = await readFile(
      path.join(migrationsDir, v2MigrationName, "migration.sql"),
      "utf8",
    );
    await migrated.query(v2Sql);
    const collaborationSql = await readFile(
      path.join(migrationsDir, collaborationMigrationName, "migration.sql"),
      "utf8",
    );
    await migrated.query(collaborationSql);
  }, 120_000);

  afterAll(async () => {
    await migrated?.end().catch(() => undefined);
    if (admin && temporaryDatabaseName) {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [temporaryDatabaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${temporaryDatabaseName}"`);
    }
    await admin?.end().catch(() => undefined);
  });

  it("preserves pre-V2 import, push, and dropdown history", async () => {
    const importBatch = await migrated.query<{
      status: string;
      delivery_mode: string;
      total_row_count: number;
      prepared_row_count: number;
      csv_content: string;
    }>(`
      SELECT status::text, delivery_mode::text, total_row_count, prepared_row_count, csv_content
      FROM hubspot_import_batches
      WHERE id = '44444444-4444-4444-8444-444444444444'
    `);
    expect(importBatch.rows[0]).toEqual({
      status: "completed",
      delivery_mode: "csv_fallback",
      total_row_count: 1,
      prepared_row_count: 1,
      csv_content: "Email\\ncreator@example.com",
    });

    const importRow = await migrated.query<{ status: string; contact_email: string }>(`
      SELECT status::text, contact_email
      FROM hubspot_import_batch_rows
      WHERE id = '55555555-5555-4555-8555-555555555555'
    `);
    expect(importRow.rows[0]).toEqual({
      status: "prepared",
      contact_email: "creator@example.com",
    });

    const pushRow = await migrated.query<{ status: string; hubspot_object_id: string }>(`
      SELECT status::text, hubspot_object_id
      FROM hubspot_push_batch_rows
      WHERE id = '77777777-7777-4777-8777-777777777777'
    `);
    expect(pushRow.rows[0]).toEqual({
      status: "pushed",
      hubspot_object_id: "hubspot-contact-1",
    });

    const dropdown = await migrated.query<{
      value: string;
      label: string;
      internal_value: string;
    }>(`
      SELECT value, label, internal_value
      FROM dropdown_values
      WHERE id = '88888888-8888-4888-8888-888888888888'
    `);
    expect(dropdown.rows[0]).toEqual({
      value: "Organic",
      label: "Organic",
      internal_value: "Organic",
    });
  });

  it("creates durable health-check execution state without runtime DDL", async () => {
    const columns = await migrated.query<{
      column_name: string;
      is_nullable: string;
    }>(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hubspot_health_check_runs'
        AND column_name IN (
          'status',
          'queued_at',
          'started_at',
          'completed_at',
          'last_error',
          'lease_owner',
          'lease_expires_at'
        )
      ORDER BY column_name
    `);

    expect(columns.rows).toEqual([
      { column_name: "completed_at", is_nullable: "YES" },
      { column_name: "last_error", is_nullable: "YES" },
      { column_name: "lease_expires_at", is_nullable: "YES" },
      { column_name: "lease_owner", is_nullable: "YES" },
      { column_name: "queued_at", is_nullable: "NO" },
      { column_name: "started_at", is_nullable: "YES" },
      { column_name: "status", is_nullable: "NO" },
    ]);
  });

  it("adds collaboration mirrors without changing legacy import data", async () => {
    const tables = await migrated.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'hubspot_deal_mirrors',
          'hubspot_activation_mirrors',
          'hubspot_contact_deal_associations',
          'hubspot_deal_client_associations',
          'hubspot_deal_campaign_associations',
          'hubspot_deal_activation_associations'
        )
      ORDER BY table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "hubspot_activation_mirrors",
      "hubspot_contact_deal_associations",
      "hubspot_deal_activation_associations",
      "hubspot_deal_campaign_associations",
      "hubspot_deal_client_associations",
      "hubspot_deal_mirrors",
    ]);

    const counters = await migrated.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'hubspot_object_sync_runs'
        AND column_name IN ('deal_mirror_upsert_count', 'activation_mirror_upsert_count')
      ORDER BY column_name
    `);
    expect(counters.rows.map((row) => row.column_name)).toEqual([
      "activation_mirror_upsert_count",
      "deal_mirror_upsert_count",
    ]);

    const legacyBatch = await migrated.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM hubspot_import_batches
      WHERE id = '44444444-4444-4444-8444-444444444444'
    `);
    expect(legacyBatch.rows[0]?.count).toBe("1");
  });
});
