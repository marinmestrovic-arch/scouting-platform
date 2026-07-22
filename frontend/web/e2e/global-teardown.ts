import fs from "node:fs/promises";

import { disconnectPrisma, prisma, withDbTransaction } from "@scouting-platform/db";

import { E2E_ADMIN, E2E_MANAGER, PLAYWRIGHT_SEED_PATH } from "./test-data";
import { assertSelectedTestDatabaseConfiguration } from "./test-db-guard";

export default async function globalTeardown(): Promise<void> {
  assertSelectedTestDatabaseConfiguration();
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: [E2E_ADMIN.email, E2E_MANAGER.email],
      },
    },
    select: {
      id: true,
      email: true,
    },
  });

  const adminId = users.find((user) => user.email === E2E_ADMIN.email)?.id ?? null;
  const managerId = users.find((user) => user.email === E2E_MANAGER.email)?.id ?? null;

  await withDbTransaction(async (tx) => {
    if (managerId) {
      await tx.hubspotConflict.deleteMany({
        where: {
          runRequest: {
            requestedByUserId: managerId,
          },
        },
      });
      await tx.hubspotDealLink.deleteMany({
        where: {
          runRequest: {
            requestedByUserId: managerId,
          },
        },
      });
      await tx.hubspotImportBatch.deleteMany({
        where: {
          requestedByUserId: managerId,
        },
      });
      await tx.hubspotPushBatch.deleteMany({
        where: {
          requestedByUserId: managerId,
        },
      });
      await tx.csvExportBatch.deleteMany({
        where: {
          requestedByUserId: managerId,
        },
      });
      await tx.advancedReportRequest.deleteMany({
        where: {
          requestedByUserId: managerId,
        },
      });
      await tx.channelEnrichment.deleteMany({
        where: {
          requestedByUserId: managerId,
        },
      });
      await tx.runRequest.deleteMany({
        where: {
          requestedByUserId: managerId,
        },
      });
    }

    if (adminId) {
      await tx.csvImportBatch.deleteMany({
        where: {
          requestedByUserId: adminId,
        },
      });
    }
  });

  await fs.rm(PLAYWRIGHT_SEED_PATH, { force: true });
  await disconnectPrisma();
}
