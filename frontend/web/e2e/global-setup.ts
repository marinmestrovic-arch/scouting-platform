import fs from "node:fs/promises";
import path from "node:path";

import {
  CsvExportBatchStatus,
  CsvExportScopeType,
  HubspotImportBatchRowStatus,
  HubspotImportBatchStatus,
  HubspotPushBatchRowStatus,
  HubspotPushBatchStatus,
  Prisma,
  Role,
  RunMonth,
  RunRequestStatus,
  RunResultSource,
  UserType,
} from "@prisma/client";
import {
  HUBSPOT_IMPORT_HEADER,
  HUBSPOT_IMPORT_SCHEMA_VERSION,
} from "@scouting-platform/contracts";
import { CSV_EXPORT_HEADER, setUserYoutubeApiKey } from "@scouting-platform/core";
import { disconnectPrisma, prisma, withDbTransaction } from "@scouting-platform/db";

import { hashPassword } from "../../../backend/packages/core/src/auth/password";
import {
  E2E_ADMIN,
  E2E_CAMPAIGN,
  E2E_CATALOG_CHANNEL,
  E2E_CLIENT,
  E2E_MANAGER,
  E2E_MARKET,
  E2E_RUN,
  E2E_SEEDED_CSV_IMPORT_FILE_NAME,
  E2E_SEEDED_EXPORT_FILE_NAME,
  E2E_SEEDED_HUBSPOT_IMPORT_FILE_NAME,
  E2E_SEEDED_PUSH_ERROR,
  PLAYWRIGHT_SEED_PATH,
  type PlaywrightSeedData,
} from "./test-data";
import { assertSelectedTestDatabaseConfiguration } from "./test-db-guard";
import { ensurePlaywrightEnvironment } from "./test-env";

function buildSeededExportCsv(channelId: string): string {
  const row = {
    channelId,
    youtubeChannelId: E2E_CATALOG_CHANNEL.youtubeChannelId,
    youtubeChannelUrl: `https://www.youtube.com/channel/${E2E_CATALOG_CHANNEL.youtubeChannelId}`,
    title: E2E_CATALOG_CHANNEL.title,
    handle: E2E_CATALOG_CHANNEL.handle,
    contactEmails: E2E_CATALOG_CHANNEL.contactEmail,
    subscriberCount: "120000",
    viewCount: "7800000",
    videoCount: "215",
    enrichmentStatus: "missing",
    enrichmentSummary: "",
    enrichmentTopics: "",
    brandFitNotes: "",
    advancedReportStatus: "missing",
    advancedReportCompletedAt: "",
  } satisfies Record<(typeof CSV_EXPORT_HEADER)[number], string>;

  const escapeCell = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replaceAll(`"`, `""`)}"` : value;

  return [
    CSV_EXPORT_HEADER.join(","),
    CSV_EXPORT_HEADER.map((column) => escapeCell(row[column as keyof typeof row])).join(","),
  ].join("\n");
}

function buildSeededHubspotRowPayload(channelTitle: string): Record<string, unknown> {
  return {
    channelTitle,
    csv: Object.fromEntries(
      HUBSPOT_IMPORT_HEADER.map((column) => [column, `${column}-value`]),
    ),
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function upsertUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
  userType: UserType;
}): Promise<{ id: string; email: string }> {
  const passwordHash = await hashPassword(input.password);

  return prisma.user.upsert({
    where: {
      email: input.email,
    },
    create: {
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      userType: input.userType,
      isActive: true,
    },
    update: {
      name: input.name,
      passwordHash,
      role: input.role,
      userType: input.userType,
      isActive: true,
    },
    select: {
      id: true,
      email: true,
    },
  });
}

async function writeSeedDataFile(seedData: PlaywrightSeedData): Promise<void> {
  await fs.mkdir(path.dirname(PLAYWRIGHT_SEED_PATH), { recursive: true });
  await fs.writeFile(PLAYWRIGHT_SEED_PATH, JSON.stringify(seedData, null, 2), "utf8");
}

