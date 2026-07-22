import process from "node:process";

import { createPrismaClient } from "./index";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim();

if (!databaseUrl) {
  describe.skip("postgres integration", () => {
    it("requires DATABASE_URL_TEST", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("postgres integration", () => {
    const prisma = createPrismaClient({ databaseUrl });

    beforeAll(async () => {
      await prisma.$connect();
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("runs a simple SQL roundtrip query", async () => {
      const rows = await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.value).toBe(1);
    });

    it("sees pgboss tables after migrations are applied", async () => {
      const rows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('pgboss.version')::text AS relation_name
      `;

      expect(rows[0]?.relation_name).toBe("pgboss.version");
    });

    it("sees week 1 tables after migrations are applied", async () => {
      const rows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('users')::text AS relation_name
      `;

      expect(rows[0]?.relation_name).toBe("users");
    });

    it("sees week 2 saved_segments table after migrations are applied", async () => {
      const rows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('saved_segments')::text AS relation_name
      `;

      expect(rows[0]?.relation_name).toBe("saved_segments");
    });

    it("sees week 3 run tables after migrations are applied", async () => {
      const requestRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('run_requests')::text AS relation_name
      `;
      const resultRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('run_results')::text AS relation_name
      `;

      expect(requestRows[0]?.relation_name).toBe("run_requests");
      expect(resultRows[0]?.relation_name).toBe("run_results");
    });

    it("sees week 5 advanced report and insights tables after migrations are applied", async () => {
      const requestRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('advanced_report_requests')::text AS relation_name
      `;
      const insightRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('channel_insights')::text AS relation_name
      `;
      const payloadRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('channel_provider_payloads')::text AS relation_name
      `;

      expect(requestRows[0]?.relation_name).toBe("advanced_report_requests");
      expect(insightRows[0]?.relation_name).toBe("channel_insights");
      expect(payloadRows[0]?.relation_name).toBe("channel_provider_payloads");
    });

    it("sees week 5 csv import tables after migrations are applied", async () => {
      const batchRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('csv_import_batches')::text AS relation_name
      `;
      const rowRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('csv_import_rows')::text AS relation_name
      `;
      const contactRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('channel_contacts')::text AS relation_name
      `;
      const metricRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('channel_metrics')::text AS relation_name
      `;

      expect(batchRows[0]?.relation_name).toBe("csv_import_batches");
      expect(rowRows[0]?.relation_name).toBe("csv_import_rows");
      expect(contactRows[0]?.relation_name).toBe("channel_contacts");
      expect(metricRows[0]?.relation_name).toBe("channel_metrics");
    });

    it("sees week 6 hubspot push tables after migrations are applied", async () => {
      const batchRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('hubspot_push_batches')::text AS relation_name
      `;
      const rowRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('hubspot_push_batch_rows')::text AS relation_name
      `;

      expect(batchRows[0]?.relation_name).toBe("hubspot_push_batches");
      expect(rowRows[0]?.relation_name).toBe("hubspot_push_batch_rows");
    });

    it("sees week 7 hubspot import tables and user type enum after migrations are applied", async () => {
      const batchRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('hubspot_import_batches')::text AS relation_name
      `;
      const rowRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('hubspot_import_batch_rows')::text AS relation_name
      `;
      const enumRows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'user_type'
        ) AS exists
      `;

      expect(batchRows[0]?.relation_name).toBe("hubspot_import_batches");
      expect(rowRows[0]?.relation_name).toBe("hubspot_import_batch_rows");
      expect(enumRows[0]?.exists).toBe(true);
    });

    it("sees provider spend hardening tables after migrations are applied", async () => {
      const cacheRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('youtube_discovery_cache')::text AS relation_name
      `;
      const enrichmentColumns = await prisma.$queryRaw<
        Array<{
          raw_openai_payload_fetched_at: string | null;
          youtube_fetched_at: string | null;
          structured_profile: string | null;
        }>
      >`
        SELECT
          MAX(CASE WHEN column_name = 'raw_openai_payload_fetched_at' THEN column_name END) AS raw_openai_payload_fetched_at,
          MAX(CASE WHEN column_name = 'youtube_fetched_at' THEN column_name END) AS youtube_fetched_at,
          MAX(CASE WHEN column_name = 'structured_profile' THEN column_name END) AS structured_profile
        FROM information_schema.columns
        WHERE table_name = 'channel_enrichments'
      `;
      const requestColumns = await prisma.$queryRaw<
        Array<{
          provider_fetched_at: string | null;
          last_provider_attempt_at: string | null;
          next_provider_attempt_at: string | null;
        }>
      >`
        SELECT
          MAX(CASE WHEN column_name = 'provider_fetched_at' THEN column_name END) AS provider_fetched_at,
          MAX(CASE WHEN column_name = 'last_provider_attempt_at' THEN column_name END) AS last_provider_attempt_at,
          MAX(CASE WHEN column_name = 'next_provider_attempt_at' THEN column_name END) AS next_provider_attempt_at
        FROM information_schema.columns
        WHERE table_name = 'advanced_report_requests'
      `;

      expect(cacheRows[0]?.relation_name).toBe("youtube_discovery_cache");
      expect(enrichmentColumns[0]?.raw_openai_payload_fetched_at).toBe(
        "raw_openai_payload_fetched_at",
      );
      expect(enrichmentColumns[0]?.youtube_fetched_at).toBe("youtube_fetched_at");
      expect(enrichmentColumns[0]?.structured_profile).toBe("structured_profile");
      expect(requestColumns[0]?.provider_fetched_at).toBe("provider_fetched_at");
      expect(requestColumns[0]?.last_provider_attempt_at).toBe("last_provider_attempt_at");
      expect(requestColumns[0]?.next_provider_attempt_at).toBe("next_provider_attempt_at");
    });

    it("sees catalog capacity indexes after migrations are applied", async () => {
      const indexRows = await prisma.$queryRaw<Array<{ indexname: string | null }>>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'channels'
          AND indexname IN (
            'channels_created_at_id_idx',
            'channels_title_trgm_idx',
            'channels_handle_trgm_idx',
            'channels_youtube_channel_id_trgm_idx'
          )
        ORDER BY indexname ASC
      `;

      expect(indexRows.map((row) => row.indexname)).toEqual([
        "channels_created_at_id_idx",
        "channels_handle_trgm_idx",
        "channels_title_trgm_idx",
        "channels_youtube_channel_id_trgm_idx",
      ]);
    });

    it("sees hubspot object sync tables and metadata columns after migrations are applied", async () => {
      const syncRunRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('hubspot_object_sync_runs')::text AS relation_name
      `;
      const metadataColumns = await prisma.$queryRaw<
        Array<{
          client_hubspot_object_id: string | null;
          client_is_active: string | null;
          campaign_hubspot_object_id: string | null;
        }>
      >`
        SELECT
          MAX(CASE WHEN table_name = 'clients' AND column_name = 'hubspot_object_id' THEN column_name END) AS client_hubspot_object_id,
          MAX(CASE WHEN table_name = 'clients' AND column_name = 'is_active' THEN column_name END) AS client_is_active,
          MAX(CASE WHEN table_name = 'campaigns' AND column_name = 'hubspot_object_id' THEN column_name END) AS campaign_hubspot_object_id
        FROM information_schema.columns
        WHERE table_name IN ('clients', 'campaigns')
      `;

      expect(syncRunRows[0]?.relation_name).toBe("hubspot_object_sync_runs");
      expect(metadataColumns[0]?.client_hubspot_object_id).toBe("hubspot_object_id");
      expect(metadataColumns[0]?.client_is_active).toBe("is_active");
      expect(metadataColumns[0]?.campaign_hubspot_object_id).toBe("hubspot_object_id");
    });

    it("sees hubspot integration v2 portal, identity, reference, and workflow tables", async () => {
      const relationRows = await prisma.$queryRaw<Array<{ relation_name: string }>>`
        SELECT table_name AS relation_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'hubspot_portals',
            'hubspot_health_check_runs',
            'hubspot_contact_links',
            'hubspot_deal_links',
            'hubspot_owners',
            'hubspot_pipelines',
            'hubspot_pipeline_stages',
            'hubspot_association_definitions',
            'hubspot_webhook_events',
            'hubspot_sync_cursors',
            'hubspot_conflicts'
          )
        ORDER BY table_name ASC
      `;
      const importColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'hubspot_import_batches'
          AND column_name IN (
            'delivery_mode',
            'external_job_id',
            'external_status',
            'hubspot_portal_id',
            'idempotency_key',
            'preparation_hash',
            'provider_correlation_id',
            'submitted_at'
          )
        ORDER BY column_name ASC
      `;

      expect(relationRows.map((row) => row.relation_name)).toEqual([
        "hubspot_association_definitions",
        "hubspot_conflicts",
        "hubspot_contact_links",
        "hubspot_deal_links",
        "hubspot_health_check_runs",
        "hubspot_owners",
        "hubspot_pipeline_stages",
        "hubspot_pipelines",
        "hubspot_portals",
        "hubspot_sync_cursors",
        "hubspot_webhook_events",
      ]);
      expect(importColumns.map((row) => row.column_name)).toEqual([
        "delivery_mode",
        "external_job_id",
        "external_status",
        "hubspot_portal_id",
        "idempotency_key",
        "preparation_hash",
        "provider_correlation_id",
        "submitted_at",
      ]);
    });
  });
}
