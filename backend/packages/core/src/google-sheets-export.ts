import type {
  CreatorListHubspotHandoffHeader,
  ExportPreviewColumn,
  ExportPreviewRow,
  ExportRunToGoogleSheetsResponse,
} from "@scouting-platform/contracts";
import {
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER,
  exportRunToGoogleSheetsRequestSchema,
  normalizeCreatorListHubspotHeader,
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

const [
  CHANNEL_NAME_HEADER,
  HUBSPOT_RECORD_ID_HEADER,
  TIMESTAMP_IMPORTED_HEADER,
  CHANNEL_URL_HEADER,
  CAMPAIGN_NAME_HEADER,
  DEAL_OWNER_HEADER,
  STATUS_HEADER,
  EMAIL_HEADER,
  PHONE_NUMBER_HEADER,
  CURRENCY_HEADER,
  DEAL_TYPE_HEADER,
  CONTACT_TYPE_HEADER,
  MONTH_HEADER,
  YEAR_HEADER,
  CLIENT_NAME_HEADER,
  DEAL_NAME_HEADER,
  ACTIVATION_NAME_HEADER,
  PIPELINE_HEADER,
  DEAL_STAGE_HEADER,
  FIRST_NAME_HEADER,
  LAST_NAME_HEADER,
  INFLUENCER_TYPE_HEADER,
  INFLUENCER_VERTICAL_HEADER,
  COUNTRY_REGION_HEADER,
  LANGUAGE_HEADER,
  YOUTUBE_HANDLE_HEADER,
  YOUTUBE_URL_HEADER,
  YOUTUBE_VIDEO_MEDIAN_VIEWS_HEADER,
  YOUTUBE_SHORTS_MEDIAN_VIEWS_HEADER,
  YOUTUBE_ENGAGEMENT_RATE_HEADER,
  YOUTUBE_FOLLOWERS_HEADER,
  INSTAGRAM_HANDLE_HEADER,
  INSTAGRAM_URL_HEADER,
  INSTAGRAM_POST_AVERAGE_VIEWS_HEADER,
  INSTAGRAM_REEL_AVERAGE_VIEWS_HEADER,
  INSTAGRAM_STORY_7_DAY_AVERAGE_VIEWS_HEADER,
  INSTAGRAM_STORY_30_DAY_AVERAGE_VIEWS_HEADER,
  INSTAGRAM_ENGAGEMENT_RATE_HEADER,
  INSTAGRAM_FOLLOWERS_HEADER,
  TIKTOK_HANDLE_HEADER,
  TIKTOK_URL_HEADER,
  TIKTOK_AVERAGE_VIEWS_HEADER,
  TIKTOK_ENGAGEMENT_RATE_HEADER,
  TIKTOK_FOLLOWERS_HEADER,
  TWITCH_HANDLE_HEADER,
  TWITCH_URL_HEADER,
  TWITCH_AVERAGE_VIEWS_HEADER,
  TWITCH_ENGAGEMENT_RATE_HEADER,
  TWITCH_FOLLOWERS_HEADER,
  KICK_HANDLE_HEADER,
  KICK_URL_HEADER,
  KICK_AVERAGE_VIEWS_HEADER,
  KICK_ENGAGEMENT_RATE_HEADER,
  KICK_FOLLOWERS_HEADER,
  X_HANDLE_HEADER,
  X_URL_HEADER,
  X_AVERAGE_VIEWS_HEADER,
  X_ENGAGEMENT_RATE_HEADER,
  X_FOLLOWERS_HEADER,
] = CREATOR_LIST_HUBSPOT_HANDOFF_HEADER;

const GOOGLE_SHEETS_HEADER_RESOLVER_BY_HEADER: Record<
  CreatorListHubspotHandoffHeader,
  HeaderValueResolver
> = {
  [CHANNEL_NAME_HEADER]: (row) => row.channelTitle,
  [HUBSPOT_RECORD_ID_HEADER]: () => "",
  [TIMESTAMP_IMPORTED_HEADER]: () => "",
  [CHANNEL_URL_HEADER]: (row) => row.values.youtubeUrl ?? "",
  [CAMPAIGN_NAME_HEADER]: (row) => row.values.campaignName ?? "",
  [DEAL_OWNER_HEADER]: (row) => row.values.dealOwner ?? "",
  [STATUS_HEADER]: () => "",
  [EMAIL_HEADER]: (row) => row.values.email ?? "",
  [PHONE_NUMBER_HEADER]: (row) => row.values.phoneNumber ?? "",
  [CURRENCY_HEADER]: (row) => row.values.currency ?? "",
  [DEAL_TYPE_HEADER]: (row) => row.values.dealType ?? "",
  [CONTACT_TYPE_HEADER]: (row) => row.values.contactType ?? "",
  [MONTH_HEADER]: (row) => row.values.month ?? "",
  [YEAR_HEADER]: (row) => row.values.year ?? "",
  [CLIENT_NAME_HEADER]: (row) => row.values.clientName ?? "",
  [DEAL_NAME_HEADER]: (row) => row.values.dealName ?? "",
  [ACTIVATION_NAME_HEADER]: (row) => row.values.activationName ?? row.values.dealName ?? "",
  [PIPELINE_HEADER]: (row) => row.values.pipeline ?? "",
  [DEAL_STAGE_HEADER]: (row) => row.values.dealStage ?? "",
  [FIRST_NAME_HEADER]: (row) => row.values.firstName ?? "",
  [LAST_NAME_HEADER]: (row) => row.values.lastName ?? "",
  [INFLUENCER_TYPE_HEADER]: (row) => row.values.influencerType ?? "",
  [INFLUENCER_VERTICAL_HEADER]: (row) => row.values.influencerVertical ?? "",
  [COUNTRY_REGION_HEADER]: (row) => row.values.countryRegion ?? "",
  [LANGUAGE_HEADER]: (row) => row.values.language ?? "",
  [YOUTUBE_HANDLE_HEADER]: (row) => row.values.youtubeHandle ?? "",
  [YOUTUBE_URL_HEADER]: (row) => row.values.youtubeUrl ?? "",
  [YOUTUBE_VIDEO_MEDIAN_VIEWS_HEADER]: (row) => row.values.youtubeVideoMedianViews ?? "",
  [YOUTUBE_SHORTS_MEDIAN_VIEWS_HEADER]: (row) => row.values.youtubeShortsMedianViews ?? "",
  [YOUTUBE_ENGAGEMENT_RATE_HEADER]: (row) => row.values.youtubeEngagementRate ?? "",
  [YOUTUBE_FOLLOWERS_HEADER]: (row) => row.values.youtubeFollowers ?? "",
  [INSTAGRAM_HANDLE_HEADER]: (row) => row.values.instagramHandle ?? "",
  [INSTAGRAM_URL_HEADER]: (row) => row.values.instagramUrl ?? "",
  [INSTAGRAM_POST_AVERAGE_VIEWS_HEADER]: (row) => row.values.instagramPostAverageViews ?? "",
  [INSTAGRAM_REEL_AVERAGE_VIEWS_HEADER]: (row) => row.values.instagramReelAverageViews ?? "",
  [INSTAGRAM_STORY_7_DAY_AVERAGE_VIEWS_HEADER]: (row) =>
    row.values.instagramStory7DayAverageViews ?? "",
  [INSTAGRAM_STORY_30_DAY_AVERAGE_VIEWS_HEADER]: (row) =>
    row.values.instagramStory30DayAverageViews ?? "",
  [INSTAGRAM_ENGAGEMENT_RATE_HEADER]: (row) => row.values.instagramEngagementRate ?? "",
  [INSTAGRAM_FOLLOWERS_HEADER]: (row) => row.values.instagramFollowers ?? "",
  [TIKTOK_HANDLE_HEADER]: (row) => row.values.tiktokHandle ?? "",
  [TIKTOK_URL_HEADER]: (row) => row.values.tiktokUrl ?? "",
  [TIKTOK_AVERAGE_VIEWS_HEADER]: (row) => row.values.tiktokAverageViews ?? "",
  [TIKTOK_ENGAGEMENT_RATE_HEADER]: (row) => row.values.tiktokEngagementRate ?? "",
  [TIKTOK_FOLLOWERS_HEADER]: (row) => row.values.tiktokFollowers ?? "",
  [TWITCH_HANDLE_HEADER]: (row) => row.values.twitchHandle ?? "",
  [TWITCH_URL_HEADER]: (row) => row.values.twitchUrl ?? "",
  [TWITCH_AVERAGE_VIEWS_HEADER]: (row) => row.values.twitchAverageViews ?? "",
  [TWITCH_ENGAGEMENT_RATE_HEADER]: (row) => row.values.twitchEngagementRate ?? "",
  [TWITCH_FOLLOWERS_HEADER]: (row) => row.values.twitchFollowers ?? "",
  [KICK_HANDLE_HEADER]: (row) => row.values.kickHandle ?? "",
  [KICK_URL_HEADER]: (row) => row.values.kickUrl ?? "",
  [KICK_AVERAGE_VIEWS_HEADER]: (row) => row.values.kickAverageViews ?? "",
  [KICK_ENGAGEMENT_RATE_HEADER]: (row) => row.values.kickEngagementRate ?? "",
  [KICK_FOLLOWERS_HEADER]: (row) => row.values.kickFollowers ?? "",
  [X_HANDLE_HEADER]: (row) => row.values.xHandle ?? "",
  [X_URL_HEADER]: (row) => row.values.xUrl ?? "",
  [X_AVERAGE_VIEWS_HEADER]: (row) => row.values.xAverageViews ?? "",
  [X_ENGAGEMENT_RATE_HEADER]: (row) => row.values.xEngagementRate ?? "",
  [X_FOLLOWERS_HEADER]: (row) => row.values.xFollowers ?? "",
};

const GOOGLE_SHEETS_HEADER_RESOLVERS = new Map<string, HeaderValueResolver>(
  CREATOR_LIST_HUBSPOT_HANDOFF_HEADER.map((header) => [
    header,
    GOOGLE_SHEETS_HEADER_RESOLVER_BY_HEADER[header],
  ]),
);
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
  return normalizeCreatorListHubspotHeader(value);
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