export default async function globalSetup(): Promise<void> {
  assertSelectedTestDatabaseConfiguration();
  ensurePlaywrightEnvironment();

  const [admin, manager] = await Promise.all([
    upsertUser({
      email: E2E_ADMIN.email,
      name: E2E_ADMIN.name,
      password: E2E_ADMIN.password,
      role: Role.ADMIN,
      userType: UserType.ADMIN,
    }),
    upsertUser({
      email: E2E_MANAGER.email,
      name: E2E_MANAGER.name,
      password: E2E_MANAGER.password,
      role: Role.USER,
      userType: UserType.CAMPAIGN_MANAGER,
    }),
  ]);

  await setUserYoutubeApiKey({
    userId: manager.id,
    rawKey: E2E_MANAGER.youtubeApiKey,
    actorUserId: admin.id,
  });

  const seedData = await withDbTransaction(async (tx) => {
    await tx.hubspotConflict.deleteMany({
      where: {
        runRequest: {
          requestedByUserId: manager.id,
        },
      },
    });
    await tx.hubspotDealLink.deleteMany({
      where: {
        runRequest: {
          requestedByUserId: manager.id,
        },
      },
    });
    await tx.hubspotImportBatch.deleteMany({
      where: {
        requestedByUserId: manager.id,
      },
    });
    await tx.hubspotPushBatch.deleteMany({
      where: {
        requestedByUserId: manager.id,
      },
    });
    await tx.csvExportBatch.deleteMany({
      where: {
        requestedByUserId: manager.id,
      },
    });
    await tx.csvImportBatch.deleteMany({
      where: {
        requestedByUserId: admin.id,
      },
    });
    await tx.channelEnrichment.deleteMany({
      where: {
        requestedByUserId: manager.id,
      },
    });
    await tx.runRequest.deleteMany({
      where: {
        requestedByUserId: manager.id,
      },
    });
    await tx.dropdownValue.deleteMany({
      where: {
        fieldKey: {
          in: [
            "CURRENCY",
            "DEAL_TYPE",
            "ACTIVATION_TYPE",
            "INFLUENCER_TYPE",
            "INFLUENCER_VERTICAL",
            "COUNTRY_REGION",
            "LANGUAGE",
          ],
        },
      },
    });
    await tx.dropdownValue.createMany({
      data: [
        { fieldKey: "CURRENCY", value: "EUR" },
        { fieldKey: "DEAL_TYPE", value: "Flat Fee" },
        { fieldKey: "ACTIVATION_TYPE", value: "Organic" },
        { fieldKey: "INFLUENCER_TYPE", value: "Male" },
        { fieldKey: "INFLUENCER_VERTICAL", value: "Gaming" },
        { fieldKey: "COUNTRY_REGION", value: "Croatia" },
        { fieldKey: "LANGUAGE", value: "Croatian" },
      ],
      skipDuplicates: true,
    });

    const client = await tx.client.upsert({
      where: {
        name: E2E_CLIENT.name,
      },
      create: E2E_CLIENT,
      update: E2E_CLIENT,
      select: {
        id: true,
      },
    });

    const market = await tx.market.upsert({
      where: {
        name: E2E_MARKET.name,
      },
      create: E2E_MARKET,
      update: E2E_MARKET,
      select: {
        id: true,
      },
    });

    const campaignMonth = RunMonth[E2E_CAMPAIGN.month];

    const campaign = await tx.campaign.upsert({
      where: {
        name_clientId_marketId_month_year: {
          name: E2E_CAMPAIGN.name,
          clientId: client.id,
          marketId: market.id,
          month: campaignMonth,
          year: E2E_CAMPAIGN.year,
        },
      },
      create: {
        name: E2E_CAMPAIGN.name,
        clientId: client.id,
        marketId: market.id,
        briefLink: E2E_CAMPAIGN.briefLink,
        month: campaignMonth,
        year: E2E_CAMPAIGN.year,
        status: "In progress",
        isActive: true,
        createdByUserId: admin.id,
      },
      update: {
        briefLink: E2E_CAMPAIGN.briefLink,
        status: "In progress",
        isActive: true,
        createdByUserId: admin.id,
      },
      select: {
        id: true,
        name: true,
      },
    });

    const catalogChannel = await tx.channel.upsert({
      where: {
        youtubeChannelId: E2E_CATALOG_CHANNEL.youtubeChannelId,
      },
      create: {
        youtubeChannelId: E2E_CATALOG_CHANNEL.youtubeChannelId,
        title: E2E_CATALOG_CHANNEL.title,
        handle: E2E_CATALOG_CHANNEL.handle,
        description: E2E_CATALOG_CHANNEL.description,
        thumbnailUrl: E2E_CATALOG_CHANNEL.thumbnailUrl,
        countryRegion: E2E_CATALOG_CHANNEL.countryRegion,
        influencerVertical: E2E_CATALOG_CHANNEL.influencerVertical,
        influencerType: E2E_CATALOG_CHANNEL.influencerType,
        contentLanguage: E2E_CATALOG_CHANNEL.language,
      },
      update: {
        title: E2E_CATALOG_CHANNEL.title,
        handle: E2E_CATALOG_CHANNEL.handle,
        description: E2E_CATALOG_CHANNEL.description,
        thumbnailUrl: E2E_CATALOG_CHANNEL.thumbnailUrl,
        countryRegion: E2E_CATALOG_CHANNEL.countryRegion,
        influencerVertical: E2E_CATALOG_CHANNEL.influencerVertical,
        influencerType: E2E_CATALOG_CHANNEL.influencerType,
        contentLanguage: E2E_CATALOG_CHANNEL.language,
      },
      select: {
        id: true,
        title: true,
      },
    });

    const catalogContact = await tx.channelContact.upsert({
      where: {
        channelId_email: {
          channelId: catalogChannel.id,
          email: E2E_CATALOG_CHANNEL.contactEmail,
        },
      },
      create: {
        channelId: catalogChannel.id,
        email: E2E_CATALOG_CHANNEL.contactEmail,
        firstName: "Week",
        lastName: "Eight",
      },
      update: {
        firstName: "Week",
        lastName: "Eight",
      },
      select: { id: true },
    });

    const collaborationPortal = await tx.hubspotPortal.upsert({
      where: { portalId: "147403025" },
      create: { portalId: "147403025", displayName: "Playwright HubSpot portal" },
      update: { displayName: "Playwright HubSpot portal" },
    });
    await Promise.all([
      tx.client.update({
        where: { id: client.id },
        data: {
          hubspotPortalId: collaborationPortal.id,
          hubspotObjectType: "2-198744797",
          hubspotObjectId: "e2e-client-1",
        },
      }),
      tx.campaign.update({
        where: { id: campaign.id },
        data: {
          hubspotPortalId: collaborationPortal.id,
          hubspotObjectType: "2-196889646",
          hubspotObjectId: "e2e-campaign-1",
        },
      }),
    ]);
    const contactLink = await tx.hubspotContactLink.upsert({
      where: {
        hubspotPortalId_channelContactId: {
          hubspotPortalId: collaborationPortal.id,
          channelContactId: catalogContact.id,
        },
      },
      create: {
        hubspotPortalId: collaborationPortal.id,
        channelContactId: catalogContact.id,
        hubspotObjectId: "e2e-contact-1",
        externalKey: `contact:${catalogContact.id}`,
        mirrorProperties: { worked_with: "true" },
      },
      update: {
        archived: false,
        mirrorProperties: { worked_with: "true" },
      },
    });
    const dealMirror = await tx.hubspotDealMirror.upsert({
      where: {
        hubspotPortalId_hubspotObjectId: {
          hubspotPortalId: collaborationPortal.id,
          hubspotObjectId: "e2e-deal-1",
        },
      },
      create: {
        hubspotPortalId: collaborationPortal.id,
        hubspotObjectId: "e2e-deal-1",
        dealName: "Week 8 E2E Creator Collaboration",
        amount: "1500",
        currencyCode: "EUR",
        pipelineId: "e2e-campaign-management",
        stageId: "e2e-contract-signed",
        ownerId: "e2e-owner-1",
        closeDate: new Date("2026-03-31T00:00:00.000Z"),
        hubspotCreatedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      update: { archived: false },
    });
    const activationMirror = await tx.hubspotActivationMirror.upsert({
      where: {
        hubspotPortalId_hubspotObjectId: {
          hubspotPortalId: collaborationPortal.id,
          hubspotObjectId: "e2e-activation-1",
        },
      },
      create: {
        hubspotPortalId: collaborationPortal.id,
        hubspotObjectId: "e2e-activation-1",
        name: "Week 8 YouTube Integration",
        activationType: "YouTube",
        activationUrl: "https://youtube.com/watch?v=week8-e2e",
        publicationDate: new Date("2026-03-20T00:00:00.000Z"),
      },
      update: { archived: false },
    });
    const pipeline = await tx.hubspotPipeline.upsert({
      where: {
        hubspotPortalId_objectType_hubspotPipelineId: {
          hubspotPortalId: collaborationPortal.id,
          objectType: "deals",
          hubspotPipelineId: "e2e-campaign-management",
        },
      },
      create: {
        hubspotPortalId: collaborationPortal.id,
        objectType: "deals",
        hubspotPipelineId: "e2e-campaign-management",
        label: "Campaign Management Pipeline",
        syncedAt: new Date(),
      },
      update: { archived: false, syncedAt: new Date() },
    });
    await Promise.all([
      tx.hubspotOwner.upsert({
        where: {
          hubspotPortalId_hubspotOwnerId: {
            hubspotPortalId: collaborationPortal.id,
            hubspotOwnerId: "e2e-owner-1",
          },
        },
        create: {
          hubspotPortalId: collaborationPortal.id,
          hubspotOwnerId: "e2e-owner-1",
          displayName: "Week 8 Deal Owner",
          syncedAt: new Date(),
        },
        update: { displayName: "Week 8 Deal Owner", archived: false, syncedAt: new Date() },
      }),
      tx.hubspotPipelineStage.upsert({
        where: {
          pipelineId_hubspotStageId: {
            pipelineId: pipeline.id,
            hubspotStageId: "e2e-contract-signed",
          },
        },
        create: {
          pipelineId: pipeline.id,
          hubspotStageId: "e2e-contract-signed",
          label: "Contract signed",
          syncedAt: new Date(),
        },
        update: { label: "Contract signed", archived: false, syncedAt: new Date() },
      }),
      tx.hubspotContactDealAssociation.upsert({
        where: {
          hubspotContactLinkId_hubspotDealMirrorId: {
            hubspotContactLinkId: contactLink.id,
            hubspotDealMirrorId: dealMirror.id,
          },
        },
        create: {
          hubspotContactLinkId: contactLink.id,
          hubspotDealMirrorId: dealMirror.id,
          observedAt: new Date(),
        },
        update: { observedAt: new Date() },
      }),
      tx.hubspotDealClientAssociation.upsert({
        where: {
          hubspotDealMirrorId_clientId: { hubspotDealMirrorId: dealMirror.id, clientId: client.id },
        },
        create: { hubspotDealMirrorId: dealMirror.id, clientId: client.id, observedAt: new Date() },
        update: { observedAt: new Date() },
      }),
      tx.hubspotDealCampaignAssociation.upsert({
        where: {
          hubspotDealMirrorId_campaignId: { hubspotDealMirrorId: dealMirror.id, campaignId: campaign.id },
        },
        create: { hubspotDealMirrorId: dealMirror.id, campaignId: campaign.id, observedAt: new Date() },
        update: { observedAt: new Date() },
      }),
      tx.hubspotDealActivationAssociation.upsert({
        where: {
          hubspotDealMirrorId_hubspotActivationMirrorId: {
            hubspotDealMirrorId: dealMirror.id,
            hubspotActivationMirrorId: activationMirror.id,
          },
        },
        create: {
          hubspotDealMirrorId: dealMirror.id,
          hubspotActivationMirrorId: activationMirror.id,
          observedAt: new Date(),
        },
        update: { observedAt: new Date() },
      }),
    ]);

    await tx.channelMetric.upsert({
      where: {
        channelId: catalogChannel.id,
      },
      create: {
        channelId: catalogChannel.id,
        subscriberCount: BigInt(E2E_CATALOG_CHANNEL.youtubeFollowers),
        viewCount: BigInt(7_800_000),
        videoCount: BigInt(215),
        youtubeEngagementRate: 0.041,
        youtubeFollowers: BigInt(E2E_CATALOG_CHANNEL.youtubeFollowers),
        youtubeVideoMedianViews: BigInt(E2E_CATALOG_CHANNEL.youtubeVideoMedianViews),
        youtubeShortsMedianViews: BigInt(E2E_CATALOG_CHANNEL.youtubeShortsMedianViews),
      },
      update: {
        subscriberCount: BigInt(E2E_CATALOG_CHANNEL.youtubeFollowers),
        viewCount: BigInt(7_800_000),
        videoCount: BigInt(215),
        youtubeEngagementRate: 0.041,
        youtubeFollowers: BigInt(E2E_CATALOG_CHANNEL.youtubeFollowers),
        youtubeVideoMedianViews: BigInt(E2E_CATALOG_CHANNEL.youtubeVideoMedianViews),
        youtubeShortsMedianViews: BigInt(E2E_CATALOG_CHANNEL.youtubeShortsMedianViews),
      },
    });

    const seededRun = await tx.runRequest.create({
      data: {
        requestedByUserId: manager.id,
        name: E2E_RUN.name,
        query: E2E_RUN.query,
        target: 12,
        campaignId: campaign.id,
        client: E2E_CLIENT.name,
        market: E2E_MARKET.name,
        campaignManagerUserId: manager.id,
        briefLink: E2E_CAMPAIGN.briefLink,
        campaignName: campaign.name,
        month: campaignMonth,
        year: E2E_CAMPAIGN.year,
        dealOwner: E2E_MANAGER.name,
        dealName: campaign.name,
        pipeline: "Sales Pipeline",
        dealStage: "Scouted",
        currency: "EUR",
        dealType: "Flat Fee",
        activationType: "Organic",
        status: RunRequestStatus.COMPLETED,
        startedAt: new Date("2026-03-28T08:00:00.000Z"),
        completedAt: new Date("2026-03-28T08:05:00.000Z"),
      },
      select: {
        id: true,
      },
    });

    await tx.runResult.create({
      data: {
        runRequestId: seededRun.id,
        channelId: catalogChannel.id,
        rank: 1,
        source: RunResultSource.CATALOG,
      },
    });
    const seededCsvImportBatch = await tx.csvImportBatch.create({
      data: {
        requestedByUserId: admin.id,
        fileName: E2E_SEEDED_CSV_IMPORT_FILE_NAME,
        templateVersion: "v2",
        status: "COMPLETED",
        totalRowCount: 2,
        importedRowCount: 1,
        failedRowCount: 1,
        startedAt: new Date("2026-03-28T08:00:00.000Z"),
        completedAt: new Date("2026-03-28T08:01:00.000Z"),
      },
      select: {
        id: true,
      },
    });

    await tx.csvImportRow.createMany({
      data: [
        {
          batchId: seededCsvImportBatch.id,
          rowNumber: 1,
          status: "IMPORTED",
          youtubeChannelId: E2E_CATALOG_CHANNEL.youtubeChannelId,
          channelTitle: E2E_CATALOG_CHANNEL.title,
          contactEmail: E2E_CATALOG_CHANNEL.contactEmail,
          firstName: "Week",
          lastName: "Eight",
          subscriberCount: "120000",
          viewCount: "7800000",
          videoCount: "215",
          sourceLabel: "Playwright",
        },
        {
          batchId: seededCsvImportBatch.id,
          rowNumber: 2,
          status: "FAILED",
          youtubeChannelId: "UCweek8e2ecsvfailure00003",
          channelTitle: "Week 8 Seeded Failed CSV Channel",
          contactEmail: "not-an-email",
          firstName: "Failed",
          lastName: "Row",
          subscriberCount: "500",
          viewCount: "1500",
          videoCount: "12",
          sourceLabel: "Playwright",
          errorMessage: "contactEmail is invalid",
        },
      ],
    });

    await tx.csvExportBatch.create({
      data: {
        requestedByUserId: manager.id,
        scopeType: CsvExportScopeType.FILTERED,
        scopePayload: {
          filters: {
            query: E2E_CATALOG_CHANNEL.title,
          },
        },
        schemaVersion: "v1",
        fileName: E2E_SEEDED_EXPORT_FILE_NAME,
        status: CsvExportBatchStatus.COMPLETED,
        rowCount: 1,
        csvContent: buildSeededExportCsv(catalogChannel.id),
        startedAt: new Date("2026-03-28T09:00:00.000Z"),
        completedAt: new Date("2026-03-28T09:01:00.000Z"),
      },
    });

    const seededImportBatch = await tx.hubspotImportBatch.create({
      data: {
        requestedByUserId: manager.id,
        runRequestId: seededRun.id,
        fileName: E2E_SEEDED_HUBSPOT_IMPORT_FILE_NAME,
        schemaVersion: HUBSPOT_IMPORT_SCHEMA_VERSION,
        status: HubspotImportBatchStatus.COMPLETED,
        totalRowCount: 1,
        preparedRowCount: 1,
        failedRowCount: 0,
        csvContent: "email,creator_title\ncreator@week8-e2e.example.com,Week 8 E2E Main Channel\n",
        startedAt: new Date("2026-03-28T09:30:00.000Z"),
        completedAt: new Date("2026-03-28T09:31:00.000Z"),
      },
      select: {
        id: true,
      },
    });

    await tx.hubspotImportBatchRow.create({
      data: {
        batchId: seededImportBatch.id,
        channelId: catalogChannel.id,
        contactEmail: E2E_CATALOG_CHANNEL.contactEmail,
        firstName: "Week",
        lastName: "Eight",
        payload: toJsonValue(buildSeededHubspotRowPayload(E2E_CATALOG_CHANNEL.title)),
        status: HubspotImportBatchRowStatus.PREPARED,
      },
    });

    const seededPushBatch = await tx.hubspotPushBatch.create({
      data: {
        requestedByUserId: manager.id,
        scopePayload: {
          channelIds: [catalogChannel.id],
        },
        status: HubspotPushBatchStatus.COMPLETED,
        totalRowCount: 1,
        pushedRowCount: 0,
        failedRowCount: 1,
        startedAt: new Date("2026-03-28T10:00:00.000Z"),
        completedAt: new Date("2026-03-28T10:01:00.000Z"),
        lastError: E2E_SEEDED_PUSH_ERROR,
      },
      select: {
        id: true,
      },
    });

    await tx.hubspotPushBatchRow.create({
      data: {
        batchId: seededPushBatch.id,
        channelId: catalogChannel.id,
        contactEmail: E2E_CATALOG_CHANNEL.contactEmail,
        status: HubspotPushBatchRowStatus.FAILED,
        errorMessage: E2E_SEEDED_PUSH_ERROR,
      },
    });

    return {
      admin: {
        id: admin.id,
        email: admin.email,
        password: E2E_ADMIN.password,
      },
      manager: {
        id: manager.id,
        email: manager.email,
        password: E2E_MANAGER.password,
      },
      campaign: {
        id: campaign.id,
        name: campaign.name,
      },
      run: {
        id: seededRun.id,
        name: E2E_RUN.name,
      },
      channels: {
        catalog: {
          id: catalogChannel.id,
          title: catalogChannel.title,
          countryRegion: E2E_CATALOG_CHANNEL.countryRegion,
          influencerVertical: E2E_CATALOG_CHANNEL.influencerVertical,
          influencerType: E2E_CATALOG_CHANNEL.influencerType,
          youtubeVideoMedianViews: E2E_CATALOG_CHANNEL.youtubeVideoMedianViews,
        },
      },
      batches: {
        csvImportFileName: E2E_SEEDED_CSV_IMPORT_FILE_NAME,
        csvExportFileName: E2E_SEEDED_EXPORT_FILE_NAME,
        hubspotImportFileName: E2E_SEEDED_HUBSPOT_IMPORT_FILE_NAME,
        hubspotRunName: E2E_RUN.name,
      },
    } satisfies PlaywrightSeedData;
  });

  await writeSeedDataFile(seedData);
  await disconnectPrisma();
}
