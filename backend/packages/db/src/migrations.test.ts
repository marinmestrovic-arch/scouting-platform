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
const week4LlmEnrichmentFoundationMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260307100000_week4_llm_enrichment_foundation/migration.sql",
);
const week5CsvImportBackendMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260310103000_week5_csv_import_backend/migration.sql",
);
const week6HubspotPushBackendMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260311143000_week6_hubspot_push_backend/migration.sql",
);
const week7WorkspaceMetadataHubspotImportMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260316113000_week7_workspace_metadata_hubspot_import/migration.sql",
);
const campaignsWorkspaceRefreshMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260326120000_campaigns_workspace_refresh/migration.sql",
);
const clientMetadataFieldsMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260326143000_client_metadata_fields/migration.sql",
);
const week8LaunchReadinessIndexesMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260328113000_week8_launch_readiness_indexes/migration.sql",
);
const providerSpendHardeningColumnsMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260401120000_provider_spend_hardening_columns/migration.sql",
);
const youtubeDiscoveryCacheMigrationPath = path.resolve(
  currentDir,
  "../prisma/migrations/20260401130000_youtube_discovery_cache/migration.sql",
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

describe("week 4 llm enrichment foundation migration", () => {
  it("creates enrichment status enum, youtube context cache, and channel enrichment tables", () => {
    const migrationSql = readFileSync(week4LlmEnrichmentFoundationMigrationPath, "utf-8");

    expect(migrationSql).toContain("CREATE TYPE channel_enrichment_status AS ENUM");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS channel_youtube_contexts");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS channel_enrichments");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS channel_enrichments_status_idx");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS channel_youtube_contexts_fetched_at_idx");
  });
});

describe("week 5 csv import backend migration", () => {
  it("creates csv import enums, batches, rows, contacts, and metrics", () => {
    const migrationSql = readFileSync(week5CsvImportBackendMigrationPath, "utf-8");

    expect(migrationSql).toContain('CREATE TYPE "csv_import_batch_status" AS ENUM');
    expect(migrationSql).toContain('CREATE TYPE "csv_import_row_status" AS ENUM');
    expect(migrationSql).toContain('CREATE TABLE "csv_import_batches"');
    expect(migrationSql).toContain('CREATE TABLE "csv_import_rows"');
    expect(migrationSql).toContain('CREATE TABLE "channel_contacts"');
    expect(migrationSql).toContain('CREATE TABLE "channel_metrics"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "csv_import_rows_batch_id_row_number_key"');
    expect(migrationSql).toContain(
      'ALTER TABLE "csv_import_batches" ADD CONSTRAINT "csv_import_batches_requested_by_user_id_fkey"',
    );
  });
});

describe("week 6 hubspot push backend migration", () => {
  it("creates push batch and row lifecycle tables", () => {
    const migrationSql = readFileSync(week6HubspotPushBackendMigrationPath, "utf-8");

    expect(migrationSql).toContain('CREATE TYPE "hubspot_push_batch_status" AS ENUM');
    expect(migrationSql).toContain('CREATE TYPE "hubspot_push_batch_row_status" AS ENUM');
    expect(migrationSql).toContain('CREATE TABLE "hubspot_push_batches"');
    expect(migrationSql).toContain('CREATE TABLE "hubspot_push_batch_rows"');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "hubspot_push_batch_rows_batch_id_channel_id_key"',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "hubspot_push_batches" ADD CONSTRAINT "hubspot_push_batches_requested_by_user_id_fkey"',
    );
  });
});

describe("week 7 workspace metadata and hubspot import migration", () => {
  it("creates user type, run metadata, contact names, and hubspot import tables", () => {
    const migrationSql = readFileSync(week7WorkspaceMetadataHubspotImportMigrationPath, "utf-8");

    expect(migrationSql).toContain('CREATE TYPE "user_type" AS ENUM');
    expect(migrationSql).toContain('ALTER TABLE "users"');
    expect(migrationSql).toContain('"user_type" "user_type" NOT NULL DEFAULT \'campaign_manager\'');
    expect(migrationSql).toContain('ALTER TABLE "run_requests"');
    expect(migrationSql).toContain('"campaign_manager_user_id" UUID');
    expect(migrationSql).toContain('"campaign_name" TEXT');
    expect(migrationSql).toContain('"activation_type" TEXT');
    expect(migrationSql).toContain('ALTER TABLE "channel_contacts"');
    expect(migrationSql).toContain('"first_name" TEXT');
    expect(migrationSql).toContain('"last_name" TEXT');
    expect(migrationSql).toContain('ALTER TABLE "channel_metrics"');
    expect(migrationSql).toContain('"youtube_average_views" BIGINT');
    expect(migrationSql).toContain('"youtube_engagement_rate" DOUBLE PRECISION');
    expect(migrationSql).toContain('"youtube_followers" BIGINT');
    expect(migrationSql).toContain('CREATE TABLE "hubspot_import_batches"');
    expect(migrationSql).toContain('CREATE TABLE "hubspot_import_batch_rows"');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "hubspot_import_batch_rows_batch_id_channel_id_contact_email_key"',
    );
  });
});

