import { DropdownValueFieldKey } from "@prisma/client";

import { disconnectPrisma, prisma } from "../backend/packages/db/src";

async function main() {
  const includeCatalog = process.argv.includes("--include-catalog");
  const clearCatalogDropdowns =
    includeCatalog || process.argv.includes("--clear-catalog-dropdowns");

  try {
    await prisma.hubspotPreviewEnrichmentJob.deleteMany();
    await prisma.hubspotImportBatchRow.deleteMany();
    await prisma.hubspotImportBatch.deleteMany();
    await prisma.hubspotPushBatchRow.deleteMany();
    await prisma.hubspotPushBatch.deleteMany();
    await prisma.csvExportBatch.deleteMany();
    await prisma.csvImportRow.deleteMany();
    await prisma.csvImportBatch.deleteMany();
    await prisma.runChannelAssessment.deleteMany();
    await prisma.runHubspotRowOverride.deleteMany();
    await prisma.runResult.deleteMany();
    await prisma.runRequest.deleteMany();
    await prisma.youtubeDiscoveryCache.deleteMany();

    if (includeCatalog) {
      await prisma.advancedReportRequest.deleteMany();
      await prisma.channelContact.deleteMany();
      await prisma.channelMetric.deleteMany();
      await prisma.channelEnrichment.deleteMany();
      await prisma.channelInsight.deleteMany();
      await prisma.channelProviderPayload.deleteMany();
      await prisma.channelManualOverride.deleteMany();
      await prisma.channelYoutubeContext.deleteMany();
      await prisma.channel.deleteMany();
    }

    if (clearCatalogDropdowns) {
      await prisma.dropdownValue.deleteMany({
        where: {
          OR: [
            {
              fieldKey: DropdownValueFieldKey.INFLUENCER_TYPE,
              value: "YouTube Creator",
            },
            {
              fieldKey: DropdownValueFieldKey.DEAL_TYPE,
            },
          ],
        },
      });
    }

    process.stdout.write(
      includeCatalog
        ? "Reset demo data including catalog channels and targeted dropdown values.\n"
        : clearCatalogDropdowns
          ? "Reset demo run/export data and targeted dropdown values.\n"
          : "Reset demo run/export data.\n",
    );
  } finally {
    await disconnectPrisma();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
