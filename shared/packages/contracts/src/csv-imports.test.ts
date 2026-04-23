import { describe, expect, it } from "vitest";

import {
  CSV_IMPORT_HEADER,
  CSV_IMPORT_FILE_SIZE_LIMIT_BYTES,
  CSV_IMPORT_LEGACY_V3_HEADER,
  CSV_IMPORT_LEGACY_V2_HEADER,
  CSV_IMPORT_MAX_DATA_ROWS,
  CSV_IMPORT_TEMPLATE_VERSION,
  csvImportBatchDetailSchema,
  csvImportBatchSummarySchema,
  csvImportUploadFileSchema,
  getCsvImportBatchDetailQuerySchema,
} from "./index";

const TEST_UUID = "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b";

describe("csv import contracts", () => {
  it("exports the v3 template metadata used by backend and UI", () => {
    expect(CSV_IMPORT_TEMPLATE_VERSION).toBe("v3");
    expect(CSV_IMPORT_MAX_DATA_ROWS).toBe(10_000);
    expect(CSV_IMPORT_HEADER).toEqual([
      "Channel Name",
      "Channel URL",
      "Email",
      "Phone Number",
      "First Name",
      "Last Name",
      "Influencer Type",
      "Influencer Vertical",
      "Country/Region",
      "Language",
      "YouTube Handle",
      "YouTube URL",
      "YouTube Video Median Views",
      "YouTube Shorts Median Views",
      "YouTube Engagement Rate",
      "YouTube Followers",
      "Instagram Handle",
      "Instagram URL",
      "Instagram Post Average Views",
      "Instagram Reel Average Views",
      "Instagram Story 7-day Average Views",
      "Instagram Story 30-day Average Views",
      "Instagram Engagement Rate",
      "Instagram Followers",
      "TikTok Handle",
      "TikTok URL",
      "TikTok Average Views",
      "TikTok Engagement Rate",
      "TikTok Followers",
      "Twitch Handle",
      "Twitch URL",
      "Twitch Average Views",
      "Twitch Engagement Rate",
      "Twitch Followers",
      "Kick Handle",
      "Kick URL",
      "Kick Average Views",
      "Kick Engagement Rate",
      "Kick Followers",
      "X Handle",
      "X URL",
      "X Average Views",
      "X Engagement Rate",
      "X Followers",
    ]);
    expect(CSV_IMPORT_LEGACY_V3_HEADER).toContain("Campaign Name");
    expect(CSV_IMPORT_LEGACY_V3_HEADER).toContain("Deal stage");
    expect(CSV_IMPORT_LEGACY_V2_HEADER).toEqual([
      "youtubeChannelId",
      "channelTitle",
      "contactEmail",
      "firstName",
      "lastName",
      "subscriberCount",
      "viewCount",
      "videoCount",
      "notes",
      "sourceLabel",
      "influencerType",
      "influencerVertical",
      "countryRegion",
      "language",
    ]);
  });

  it("parses valid csv upload metadata", () => {
    const payload = csvImportUploadFileSchema.parse({
      fileName: "contacts.CSV",
      fileSize: 1024,
      mimeType: "text/csv",
    });

    expect(payload.fileName).toBe("contacts.CSV");
    expect(payload.fileSize).toBe(1024);
    expect(payload.mimeType).toBe("text/csv");
  });

  it("accepts blank or legacy browser csv mime types", () => {
    const blankMime = csvImportUploadFileSchema.parse({
      fileName: "contacts.csv",
      fileSize: 32,
      mimeType: "",
    });
    const applicationCsvMime = csvImportUploadFileSchema.parse({
      fileName: "contacts.csv",
      fileSize: 32,
      mimeType: "application/csv",
    });
    const legacyMime = csvImportUploadFileSchema.parse({
      fileName: "contacts.csv",
      fileSize: 32,
      mimeType: "application/vnd.ms-excel",
    });

    expect(blankMime.mimeType).toBe("");
    expect(applicationCsvMime.mimeType).toBe("application/csv");
    expect(legacyMime.mimeType).toBe("application/vnd.ms-excel");
  });

  it("rejects invalid csv upload metadata", () => {
    expect(
      csvImportUploadFileSchema.safeParse({
        fileName: "   ",
        fileSize: 1024,
        mimeType: "text/csv",
      }).success,
    ).toBe(false);
    expect(
      csvImportUploadFileSchema.safeParse({
        fileName: "contacts.txt",
        fileSize: 1024,
        mimeType: "text/csv",
      }).success,
    ).toBe(false);
    expect(
      csvImportUploadFileSchema.safeParse({
        fileName: "contacts.csv",
        fileSize: 0,
        mimeType: "text/csv",
      }).success,
    ).toBe(false);
    expect(
      csvImportUploadFileSchema.safeParse({
        fileName: "contacts.csv",
        fileSize: CSV_IMPORT_FILE_SIZE_LIMIT_BYTES + 1,
        mimeType: "text/csv",
      }).success,
    ).toBe(false);
    expect(
      csvImportUploadFileSchema.safeParse({
        fileName: "contacts.csv",
        fileSize: 1024,
        mimeType: "application/json",
      }).success,
    ).toBe(false);
  });

  it("parses a batch summary payload", () => {
    const payload = csvImportBatchSummarySchema.parse({
      id: TEST_UUID,
      fileName: "contacts.csv",
      templateVersion: "v3",
      status: "queued",
      totalRowCount: 2,
      importedRowCount: 0,
      failedRowCount: 1,
      lastError: null,
      requestedBy: {
        id: TEST_UUID,
        email: "admin@example.com",
        name: "Admin",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    });

    expect(payload.status).toBe("queued");
    expect(payload.requestedBy.email).toBe("admin@example.com");
  });

  it("parses detail query defaults", () => {
    const payload = getCsvImportBatchDetailQuerySchema.parse({});

    expect(payload).toEqual({
      page: 1,
      pageSize: 100,
    });
  });

  it("parses a batch detail payload with rows", () => {
    const payload = csvImportBatchDetailSchema.parse({
      id: TEST_UUID,
      fileName: "contacts.csv",
      templateVersion: "v3",
      status: "completed",
      totalRowCount: 2,
      importedRowCount: 1,
      failedRowCount: 1,
      lastError: null,
      requestedBy: {
        id: TEST_UUID,
        email: "admin@example.com",
        name: "Admin",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      page: 1,
      pageSize: 100,
      rows: [
        {
          id: TEST_UUID,
          rowNumber: 1,
          status: "imported",
          youtubeChannelId: "UC-CSV-1",
          channelTitle: "Imported Channel",
          hubspotRecordId: null,
          timestampImported: null,
          channelUrl: "https://www.youtube.com/channel/UC-CSV-1",
          campaignName: "Spring Campaign",
          dealOwner: "Owner",
          handoffStatus: "Ready",
          contactEmail: "creator@example.com",
          phoneNumber: "+385 111 222",
          currency: "EUR",
          dealType: "Paid",
          contactType: "Influencer",
          month: "April",
          year: "2026",
          clientName: "Client A",
          dealName: "Creator - Spring Campaign",
          activationName: "Creator - Spring Campaign",
          pipeline: "Sales Pipeline",
          dealStage: "Scouted",
          firstName: "Jane",
          lastName: "Creator",
          youtubeHandle: "@creator",
          youtubeUrl: "https://www.youtube.com/@creator",
          subscriberCount: "1000",
          viewCount: null,
          videoCount: null,
          youtubeVideoMedianViews: "90000",
          youtubeShortsMedianViews: "50000",
          youtubeEngagementRate: "2.5",
          youtubeFollowers: "1000",
          instagramHandle: "@creator_ig",
          instagramUrl: "https://www.instagram.com/creator_ig",
          instagramPostAverageViews: "12000",
          instagramReelAverageViews: "18000",
          instagramStory7DayAverageViews: "9000",
          instagramStory30DayAverageViews: "7500",
          instagramEngagementRate: "4.1",
          instagramFollowers: "240000",
          tiktokHandle: "@creator_tt",
          tiktokUrl: "https://www.tiktok.com/@creator_tt",
          tiktokAverageViews: "55000",
          tiktokEngagementRate: "6.3",
          tiktokFollowers: "310000",
          twitchHandle: "creator_live",
          twitchUrl: "https://www.twitch.tv/creator_live",
          twitchAverageViews: "4200",
          twitchEngagementRate: "2.6",
          twitchFollowers: "98000",
          kickHandle: "creatorkick",
          kickUrl: "https://kick.com/creatorkick",
          kickAverageViews: "3200",
          kickEngagementRate: "2.1",
          kickFollowers: "41000",
          xHandle: "@creatorx",
          xUrl: "https://x.com/creatorx",
          xAverageViews: "44000",
          xEngagementRate: "1.8",
          xFollowers: "125000",
          notes: null,
          sourceLabel: null,
          influencerType: "Male",
          influencerVertical: "Gaming",
          countryRegion: "Croatia",
          language: "Croatian",
          channelId: TEST_UUID,
          errorMessage: null,
        },
      ],
    });

    expect(payload.rows[0]?.status).toBe("imported");
    expect(payload.rows[0]?.youtubeFollowers).toBe("1000");
  });

  it("parses failed detail rows with raw invalid values preserved", () => {
    const payload = csvImportBatchDetailSchema.parse({
      id: TEST_UUID,
      fileName: "contacts.csv",
      templateVersion: "v3",
      status: "completed",
      totalRowCount: 2,
      importedRowCount: 1,
      failedRowCount: 1,
      lastError: null,
      requestedBy: {
        id: TEST_UUID,
        email: "admin@example.com",
        name: "Admin",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      page: 1,
      pageSize: 100,
      rows: [
        {
          id: TEST_UUID,
          rowNumber: 2,
          status: "failed",
          youtubeChannelId: "",
          channelTitle: "",
          hubspotRecordId: null,
          timestampImported: null,
          channelUrl: "",
          campaignName: null,
          dealOwner: null,
          handoffStatus: null,
          contactEmail: "not-an-email",
          phoneNumber: null,
          currency: null,
          dealType: null,
          contactType: null,
          month: null,
          year: null,
          clientName: null,
          dealName: null,
          activationName: null,
          pipeline: null,
          dealStage: null,
          firstName: null,
          lastName: null,
          youtubeHandle: "@bad",
          youtubeUrl: "invalid-url",
          subscriberCount: "10x",
          viewCount: null,
          videoCount: null,
          youtubeVideoMedianViews: "not-a-number",
          youtubeShortsMedianViews: null,
          youtubeEngagementRate: "not-a-rate",
          youtubeFollowers: "10x",
          instagramHandle: null,
          instagramUrl: null,
          instagramPostAverageViews: null,
          instagramReelAverageViews: null,
          instagramStory7DayAverageViews: null,
          instagramStory30DayAverageViews: null,
          instagramEngagementRate: null,
          instagramFollowers: null,
          tiktokHandle: null,
          tiktokUrl: null,
          tiktokAverageViews: null,
          tiktokEngagementRate: null,
          tiktokFollowers: null,
          twitchHandle: null,
          twitchUrl: null,
          twitchAverageViews: null,
          twitchEngagementRate: null,
          twitchFollowers: null,
          kickHandle: null,
          kickUrl: null,
          kickAverageViews: null,
          kickEngagementRate: null,
          kickFollowers: null,
          xHandle: null,
          xUrl: null,
          xAverageViews: null,
          xEngagementRate: null,
          xFollowers: null,
          notes: null,
          sourceLabel: null,
          influencerType: "Unknown Type",
          influencerVertical: "Unknown Vertical",
          countryRegion: "Unknown Country",
          language: "Unknown Language",
          channelId: null,
          errorMessage:
            "Channel Name is required; Email is invalid; YouTube Followers is invalid",
        },
      ],
    });

    expect(payload.rows[0]?.status).toBe("failed");
    expect(payload.rows[0]?.youtubeChannelId).toBe("");
    expect(payload.rows[0]?.contactEmail).toBe("not-an-email");
    expect(payload.rows[0]?.youtubeFollowers).toBe("10x");
  });
});
