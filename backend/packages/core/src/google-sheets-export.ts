import type {
  ExportPreviewColumn,
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
  ["Phone Number", (row) => row.values.phoneNumber ?? ""],
  ["Currency", (row) => row.values.currency ?? ""],
  ["Deal Type", (row) => row.values.dealType ?? ""],
  ["Contact Type", (row) => row.values.contactType ?? ""],
  ["Month", (row) => row.values.month ?? ""],
  ["Year", (row) => row.values.year ?? ""],
  ["Client name", (row) => row.values.clientName ?? ""],
  ["Deal name", (row) => row.values.dealName ?? ""],
  ["Activation Name", (row) => row.values.activationName ?? row.values.dealName ?? ""],
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
  ["YouTube Video Median Views", (row) => row.values.youtubeVideoMedianViews ?? ""],
  ["YouTube Shorts Median Views", (row) => row.values.youtubeShortsMedianViews ?? ""],
  ["YouTube Engagement Rate", (row) => row.values.youtubeEngagementRate ?? ""],
  ["YouTube Followers", (row) => row.values.youtubeFollowers ?? ""],
]);
const GOOGLE_SHEETS_EXPORT_MIN_START_ROW = 3;
const NORMALIZED_GOOGLE_SHEETS_HEADER_RESOLVERS = new Map<string, HeaderValueResolver>(
  [...GOOGLE_SHEETS_HEADER_RESOLVERS.entries()].map(([header, resolver]) => [
    normalizeGoogleSheetsHeader(header),
    resolver,
  ]),
);

