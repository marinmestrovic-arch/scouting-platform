import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  copyGoogleSheetRowFormatMock,
  ensureGoogleSheetRowCapacityMock,
  extractGoogleSpreadsheetIdMock,
  getGoogleSheetPropertiesMock,
  getGoogleSheetsAccessTokenMock,
  getHubspotExportPreviewMock,
  readGoogleSheetsHeaderRowMock,
  readGoogleSheetsRowsMock,
  writeGoogleSheetsRowsMock,
} = vi.hoisted(() => ({
  copyGoogleSheetRowFormatMock: vi.fn(),
  ensureGoogleSheetRowCapacityMock: vi.fn(),
  extractGoogleSpreadsheetIdMock: vi.fn(),
  getGoogleSheetPropertiesMock: vi.fn(),
  getGoogleSheetsAccessTokenMock: vi.fn(),
  getHubspotExportPreviewMock: vi.fn(),
  readGoogleSheetsHeaderRowMock: vi.fn(),
  readGoogleSheetsRowsMock: vi.fn(),
  writeGoogleSheetsRowsMock: vi.fn(),
}));

vi.mock("./export-previews", () => ({
  getHubspotExportPreview: getHubspotExportPreviewMock,
}));

vi.mock("@scouting-platform/integrations", () => ({
  copyGoogleSheetRowFormat: copyGoogleSheetRowFormatMock,
  ensureGoogleSheetRowCapacity: ensureGoogleSheetRowCapacityMock,
  extractGoogleSpreadsheetId: extractGoogleSpreadsheetIdMock,
  getGoogleSheetProperties: getGoogleSheetPropertiesMock,
  getGoogleSheetsAccessToken: getGoogleSheetsAccessTokenMock,
  isGoogleSheetsError: () => false,
  readGoogleSheetsHeaderRow: readGoogleSheetsHeaderRowMock,
  readGoogleSheetsRows: readGoogleSheetsRowsMock,
  writeGoogleSheetsRows: writeGoogleSheetsRowsMock,
}));

import { ServiceError } from "./errors";
import {
  alignHubspotPreviewRowsToGoogleSheetsHeader,
  exportHubspotRunToGoogleSheets,
  findFirstEmptyGoogleSheetsRow,
} from "./google-sheets-export";

