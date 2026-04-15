import type {
  ExportPreviewRow,
  ExportRunToGoogleSheetsResponse,
} from "@scouting-platform/contracts";
import {
  exportRunToGoogleSheetsRequestSchema,
  type ExportRunToGoogleSheetsRequest,
} from "@scouting-platform/contracts";
import {
  copyGoogleSheetRowFormat,
  ensureGoogleSheetRowCapacity,
  extractGoogleSpreadsheetId,
  getGoogleSheetProperties,
  getGoogleSheetsAccessToken,
  isGoogleSheetsError,
  readGoogleSheetsHeaderRow,
  readGoogleSheetsRows,
  writeGoogleSheetsRows,
} from "@scouting-platform/integrations";

import { getHubspotExportPreview } from "./export-previews";
import { ServiceError } from "./errors";

type HeaderValueResolver = (row: ExportPreviewRow) => string;

const GOOGLE_SHEETS_HEADER_RESOLVERS = new Map<string, HeaderValueResolver>([
  ["Channel Name", (row) => row.channelTitle],
  ["HubSpot Record ID", () => ""],
  ["Timestamp Imported", () => ""],
  ["Channel URL", (row) => row.values.youtubeUrl ?? ""],
  ["Campaign Name", (row) => row.values.campaignName ?? ""],
  ["Deal owner", (row) => row.values.dealOwner ?? ""],
  ["Status", () => ""],
  ["Email", (row) => row.values.email ?? ""],
  ["Phone Number", () => ""],
  ["Currency", (row) => row.values.currency ?? ""],
  ["Deal Type", (row) => row.values.dealType ?? ""],
  ["Contact Type", (row) => row.values.contactType ?? ""],
  ["Month", (row) => row.values.month ?? ""],
  ["Year", (row) => row.values.year ?? ""],
  ["Client name", (row) => row.values.clientName ?? ""],
  ["Deal name", (row) => row.values.dealName ?? ""],
  ["Pipeline", (row) => row.values.pipeline ?? ""],
  ["Deal stage", (row) => row.values.dealStage ?? ""],
  ["First Name", (row) => row.values.firstName ?? ""],
  ["Last Name", (row) => row.values.lastName ?? ""],
  ["Influencer Type", (row) => row.values.influencerType ?? ""],
  ["Influencer Vertical", (row) => row.values.influencerVertical ?? ""],
  ["Country/Region", (row) => row.values.countryRegion ?? ""],
  ["Language", (row) => row.values.language ?? ""],
  ["YouTube Handle", (row) => row.values.youtubeHandle ?? ""],
  ["YouTube URL", (row) => row.values.youtubeUrl ?? ""],
  ["YouTube Video Median Views", () => ""],
  ["YouTube Shorts Median Views", () => ""],
  ["YouTube Engagement Rate", (row) => row.values.youtubeEngagementRate ?? ""],
  ["YouTube Followers", (row) => row.values.youtubeFollowers ?? ""],
]);
const GOOGLE_SHEETS_EXPORT_MIN_START_ROW = 3;

export function normalizeGoogleSheetsHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function alignHubspotPreviewRowsToGoogleSheetsHeader(input: {
  headerRow: string[];
  rows: ExportPreviewRow[];
}): {
  matchedHeaders: string[];
  unmatchedHeaders: string[];
  values: string[][];
} {
  const resolverByHeader = new Map<string, HeaderValueResolver>();

  for (const [header, resolver] of GOOGLE_SHEETS_HEADER_RESOLVERS.entries()) {
    resolverByHeader.set(normalizeGoogleSheetsHeader(header), resolver);
  }

  const matchedHeaders: string[] = [];
  const unmatchedHeaders: string[] = [];

  for (const header of input.headerRow) {
    if (resolverByHeader.has(normalizeGoogleSheetsHeader(header))) {
      matchedHeaders.push(header);
    } else {
      unmatchedHeaders.push(header);
    }
  }

  return {
    matchedHeaders,
    unmatchedHeaders,
    values: input.rows.map((row) =>
      input.headerRow.map((header) => {
        const resolver = resolverByHeader.get(normalizeGoogleSheetsHeader(header));
        return resolver ? resolver(row) : "";
      }),
    ),
  };
}

function isEmptyGoogleSheetsRow(row: string[], columnCount: number): boolean {
  for (let index = 0; index < columnCount; index += 1) {
    if ((row[index] ?? "").trim().length > 0) {
      return false;
    }
  }

  return true;
}

