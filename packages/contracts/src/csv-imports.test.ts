import { describe, expect, it } from "vitest";

import {
  CSV_IMPORT_HEADER,
  CSV_IMPORT_FILE_SIZE_LIMIT_BYTES,
  CSV_IMPORT_MAX_DATA_ROWS,
  CSV_IMPORT_TEMPLATE_VERSION,
  csvImportBatchDetailSchema,
  csvImportBatchSummarySchema,
  csvImportUploadFileSchema,
  getCsvImportBatchDetailQuerySchema,
} from "./index";

const TEST_UUID = "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b";

describe("csv import contracts", () => {
  it("exports the strict-template metadata used by backend and UI", () => {
    expect(CSV_IMPORT_TEMPLATE_VERSION).toBe("v1");
    expect(CSV_IMPORT_MAX_DATA_ROWS).toBe(10_000);
    expect(CSV_IMPORT_HEADER).toEqual([
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
      templateVersion: "v1",
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
      templateVersion: "v1",
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
          contactEmail: "creator@example.com",
          firstName: "Creator",
          lastName: "Name",
          subscriberCount: "1000",
          viewCount: "20000",
          videoCount: "50",
          notes: "Imported from ops sheet",
          sourceLabel: "ops-list",
          channelId: TEST_UUID,
          errorMessage: null,
        },
      ],
    });

    expect(payload.rows[0]?.status).toBe("imported");
    expect(payload.rows[0]?.subscriberCount).toBe("1000");
  });

  it("parses failed detail rows with raw invalid values preserved", () => {
    const payload = csvImportBatchDetailSchema.parse({
      id: TEST_UUID,
      fileName: "contacts.csv",
      templateVersion: "v1",
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
          contactEmail: "not-an-email",
          firstName: null,
          lastName: null,
          subscriberCount: "10x",
          viewCount: null,
          videoCount: "",
          notes: "Missing required fields",
          sourceLabel: "ops-list",
          channelId: null,
          errorMessage:
            "youtubeChannelId is required; channelTitle is required; contactEmail is invalid; subscriberCount is invalid",
        },
      ],
    });

    expect(payload.rows[0]?.status).toBe("failed");
    expect(payload.rows[0]?.youtubeChannelId).toBe("");
    expect(payload.rows[0]?.contactEmail).toBe("not-an-email");
    expect(payload.rows[0]?.subscriberCount).toBe("10x");
  });
});
