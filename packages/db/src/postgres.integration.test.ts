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
        SELECT to_regclass('pgboss.version') AS relation_name
      `;

      expect(rows[0]?.relation_name).toBe("pgboss.version");
    });

    it("sees week 1 tables after migrations are applied", async () => {
      const rows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('users') AS relation_name
      `;

      expect(rows[0]?.relation_name).toBe("users");
    });

    it("sees week 2 saved_segments table after migrations are applied", async () => {
      const rows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('saved_segments') AS relation_name
      `;

      expect(rows[0]?.relation_name).toBe("saved_segments");
    });

    it("sees week 3 run tables after migrations are applied", async () => {
      const requestRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('run_requests') AS relation_name
      `;
      const resultRows = await prisma.$queryRaw<Array<{ relation_name: string | null }>>`
        SELECT to_regclass('run_results') AS relation_name
      `;

      expect(requestRows[0]?.relation_name).toBe("run_requests");
      expect(resultRows[0]?.relation_name).toBe("run_results");
    });
  });
}