export function findFirstEmptyGoogleSheetsRow(input: {
  rows: string[][];
  startRowNumber: number;
  columnCount: number;
}): number {
  const emptyRowIndex = input.rows.findIndex((row) =>
    isEmptyGoogleSheetsRow(row, input.columnCount),
  );

  if (emptyRowIndex !== -1) {
    return input.startRowNumber + emptyRowIndex;
  }

  return input.startRowNumber + input.rows.length;
}

export async function exportHubspotRunToGoogleSheets(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
  request: ExportRunToGoogleSheetsRequest;
}): Promise<ExportRunToGoogleSheetsResponse> {
  const parsedRequest = exportRunToGoogleSheetsRequestSchema.parse(input.request);
  const spreadsheetId = extractGoogleSpreadsheetId(parsedRequest.spreadsheetIdOrUrl);

  if (!spreadsheetId) {
    throw new ServiceError(
      "GOOGLE_SHEETS_SPREADSHEET_INVALID",
      400,
      "Enter a valid Google Sheets URL or spreadsheet id",
    );
  }

  const preview = await getHubspotExportPreview({
    runId: input.runId,
    userId: input.userId,
    role: input.role,
  });

  if (preview.rows.length === 0) {
    throw new ServiceError(
      "GOOGLE_SHEETS_EXPORT_EMPTY",
      400,
      "This run does not have any prepared creators to export",
    );
  }

  try {
    const accessToken = await getGoogleSheetsAccessToken();
    const headerRow = await readGoogleSheetsHeaderRow({
      spreadsheetId,
      sheetName: parsedRequest.sheetName,
      accessToken,
    });

    if (headerRow.length === 0) {
      throw new ServiceError(
        "GOOGLE_SHEETS_HEADER_MISSING",
        400,
        "The target sheet must have a header row in the first row",
      );
    }

    const alignedRows = alignHubspotPreviewRowsToGoogleSheetsHeader({
      headerRow,
      rows: preview.rows,
    });

    if (alignedRows.matchedHeaders.length === 0) {
      throw new ServiceError(
        "GOOGLE_SHEETS_HEADER_UNSUPPORTED",
        400,
        "The target sheet header row does not contain any supported export columns",
      );
    }

    const existingRows = await readGoogleSheetsRows({
      spreadsheetId,
      sheetName: parsedRequest.sheetName,
      accessToken,
      startRowNumber: GOOGLE_SHEETS_EXPORT_MIN_START_ROW,
      columnCount: headerRow.length,
    });
    const firstEmptyRowNumber = findFirstEmptyGoogleSheetsRow({
      rows: existingRows,
      startRowNumber: GOOGLE_SHEETS_EXPORT_MIN_START_ROW,
      columnCount: headerRow.length,
    });
    const sheetProperties = await getGoogleSheetProperties({
      spreadsheetId,
      sheetName: parsedRequest.sheetName,
      accessToken,
    });
    const requiredRowCount = firstEmptyRowNumber + alignedRows.values.length - 1;

    await ensureGoogleSheetRowCapacity({
      spreadsheetId,
      sheetId: sheetProperties.sheetId,
      currentRowCount: sheetProperties.rowCount,
      requiredRowCount,
      accessToken,
    });

    if (alignedRows.values.length > 1) {
      await copyGoogleSheetRowFormat({
        spreadsheetId,
        sheetId: sheetProperties.sheetId,
        sourceRowNumber: firstEmptyRowNumber,
        targetStartRowNumber: firstEmptyRowNumber + 1,
        rowCount: alignedRows.values.length - 1,
        columnCount: Math.max(headerRow.length, sheetProperties.columnCount ?? headerRow.length),
        accessToken,
      });
    }

    const writeResult = await writeGoogleSheetsRows({
      spreadsheetId,
      sheetName: parsedRequest.sheetName,
      accessToken,
      startRowNumber: firstEmptyRowNumber,
      rows: alignedRows.values,
    });

    return {
      spreadsheetId,
      sheetName: parsedRequest.sheetName,
      appendedRowCount: writeResult.updatedRows,
      matchedHeaderCount: alignedRows.matchedHeaders.length,
      matchedHeaders: alignedRows.matchedHeaders,
      unmatchedHeaders: alignedRows.unmatchedHeaders,
    };
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }

    if (isGoogleSheetsError(error)) {
      throw new ServiceError(error.code, error.status, error.message);
    }

    throw error;
  }
}
