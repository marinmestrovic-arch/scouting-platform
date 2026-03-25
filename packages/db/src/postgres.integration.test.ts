import process from "node:process";

import { PrismaClient } from "@prisma/client";
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
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

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
  });
}