describe("campaigns workspace refresh migration", () => {
  it("creates client, market, campaign tables and run campaign linkage", () => {
    const migrationSql = readFileSync(campaignsWorkspaceRefreshMigrationPath, "utf-8");

    expect(migrationSql).toContain('CREATE TABLE "clients"');
    expect(migrationSql).toContain('CREATE TABLE "markets"');
    expect(migrationSql).toContain('CREATE TABLE "campaigns"');
    expect(migrationSql).toContain('ALTER TABLE "run_requests"');
    expect(migrationSql).toContain('"campaign_id" UUID');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "clients_name_key"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "markets_name_key"');
    expect(migrationSql).toContain('CREATE INDEX "campaigns_is_active_idx"');
    expect(migrationSql).toContain('CREATE INDEX "run_requests_campaign_id_idx"');
    expect(migrationSql).toContain(
      'ALTER TABLE "run_requests"\nADD CONSTRAINT "run_requests_campaign_id_fkey"',
    );
  });
});

describe("client metadata fields migration", () => {
  it("adds domain, country region, and city to clients", () => {
    const migrationSql = readFileSync(clientMetadataFieldsMigrationPath, "utf-8");

    expect(migrationSql).toContain('ALTER TABLE "clients"');
    expect(migrationSql).toContain('"domain" TEXT');
    expect(migrationSql).toContain('"country_region" TEXT');
    expect(migrationSql).toContain('"city" TEXT');
  });
});

describe("provider spend hardening columns migration", () => {
  it("adds retry and fetched-at markers for report requests and enrichments", () => {
    const migrationSql = readFileSync(providerSpendHardeningColumnsMigrationPath, "utf-8");

    expect(migrationSql).toContain('ALTER TABLE "advanced_report_requests"');
    expect(migrationSql).toContain('"provider_fetched_at"');
    expect(migrationSql).toContain('"last_provider_attempt_at"');
    expect(migrationSql).toContain('"next_provider_attempt_at"');
    expect(migrationSql).toContain('ALTER TABLE "channel_enrichments"');
    expect(migrationSql).toContain('"raw_openai_payload_fetched_at"');
    expect(migrationSql).toContain('"youtube_fetched_at"');
  });
});

describe("youtube discovery cache migration", () => {
  it("creates the youtube discovery cache table, indexes, and user foreign key", () => {
    const migrationSql = readFileSync(youtubeDiscoveryCacheMigrationPath, "utf-8");

    expect(migrationSql).toContain('CREATE TABLE "youtube_discovery_cache"');
    expect(migrationSql).toContain('"cache_key"   TEXT         NOT NULL');
    expect(migrationSql).toContain('"payload"     JSONB        NOT NULL');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "youtube_discovery_cache_cache_key_key"',
    );
    expect(migrationSql).toContain('CREATE INDEX "youtube_discovery_cache_expires_at_idx"');
    expect(migrationSql).toContain(
      'ADD CONSTRAINT "youtube_discovery_cache_user_id_fkey"',
    );
  });
});

describe("week 8 launch readiness indexes migration", () => {
  it("adds composite indexes for operator queues and run history filters", () => {
    const migrationSql = readFileSync(week8LaunchReadinessIndexesMigrationPath, "utf-8");

    expect(migrationSql).toContain('CREATE INDEX "advanced_report_requests_status_created_at_idx"');
    expect(migrationSql).toContain('CREATE INDEX "csv_import_batches_status_created_at_idx"');
    expect(migrationSql).toContain(
      'CREATE INDEX "csv_export_batches_requested_by_user_id_created_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "hubspot_push_batches_requested_by_user_id_created_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "hubspot_import_batches_requested_by_user_id_created_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "run_requests_requested_by_user_id_created_at_idx"',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "run_requests_campaign_manager_user_id_created_at_idx"',
    );
    expect(migrationSql).toContain('CREATE INDEX "run_requests_client_created_at_idx"');
    expect(migrationSql).toContain('CREATE INDEX "run_requests_market_created_at_idx"');
  });
});