describe("google sheets export core service", () => {
  beforeEach(() => {
    copyGoogleSheetRowFormatMock.mockReset();
    ensureGoogleSheetRowCapacityMock.mockReset();
    extractGoogleSpreadsheetIdMock.mockReset();
    getGoogleSheetPropertiesMock.mockReset();
    getGoogleSheetsAccessTokenMock.mockReset();
    getHubspotExportPreviewMock.mockReset();
    readGoogleSheetsHeaderRowMock.mockReset();
    readGoogleSheetsRowsMock.mockReset();
    writeGoogleSheetsRowsMock.mockReset();

    extractGoogleSpreadsheetIdMock.mockReturnValue("spreadsheet-1");
    getGoogleSheetsAccessTokenMock.mockResolvedValue("google-token");
    getGoogleSheetPropertiesMock.mockResolvedValue({
      sheetId: 12345,
      title: "Scouting Export",
      rowCount: 1000,
      columnCount: 30,
    });
    readGoogleSheetsRowsMock.mockResolvedValue([["Contacting"]]);
    writeGoogleSheetsRowsMock.mockResolvedValue({
      updatedRange: "'Scouting Export'!A4:D5",
      updatedRows: 2,
    });
    getHubspotExportPreviewMock.mockResolvedValue({
      run: {
        id: "run-1",
        name: "Run 1",
        campaignName: "Spring Campaign",
      },
      columns: [],
      requiredColumnKeys: [],
      defaults: {},
      dropdownOptions: {},
      validationIssues: [],
      rows: [
        {
          id: "row-1",
          rowKey: "row-1",
          channelId: "11111111-1111-4111-8111-111111111111",
          channelTitle: "Creator One",
          values: {
            campaignName: "Spring Campaign",
            dealOwner: "Ivan",
            email: "creator1@example.com",
            currency: "EUR",
            dealType: "Paid",
            contactType: "Influencer",
            month: "april",
            year: "2026",
            clientName: "Client A",
            dealName: "Creator One - Spring Campaign",
            pipeline: "Main",
            dealStage: "Qualified",
            firstName: "Creator",
            lastName: "One",
            influencerType: "YouTube Creator",
            influencerVertical: "Gaming",
            countryRegion: "Croatia",
            language: "English",
            youtubeHandle: "@creatorone",
            youtubeUrl: "https://youtube.com/@creatorone",
            youtubeEngagementRate: "3.4",
            youtubeFollowers: "150000",
          },
        },
        {
          id: "row-2",
          rowKey: "row-2",
          channelId: "22222222-2222-4222-8222-222222222222",
          channelTitle: "Creator Two",
          values: {
            campaignName: "Spring Campaign",
            dealOwner: "Ivan",
            email: "creator2@example.com",
            currency: "EUR",
            dealType: "Paid",
            contactType: "Influencer",
            month: "april",
            year: "2026",
            clientName: "Client A",
            dealName: "Creator Two - Spring Campaign",
            pipeline: "Main",
            dealStage: "Qualified",
            firstName: "Creator",
            lastName: "Two",
            influencerType: "YouTube Creator",
            influencerVertical: "Gaming",
            countryRegion: "Croatia",
            language: "English",
            youtubeHandle: "@creatortwo",
            youtubeUrl: "https://youtube.com/@creatortwo",
            youtubeEngagementRate: "4.1",
            youtubeFollowers: "95000",
          },
        },
      ],
    });
  });

  it("aligns prepared rows to the target header row and leaves unsupported values blank", () => {
    const result = alignHubspotPreviewRowsToGoogleSheetsHeader({
      headerRow: [
        " Channel Name ",
        "HubSpot Record ID",
        "YouTube URL",
        "YouTube Video Median Views",
        "Unknown Column",
      ],
      rows: [
        {
          id: "row-1",
          rowKey: "row-1",
          channelId: "11111111-1111-4111-8111-111111111111",
          channelTitle: "Creator One",
          values: {
            youtubeUrl: "https://youtube.com/@creatorone",
          },
        },
      ],
    });

    expect(result.matchedHeaders).toEqual([
      " Channel Name ",
      "HubSpot Record ID",
      "YouTube URL",
      "YouTube Video Median Views",
    ]);
    expect(result.unmatchedHeaders).toEqual(["Unknown Column"]);
    expect(result.values).toEqual([
      ["Creator One", "", "https://youtube.com/@creatorone", "", ""],
    ]);
  });

  it("finds the first fully empty sheet row at or after the configured start row", () => {
    expect(
      findFirstEmptyGoogleSheetsRow({
        startRowNumber: 3,
        columnCount: 3,
        rows: [
          ["Contacting", "", ""],
          ["", "", ""],
          ["Existing", "", ""],
        ],
      }),
    ).toBe(4);
    expect(
      findFirstEmptyGoogleSheetsRow({
        startRowNumber: 3,
        columnCount: 3,
        rows: [
          ["Contacting", "", ""],
          ["Existing", "", ""],
        ],
      }),
    ).toBe(5);
  });

  it("exports HubSpot-prepared rows to Google Sheets using the sheet header order", async () => {
    readGoogleSheetsHeaderRowMock.mockResolvedValue([
      "Channel Name",
      "HubSpot Record ID",
      "Timestamp Imported",
      "Channel URL",
      "Campaign Name",
      "Deal owner",
      "Email",
      "Currency",
      "Deal Type",
      "Contact Type",
      "Month",
      "Year",
      "Client name",
      "Deal name",
      "Pipeline",
      "Deal stage",
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
    ]);

    const result = await exportHubspotRunToGoogleSheets({
      runId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      role: "user",
      request: {
        spreadsheetIdOrUrl: "https://docs.google.com/spreadsheets/d/spreadsheet-1/edit",
        sheetName: "Scouting Export",
      },
    });

    expect(getHubspotExportPreviewMock).toHaveBeenCalledWith({
      runId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      role: "user",
    });
    expect(readGoogleSheetsRowsMock).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      accessToken: "google-token",
      startRowNumber: 3,
      columnCount: 28,
    });
    expect(ensureGoogleSheetRowCapacityMock).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-1",
      sheetId: 12345,
      currentRowCount: 1000,
      requiredRowCount: 5,
      accessToken: "google-token",
    });
    expect(copyGoogleSheetRowFormatMock).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-1",
      sheetId: 12345,
      sourceRowNumber: 4,
      targetStartRowNumber: 5,
      rowCount: 1,
      columnCount: 30,
      accessToken: "google-token",
    });
    expect(writeGoogleSheetsRowsMock).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      accessToken: "google-token",
      startRowNumber: 4,
      rows: [
        [
          "Creator One",
          "",
          "",
          "https://youtube.com/@creatorone",
          "Spring Campaign",
          "Ivan",
          "creator1@example.com",
          "EUR",
          "Paid",
          "Influencer",
          "april",
          "2026",
          "Client A",
          "Creator One - Spring Campaign",
          "Main",
          "Qualified",
          "Creator",
          "One",
          "YouTube Creator",
          "Gaming",
          "Croatia",
          "English",
          "@creatorone",
          "https://youtube.com/@creatorone",
          "",
          "",
          "3.4",
          "150000",
        ],
        [
          "Creator Two",
          "",
          "",
          "https://youtube.com/@creatortwo",
          "Spring Campaign",
          "Ivan",
          "creator2@example.com",
          "EUR",
          "Paid",
          "Influencer",
          "april",
          "2026",
          "Client A",
          "Creator Two - Spring Campaign",
          "Main",
          "Qualified",
          "Creator",
          "Two",
          "YouTube Creator",
          "Gaming",
          "Croatia",
          "English",
          "@creatortwo",
          "https://youtube.com/@creatortwo",
          "",
          "",
          "4.1",
          "95000",
        ],
      ],
    });
    expect(result).toEqual({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      appendedRowCount: 2,
      matchedHeaderCount: 28,
      matchedHeaders: [
        "Channel Name",
        "HubSpot Record ID",
        "Timestamp Imported",
        "Channel URL",
        "Campaign Name",
        "Deal owner",
        "Email",
        "Currency",
        "Deal Type",
        "Contact Type",
        "Month",
        "Year",
        "Client name",
        "Deal name",
        "Pipeline",
        "Deal stage",
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
      ],
      unmatchedHeaders: [],
    });
  });

  it("returns a validation error for invalid spreadsheet inputs", async () => {
    extractGoogleSpreadsheetIdMock.mockReturnValue(null);

    await expect(
      exportHubspotRunToGoogleSheets({
        runId: "11111111-1111-4111-8111-111111111111",
        userId: "user-1",
        role: "user",
        request: {
          spreadsheetIdOrUrl: "not-a-sheet",
          sheetName: "Scouting Export",
        },
      }),
    ).rejects.toMatchObject({
      code: "GOOGLE_SHEETS_SPREADSHEET_INVALID",
      status: 400,
    } satisfies Partial<ServiceError>);
  });
});
