import { disconnectPrisma, prisma } from "../packages/db/src";

async function main() {
  const includeCatalog = process.argv.includes("--include-catalog");

  try {
    await prisma.hubspotImportBatchRow.deleteMany();
    await prisma.hubspotImportBatch.deleteMany();
    await prisma.hubspotPushBatchRow.deleteMany();
    await prisma.hubspotPushBatch.deleteMany();
    await prisma.csvExportBatch.deleteMany();
    await prisma.runResult.deleteMany();
    await prisma.runRequest.deleteMany();

    if (includeCatalog) {
      await prisma.channelContact.deleteMany();
      await prisma.channelMetric.deleteMany();
      await prisma.channelEnrichment.deleteMany();
      await prisma.channelInsight.deleteMany();
      await prisma.channelProviderPayload.deleteMany();
      await prisma.channelManualOverride.deleteMany();
      await prisma.advancedReportRequest.deleteMany();
      await prisma.channelYoutubeContext.deleteMany();
      await prisma.channel.deleteMany();
    }

    process.stdout.write(
      includeCatalog
        ? "Reset demo data including catalog channels.\n"
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