type PreviewRowLookup = {
  byDealNameAndEmail: Map<string, ExportPreviewRow | null>;
  byEmailAndChannelNameAndCampaign: Map<string, ExportPreviewRow | null>;
  byEmailAndYoutubeUrlAndCampaign: Map<string, ExportPreviewRow | null>;
  byChannelNameAndCampaign: Map<string, ExportPreviewRow | null>;
  byYoutubeHandleAndCampaign: Map<string, ExportPreviewRow | null>;
  byYoutubeUrlAndCampaign: Map<string, ExportPreviewRow | null>;
};

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
  const matchedHeaders: string[] = [];
  const unmatchedHeaders: string[] = [];

  for (const header of input.headerRow) {
    if (NORMALIZED_GOOGLE_SHEETS_HEADER_RESOLVERS.has(normalizeGoogleSheetsHeader(header))) {
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
        const resolver = NORMALIZED_GOOGLE_SHEETS_HEADER_RESOLVERS.get(
          normalizeGoogleSheetsHeader(header),
        );
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

function normalizeLookupToken(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildPreviewLookupKey(values: Array<string | null | undefined>): string | null {
  const normalizedValues = values.map((value) => normalizeLookupToken(value));

  return normalizedValues.every((value) => value.length > 0)
    ? normalizedValues.join("::")
    : null;
}

function addPreviewLookupEntry(
  map: Map<string, ExportPreviewRow | null>,
  key: string | null,
  row: ExportPreviewRow,
): void {
  if (!key) {
    return;
  }

  if (!map.has(key)) {
    map.set(key, row);
    return;
  }

  const existing = map.get(key);

  if (existing && existing.rowKey !== row.rowKey) {
    map.set(key, null);
  }
}

function buildPreviewRowLookup(rows: ExportPreviewRow[]): PreviewRowLookup {
  const lookup: PreviewRowLookup = {
    byDealNameAndEmail: new Map(),
    byEmailAndChannelNameAndCampaign: new Map(),
    byEmailAndYoutubeUrlAndCampaign: new Map(),
    byChannelNameAndCampaign: new Map(),
    byYoutubeHandleAndCampaign: new Map(),
    byYoutubeUrlAndCampaign: new Map(),
  };

  for (const row of rows) {
    addPreviewLookupEntry(
      lookup.byEmailAndYoutubeUrlAndCampaign,
      buildPreviewLookupKey([row.values.email, row.values.youtubeUrl, row.values.campaignName]),
      row,
    );
    addPreviewLookupEntry(
      lookup.byEmailAndChannelNameAndCampaign,
      buildPreviewLookupKey([row.values.email, row.channelTitle, row.values.campaignName]),
      row,
    );
    addPreviewLookupEntry(
      lookup.byDealNameAndEmail,
      buildPreviewLookupKey([row.values.dealName, row.values.email]),
      row,
    );
    addPreviewLookupEntry(
      lookup.byYoutubeUrlAndCampaign,
      buildPreviewLookupKey([row.values.youtubeUrl, row.values.campaignName]),
      row,
    );
    addPreviewLookupEntry(
      lookup.byYoutubeHandleAndCampaign,
      buildPreviewLookupKey([row.values.youtubeHandle, row.values.campaignName]),
      row,
    );
    addPreviewLookupEntry(
      lookup.byChannelNameAndCampaign,
      buildPreviewLookupKey([row.channelTitle, row.values.campaignName]),
      row,
    );
  }

  return lookup;
}

function getSheetHeaderIndexMap(headerRow: string[]): Map<string, number> {
  const indexByHeader = new Map<string, number>();

  headerRow.forEach((header, index) => {
    indexByHeader.set(normalizeGoogleSheetsHeader(header), index);
  });

  return indexByHeader;
}

function getGoogleSheetsRowValue(
  row: string[],
  indexByHeader: Map<string, number>,
  headerNames: string[],
): string {
  for (const headerName of headerNames) {
    const index = indexByHeader.get(normalizeGoogleSheetsHeader(headerName));

    if (index !== undefined) {
      const value = (row[index] ?? "").trim();

      if (value.length > 0) {
        return value;
      }
    }
  }

  return "";
}

function findMatchingHubspotPreviewRow(input: {
  row: string[];
  indexByHeader: Map<string, number>;
  lookup: PreviewRowLookup;
}): ExportPreviewRow | null {
  const email = getGoogleSheetsRowValue(input.row, input.indexByHeader, ["Email"]);
  const youtubeUrl = getGoogleSheetsRowValue(input.row, input.indexByHeader, [
    "YouTube URL",
    "Channel URL",
  ]);
  const youtubeHandle = getGoogleSheetsRowValue(input.row, input.indexByHeader, ["YouTube Handle"]);
  const channelName = getGoogleSheetsRowValue(input.row, input.indexByHeader, ["Channel Name"]);
  const campaignName = getGoogleSheetsRowValue(input.row, input.indexByHeader, ["Campaign Name"]);
  const dealName = getGoogleSheetsRowValue(input.row, input.indexByHeader, ["Deal name"]);

  const keys = [
    input.lookup.byEmailAndYoutubeUrlAndCampaign.get(
      buildPreviewLookupKey([email, youtubeUrl, campaignName]) ?? "",
    ),
    input.lookup.byEmailAndChannelNameAndCampaign.get(
      buildPreviewLookupKey([email, channelName, campaignName]) ?? "",
    ),
    input.lookup.byDealNameAndEmail.get(buildPreviewLookupKey([dealName, email]) ?? ""),
    input.lookup.byYoutubeUrlAndCampaign.get(
      buildPreviewLookupKey([youtubeUrl, campaignName]) ?? "",
    ),
    input.lookup.byYoutubeHandleAndCampaign.get(
      buildPreviewLookupKey([youtubeHandle, campaignName]) ?? "",
    ),
    input.lookup.byChannelNameAndCampaign.get(
      buildPreviewLookupKey([channelName, campaignName]) ?? "",
    ),
  ];

  for (const candidate of keys) {
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export function enrichGoogleSheetsCreatorListRows(input: {
  headerRow: string[];
  rows: string[][];
  previewColumns: ExportPreviewColumn[];
  previewRows: ExportPreviewRow[];
}): {
  matchedRowCount: number;
  updatedRowCount: number;
  updatedFieldCount: number;
  rows: string[][];
} {
  const indexByHeader = getSheetHeaderIndexMap(input.headerRow);
  const lookup = buildPreviewRowLookup(input.previewRows);
  const enrichableColumns = input.previewColumns
    .map((column) => ({
      key: column.key,
      index: indexByHeader.get(normalizeGoogleSheetsHeader(column.label)),
    }))
    .filter((column): column is { key: string; index: number } => column.index !== undefined);
  let matchedRowCount = 0;
  let updatedRowCount = 0;
  let updatedFieldCount = 0;

  const rows = input.rows.map((row) => {
    if (isEmptyGoogleSheetsRow(row, input.headerRow.length)) {
      return row;
    }

    const previewRow = findMatchingHubspotPreviewRow({
      row,
      indexByHeader,
      lookup,
    });

    if (!previewRow) {
      return row;
    }

    matchedRowCount += 1;

    const nextRow = [...row];
    let rowUpdatedFieldCount = 0;

    enrichableColumns.forEach((column) => {
      if ((nextRow[column.index] ?? "").trim().length > 0) {
        return;
      }

      const nextValue = (previewRow.values[column.key] ?? "").trim();

      if (!nextValue) {
        return;
      }

      nextRow[column.index] = nextValue;
      rowUpdatedFieldCount += 1;
    });

    if (rowUpdatedFieldCount > 0) {
      updatedRowCount += 1;
      updatedFieldCount += rowUpdatedFieldCount;
    }

    return nextRow;
  });

  return {
    matchedRowCount,
    updatedRowCount,
    updatedFieldCount,
    rows,
  };
}

function parseGoogleSheetsExportRequest(request: ExportRunToGoogleSheetsRequest): {
  parsedRequest: ExportRunToGoogleSheetsRequest;
  spreadsheetId: string;
} {
  const parsedRequest = exportRunToGoogleSheetsRequestSchema.parse(request);
  const spreadsheetId = extractGoogleSpreadsheetId(parsedRequest.spreadsheetIdOrUrl);

  if (!spreadsheetId) {
    throw new ServiceError(
      "GOOGLE_SHEETS_SPREADSHEET_INVALID",
      400,
      "Enter a valid Google Sheets URL or spreadsheet id",
    );
  }

  return {
    parsedRequest,
    spreadsheetId,
  };
}

export async function exportHubspotRunToGoogleSheets(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
  request: ExportRunToGoogleSheetsRequest;
}): Promise<ExportRunToGoogleSheetsResponse> {
  const { parsedRequest, spreadsheetId } = parseGoogleSheetsExportRequest(input.request);

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
