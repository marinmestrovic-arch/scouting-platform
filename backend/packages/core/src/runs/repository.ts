import { createHash } from "node:crypto";

import {
  CredentialProvider,
  HubspotImportBatchStatus as PrismaHubspotImportBatchStatus,
  Prisma,
  Role,
  type RunChannelAssessment,
  RunChannelAssessmentStatus as PrismaRunChannelAssessmentStatus,
  RunMonth as PrismaRunMonth,
  RunRequestStatus as PrismaRunRequestStatus,
  RunResultSource as PrismaRunResultSource,
  UserType,
} from "@prisma/client";
import {
  isCatalogScoutingQuery,
  parseCatalogScoutingQuery,
  type CatalogScoutingCriteria,
  type CreateRunResponse,
  type ListRecentRunsResponse,
  type HubspotImportBatchStatus,
  type RunChannelAssessmentItem,
  type RunFilterOptions,
  type RunMetadataInput,
  type RunMetadataResponse,
  type RunMonth,
  type RunRequestStatus,
  type RunStatusResponse,
  type UpdateRunResultRatingResponse,
} from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";
import {
  discoverYoutubeChannels,
  isYoutubeDiscoveryProviderError,
  type YoutubeDiscoveredChannel,
} from "@scouting-platform/integrations";

import { getUserYoutubeApiKey } from "../auth";
import { upsertChannelSkeleton } from "../channels";
import { ServiceError } from "../errors";
import { enqueueJob } from "../queue";
import { logProviderSpend } from "../telemetry";
import { enqueueRunsDiscoverJob } from "./queue";

const campaignManagerSelect = {
  id: true,
  email: true,
  name: true,
} as const;

const ACTIVE_HUBSPOT_IMPORT_BATCH_STATUSES = new Set<PrismaHubspotImportBatchStatus>([
  PrismaHubspotImportBatchStatus.QUEUED,
  PrismaHubspotImportBatchStatus.PREPARING,
  PrismaHubspotImportBatchStatus.RUNNING,
  PrismaHubspotImportBatchStatus.SUBMITTING,
  PrismaHubspotImportBatchStatus.SUBMITTED,
  PrismaHubspotImportBatchStatus.PROCESSING,
]);

function toHubspotImportBatchStatus(
  status: PrismaHubspotImportBatchStatus,
): HubspotImportBatchStatus {
  switch (status) {
    case PrismaHubspotImportBatchStatus.PREPARING:
      return "preparing";
    case PrismaHubspotImportBatchStatus.RUNNING:
      return "running";
    case PrismaHubspotImportBatchStatus.SUBMITTING:
      return "submitting";
    case PrismaHubspotImportBatchStatus.SUBMITTED:
      return "submitted";
    case PrismaHubspotImportBatchStatus.PROCESSING:
      return "processing";
    case PrismaHubspotImportBatchStatus.COMPLETED:
      return "completed";
    case PrismaHubspotImportBatchStatus.COMPLETED_WITH_ERRORS:
      return "completed_with_errors";
    case PrismaHubspotImportBatchStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

export function selectRunHubspotSyncStatus(
  batches: readonly { status: PrismaHubspotImportBatchStatus }[],
): HubspotImportBatchStatus | null {
  const selected = batches.find((batch) =>
    ACTIVE_HUBSPOT_IMPORT_BATCH_STATUSES.has(batch.status),
  ) ?? batches[0];
  return selected ? toHubspotImportBatchStatus(selected.status) : null;
}

export const runMetadataSelect = {
  campaignId: true,
  client: true,
  market: true,
  campaignManagerUserId: true,
  briefLink: true,
  campaignName: true,
  month: true,
  year: true,
  dealOwner: true,
  dealName: true,
  pipeline: true,
  dealStage: true,
  currency: true,
  dealType: true,
  activationType: true,
  hubspotInfluencerType: true,
  hubspotInfluencerVertical: true,
  hubspotCountryRegion: true,
  hubspotLanguage: true,
  clientIndustry: true,
  campaignObjective: true,
  targetAudienceAge: true,
  targetAudienceGender: true,
  targetGeographies: true,
  contentRestrictions: true,
  budgetTier: true,
  deliverables: true,
  campaignManagerUser: {
    select: campaignManagerSelect,
  },
} as const;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function parseStringArrayOrNull(value: Prisma.JsonValue | null): string[] | null {
  if (value === null) {
    return null;
  }

  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

const YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES = Number(
  process.env.YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES?.trim() || "30",
);
const DEFAULT_CATALOG_ACTIVITY_WINDOW_DAYS = 180;
const MIN_AUTOMATIC_FIT_SCORE = 0.55;

function buildDiscoveryCacheKey(
  query: string,
  userId: string,
  maxResults: number,
): string {
  const normalized = query.trim().toLowerCase().replaceAll(/\s+/g, " ");

  return createHash("sha256")
    .update(JSON.stringify({ query: normalized, userId, maxResults }))
    .digest("hex");
}

function toRunRequestStatus(status: PrismaRunRequestStatus): RunRequestStatus {
  if (status === PrismaRunRequestStatus.RUNNING) {
    return "running";
  }

  if (status === PrismaRunRequestStatus.COMPLETED) {
    return "completed";
  }

  if (status === PrismaRunRequestStatus.FAILED) {
    return "failed";
  }

  return "queued";
}

function toRunResultSource(source: PrismaRunResultSource): "catalog" | "discovery" {
  return source === PrismaRunResultSource.DISCOVERY ? "discovery" : "catalog";
}

function toRunChannelAssessmentStatus(
  status: PrismaRunChannelAssessmentStatus,
): RunChannelAssessmentItem["status"] {
  switch (status) {
    case PrismaRunChannelAssessmentStatus.RUNNING:
      return "running";
    case PrismaRunChannelAssessmentStatus.COMPLETED:
      return "completed";
    case PrismaRunChannelAssessmentStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toRunMonth(month: PrismaRunMonth | null): RunMonth | null {
  switch (month) {
    case PrismaRunMonth.JANUARY:
      return "january";
    case PrismaRunMonth.FEBRUARY:
      return "february";
    case PrismaRunMonth.MARCH:
      return "march";
    case PrismaRunMonth.APRIL:
      return "april";
    case PrismaRunMonth.MAY:
      return "may";
    case PrismaRunMonth.JUNE:
      return "june";
    case PrismaRunMonth.JULY:
      return "july";
    case PrismaRunMonth.AUGUST:
      return "august";
    case PrismaRunMonth.SEPTEMBER:
      return "september";
    case PrismaRunMonth.OCTOBER:
      return "october";
    case PrismaRunMonth.NOVEMBER:
      return "november";
    case PrismaRunMonth.DECEMBER:
      return "december";
    default:
      return null;
  }
}

export function toRunMetadata(
  runRequest: Prisma.RunRequestGetPayload<{ select: typeof runMetadataSelect }>,
): RunMetadataResponse {
  return {
    campaignId: runRequest.campaignId,
    client: runRequest.client,
    market: runRequest.market,
    campaignManagerUserId: runRequest.campaignManagerUserId,
    campaignManager: runRequest.campaignManagerUser
      ? {
          id: runRequest.campaignManagerUser.id,
          email: runRequest.campaignManagerUser.email,
          name: runRequest.campaignManagerUser.name,
        }
      : null,
    briefLink: runRequest.briefLink,
    campaignName: runRequest.campaignName,
    month: toRunMonth(runRequest.month),
    year: runRequest.year,
    dealOwner: runRequest.dealOwner,
    dealName: runRequest.dealName,
    pipeline: runRequest.pipeline,
    dealStage: runRequest.dealStage,
    currency: runRequest.currency,
    dealType: runRequest.dealType,
    activationType: runRequest.activationType,
    hubspotInfluencerType: runRequest.hubspotInfluencerType,
    hubspotInfluencerVertical: runRequest.hubspotInfluencerVertical,
    hubspotCountryRegion: runRequest.hubspotCountryRegion,
    hubspotLanguage: runRequest.hubspotLanguage,
    clientIndustry: runRequest.clientIndustry,
    campaignObjective: runRequest.campaignObjective,
    targetAudienceAge: runRequest.targetAudienceAge,
    targetAudienceGender: runRequest.targetAudienceGender,
    targetGeographies: parseStringArrayOrNull(runRequest.targetGeographies),
    contentRestrictions: parseStringArrayOrNull(runRequest.contentRestrictions),
    budgetTier: runRequest.budgetTier,
    deliverables: parseStringArrayOrNull(runRequest.deliverables),
  };
}

export function toRunChannelAssessmentItem(row: RunChannelAssessment): RunChannelAssessmentItem {
  return {
    id: row.id,
    runRequestId: row.runRequestId,
    channelId: row.channelId,
    status: toRunChannelAssessmentStatus(row.status),
    model: row.model ?? null,
    fitScore: row.fitScore ?? null,
    fitReasons: parseStringArrayOrNull((row.fitReasons as Prisma.JsonValue | null) ?? null),
    fitConcerns: parseStringArrayOrNull((row.fitConcerns as Prisma.JsonValue | null) ?? null),
    recommendedAngles: parseStringArrayOrNull(
      (row.recommendedAngles as Prisma.JsonValue | null) ?? null,
    ),
    avoidTopics: parseStringArrayOrNull((row.avoidTopics as Prisma.JsonValue | null) ?? null),
    assessedAt: row.assessedAt?.toISOString() ?? null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type CatalogCandidate = {
  id: string;
};

type RankedRunResult = {
  channelId: string;
  source: PrismaRunResultSource;
};

type AssessmentBriefFields = {
  clientIndustry: string | null;
  campaignObjective: string | null;
  targetAudienceAge: string | null;
  targetAudienceGender: string | null;
  targetGeographies: Prisma.JsonValue | null;
  contentRestrictions: Prisma.JsonValue | null;
  budgetTier: string | null;
  deliverables: Prisma.JsonValue | null;
};

function hasAutomaticAssessmentBrief(run: AssessmentBriefFields): boolean {
  const stringFields = [
    run.clientIndustry,
    run.campaignObjective,
    run.targetAudienceAge,
    run.targetAudienceGender,
    run.budgetTier,
  ];

  if (stringFields.some((value) => value?.trim())) {
    return true;
  }

  const arrayFields = [
    parseStringArrayOrNull(run.targetGeographies),
    parseStringArrayOrNull(run.contentRestrictions),
    parseStringArrayOrNull(run.deliverables),
  ];

  return arrayFields.some((value) => (value?.length ?? 0) > 0);
}

async function validateCampaignManagerUser(userId: string): Promise<void> {
  const campaignManager = await prisma.user.findFirst({
    where: {
      id: userId,
      isActive: true,
      role: Role.USER,
      userType: UserType.CAMPAIGN_MANAGER,
    },
    select: {
      id: true,
    },
  });

  if (!campaignManager) {
    throw new ServiceError(
      "CAMPAIGN_MANAGER_INVALID",
      400,
      "Selected campaign manager must be an active Campaign Manager user",
    );
  }
}

async function loadRunCreationMetadata(input: {
  campaignId: string;
  userId: string;
  campaignManagerUserId?: string;
}): Promise<Pick<
  Prisma.RunRequestUncheckedCreateInput,
  | "campaignId"
  | "client"
  | "market"
  | "campaignManagerUserId"
  | "briefLink"
  | "campaignName"
  | "month"
  | "year"
  | "dealOwner"
  | "dealName"
  | "pipeline"
  | "dealStage"
  | "dealType"
  | "activationType"
  | "hubspotInfluencerType"
  | "hubspotInfluencerVertical"
  | "hubspotCountryRegion"
  | "hubspotLanguage"
>> {
  const [campaign, user] = await Promise.all([
    prisma.campaign.findUnique({
      where: {
        id: input.campaignId,
      },
      select: {
        id: true,
        name: true,
        briefLink: true,
        month: true,
        year: true,
        isActive: true,
        client: {
          select: {
            name: true,
          },
        },
        market: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.user.findUnique({
      where: {
        id: input.userId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        userType: true,
      },
    }),
  ]);

  if (!campaign || !campaign.isActive) {
    throw new ServiceError("CAMPAIGN_NOT_FOUND", 400, "Selected campaign is not available");
  }

  if (!user) {
    throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
  }

  const campaignManagerUserId =
    input.campaignManagerUserId ??
    (user.userType === UserType.CAMPAIGN_MANAGER ? user.id : null);

  if (campaignManagerUserId) {
    await validateCampaignManagerUser(campaignManagerUserId);
  }

  const selectedCampaignManager = campaignManagerUserId
    ? await prisma.user.findUnique({
        where: {
          id: campaignManagerUserId,
        },
        select: {
          email: true,
          name: true,
        },
      })
    : null;

  return {
    campaignId: campaign.id,
    client: campaign.client?.name ?? null,
    market: campaign.market?.name ?? null,
    campaignManagerUserId,
    briefLink: campaign.briefLink,
    campaignName: campaign.name,
    month: campaign.month,
    year: campaign.year,
    dealOwner:
      selectedCampaignManager?.name?.trim() ||
      selectedCampaignManager?.email ||
      user.name?.trim() ||
      user.email,
    dealName: campaign.name,
    pipeline: "Sales Pipeline",
    dealStage: "Scouted",
    dealType: "",
    activationType: "",
    hubspotInfluencerType: "",
    hubspotInfluencerVertical: "",
    hubspotCountryRegion: "",
    hubspotLanguage: "",
  };
}

async function getCatalogCandidatesForQuery(query: string): Promise<CatalogCandidate[]> {
  const catalogScoutingCriteria = parseCatalogScoutingQuery(query);

  if (catalogScoutingCriteria) {
    return getCatalogCandidatesForCriteria(catalogScoutingCriteria);
  }

  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const where: Prisma.ChannelWhereInput = {
    OR: [
      {
        title: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        handle: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
      {
        youtubeChannelId: {
          contains: normalizedQuery,
          mode: "insensitive",
        },
      },
    ],
  };

  return prisma.channel.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
    select: {
      id: true,
    },
  });
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function toLikePattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

function splitCriteriaValues(value: string): string[] {
  const values = value
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return [...new Set(values)];
}

function buildCatalogTextEvidenceClause(value: string): Prisma.Sql | null {
  const values = splitCriteriaValues(value);

  if (values.length === 0) {
    return null;
  }

  const valueClauses = values.map((candidate) => {
    const pattern = toLikePattern(candidate);

    return Prisma.sql`
      (
        c.title ILIKE ${pattern} ESCAPE '\\'
        OR c.description ILIKE ${pattern} ESCAPE '\\'
        OR c.influencer_vertical ILIKE ${pattern} ESCAPE '\\'
        OR ce.topics::text ILIKE ${pattern} ESCAPE '\\'
        OR ce.structured_profile::text ILIKE ${pattern} ESCAPE '\\'
        OR cyc.context::text ILIKE ${pattern} ESCAPE '\\'
      )
    `;
  });

  return Prisma.sql`(${Prisma.join(valueClauses, " OR ")})`;
}

function explicitlyRequestsPublisherContent(criteria: CatalogScoutingCriteria): boolean {
  const requested = `${criteria.category} ${criteria.niche}`.toLowerCase();

  return ["music", "news", "politics", "television", "tv", "radio"].some((term) =>
    requested.includes(term),
  );
}

function parseMetricBound(rawValue: string): bigint | null {
  const normalized = rawValue.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)([kmb])?$/);

  if (!match) {
    return null;
  }

  const numericPart = match[1];

  if (!numericPart) {
    return null;
  }

  const numeric = Number.parseFloat(numericPart);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  const multiplier =
    match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : 1;

  return BigInt(Math.round(numeric * multiplier));
}

function parseMetricRange(value: string): { min?: bigint; max?: bigint } | null {
  const normalized = value.trim().toLowerCase().replaceAll(",", "").replace(/\s+/g, "");

  if (!normalized) {
    return null;
  }

  const plusMatch = normalized.match(/^(.+)\+$/);

  if (plusMatch) {
    const minimum = plusMatch[1] ? parseMetricBound(plusMatch[1]) : null;
    return minimum === null ? null : { min: minimum };
  }

  const rangeMatch = normalized.match(/^([0-9]+(?:\.\d+)?[kmb]?)(?:-|to)([0-9]+(?:\.\d+)?[kmb]?)$/);

  if (rangeMatch) {
    const minimum = rangeMatch[1] ? parseMetricBound(rangeMatch[1]) : null;
    const maximum = rangeMatch[2] ? parseMetricBound(rangeMatch[2]) : null;

    if (minimum === null || maximum === null) {
      return null;
    }

    return minimum <= maximum ? { min: minimum, max: maximum } : { min: maximum, max: minimum };
  }

  const minimum = parseMetricBound(normalized);
  return minimum === null ? null : { min: minimum };
}

function parseDaysSince(value: string): number | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function buildMetricRangeClause(
  column: Prisma.Sql,
  range: { min?: bigint; max?: bigint },
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];

  if (range.min !== undefined) {
    clauses.push(Prisma.sql`${column} >= ${range.min}`);
  }

  if (range.max !== undefined) {
    clauses.push(Prisma.sql`${column} <= ${range.max}`);
  }

  return Prisma.sql`(${Prisma.join(clauses, " AND ")})`;
}

async function getCatalogCandidatesForCriteria(
  criteria: CatalogScoutingCriteria,
): Promise<CatalogCandidate[]> {
  const whereClauses: Prisma.Sql[] = [];
  const subscriberRange = parseMetricRange(criteria.subscribers);
  const viewsRange = parseMetricRange(criteria.views);
  const locations = splitCriteriaValues(criteria.location);
  const language = criteria.language.trim();
  const lastPostDaysSince = parseDaysSince(criteria.lastPostDaysSince);
  const categoryClause = buildCatalogTextEvidenceClause(criteria.category);
  const nicheClause = buildCatalogTextEvidenceClause(criteria.niche);
  const hasEffectiveCriteria = Boolean(
    subscriberRange
    || viewsRange
    || locations.length > 0
    || language
    || lastPostDaysSince !== null
    || categoryClause
    || nicheClause,
  );

  if (!hasEffectiveCriteria) {
    return [];
  }

  if (subscriberRange?.min !== undefined) {
    whereClauses.push(
      Prisma.sql`COALESCE(cm.youtube_followers, cm.subscriber_count) >= ${subscriberRange.min}`,
    );
  }

  if (subscriberRange?.max !== undefined) {
    whereClauses.push(
      Prisma.sql`COALESCE(cm.youtube_followers, cm.subscriber_count) <= ${subscriberRange.max}`,
    );
  }

  if (viewsRange) {
    whereClauses.push(Prisma.sql`
      (
        ${buildMetricRangeClause(Prisma.sql`cm.youtube_video_median_views`, viewsRange)}
        OR ${buildMetricRangeClause(Prisma.sql`cm.youtube_shorts_median_views`, viewsRange)}
        OR (
          cm.youtube_video_median_views IS NULL
          AND cm.youtube_shorts_median_views IS NULL
          AND ${buildMetricRangeClause(Prisma.sql`cm.view_count`, viewsRange)}
        )
      )
    `);
  }

  if (locations.length > 0) {
    const locationClauses = locations.map(
      (location) => Prisma.sql`LOWER(c.country_region) = LOWER(${location})`,
    );

    whereClauses.push(Prisma.sql`(${Prisma.join(locationClauses, " OR ")})`);
  }

  if (language) {
    whereClauses.push(Prisma.sql`LOWER(c.content_language) = LOWER(${language})`);
  }

  if (lastPostDaysSince !== null) {
    const threshold = new Date(Date.now() - lastPostDaysSince * 24 * 60 * 60 * 1000);

    whereClauses.push(Prisma.sql`
      NULLIF(cyc.context #>> '{recentVideos,0,publishedAt}', '') IS NOT NULL
      AND (cyc.context #>> '{recentVideos,0,publishedAt}')::timestamptz >= ${threshold}
    `);
  } else {
    const activityThreshold = new Date(
      Date.now() - DEFAULT_CATALOG_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    whereClauses.push(Prisma.sql`
      (
        NULLIF(cyc.context #>> '{recentVideos,0,publishedAt}', '') IS NULL
        OR (cyc.context #>> '{recentVideos,0,publishedAt}')::timestamptz >= ${activityThreshold}
      )
    `);
  }

  whereClauses.push(Prisma.sql`(cm.video_count IS NULL OR cm.video_count > 0)`);

  if (categoryClause) {
    whereClauses.push(categoryClause);
  }

  if (nicheClause) {
    whereClauses.push(nicheClause);
  }

  if (!explicitlyRequestsPublisherContent(criteria)) {
    whereClauses.push(Prisma.sql`
      NOT (
        c.title ~* ' - Topic$'
        OR LOWER(COALESCE(ce.structured_profile #>> '{accountType}', '')) IN (
          'publisher_media',
          'brand_organization',
          'music_artist'
        )
        OR LOWER(COALESCE(ce.structured_profile #>> '{primaryNiche}', '')) IN (
          'music',
          'news_politics'
        )
        OR (
          c.title ~* '(^|[[:space:][:punct:]])(tv|television|news|radio|records?|music)([[:space:][:punct:]]|$)'
          AND (
            LOWER(COALESCE(ce.structured_profile #>> '{primaryNiche}', '')) IN ('music', 'news_politics')
            OR cyc.context::text ~* '"categoryName"[[:space:]]*:[[:space:]]*"(Music|News & Politics)"'
          )
        )
      )
    `);
  }

  if (whereClauses.length === 0) {
    return [];
  }

  return prisma.$queryRaw<CatalogCandidate[]>(Prisma.sql`
    SELECT c.id
    FROM channels c
    LEFT JOIN channel_metrics cm ON cm.channel_id = c.id
    LEFT JOIN channel_enrichments ce ON ce.channel_id = c.id
    LEFT JOIN channel_youtube_contexts cyc ON cyc.channel_id = c.id
    WHERE ${Prisma.join(whereClauses, " AND ")}
    ORDER BY COALESCE(cm.youtube_followers, cm.subscriber_count) DESC NULLS LAST, c.updated_at DESC
    LIMIT 100
  `);
}

function buildRunScopeWhere(input: {
  userId: string;
  role: "admin" | "user";
}): Prisma.RunRequestWhereInput {
  if (input.role === "admin") {
    return {};
  }

  return {
    requestedByUserId: input.userId,
  };
}

function buildRunListWhere(input: {
  userId: string;
  role: "admin" | "user";
  campaignManagerUserId?: string;
  client?: string;
  market?: string;
}): Prisma.RunRequestWhereInput {
  const scopedWhere = buildRunScopeWhere({
    userId: input.userId,
    role: input.role,
  });

  return {
    ...scopedWhere,
    ...(input.campaignManagerUserId
      ? {
          campaignManagerUserId: input.campaignManagerUserId,
        }
      : {}),
    ...(input.client
      ? {
          client: input.client.trim(),
        }
      : {}),
    ...(input.market
      ? {
          market: input.market.trim(),
        }
      : {}),
  };
}

function uniqueSorted(values: readonly (string | null)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

async function getRunFilterOptions(input: {
  userId: string;
  role: "admin" | "user";
}): Promise<RunFilterOptions> {
  const scopeWhere = buildRunScopeWhere({
    userId: input.userId,
    role: input.role,
  });
  const [campaignManagerGroups, clientGroups, marketGroups] = await Promise.all([
    prisma.runRequest.groupBy({
      by: ["campaignManagerUserId"],
      where: {
        ...scopeWhere,
        campaignManagerUserId: {
          not: null,
        },
      },
    }),
    prisma.runRequest.groupBy({
      by: ["client"],
      where: {
        ...scopeWhere,
        client: {
          not: null,
        },
      },
    }),
    prisma.runRequest.groupBy({
      by: ["market"],
      where: {
        ...scopeWhere,
        market: {
          not: null,
        },
      },
    }),
  ]);
  const campaignManagerIds = campaignManagerGroups
    .map((group) => group.campaignManagerUserId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const campaignManagerUsers =
    campaignManagerIds.length > 0
      ? await prisma.user.findMany({
          where: {
            id: {
              in: campaignManagerIds,
            },
          },
          select: campaignManagerSelect,
        })
      : [];
  const campaignManagerUsersById = new Map(
    campaignManagerUsers.map((campaignManager) => [campaignManager.id, campaignManager] as const),
  );

  const campaignManagers = new Map<string, RunFilterOptions["campaignManagers"][number]>();

  for (const campaignManagerId of campaignManagerIds) {
    const campaignManagerUser = campaignManagerUsersById.get(campaignManagerId);

    if (!campaignManagerUser) {
      continue;
    }

    campaignManagers.set(campaignManagerUser.id, {
      id: campaignManagerUser.id,
      email: campaignManagerUser.email,
      name: campaignManagerUser.name,
    });
  }

  return {
    campaignManagers: [...campaignManagers.values()].sort((left, right) =>
      (left.name?.trim() || left.email).localeCompare(right.name?.trim() || right.email),
    ),
    clients: uniqueSorted(clientGroups.map((group) => group.client)),
    markets: uniqueSorted(marketGroups.map((group) => group.market)),
  };
}

export async function createRunRequest(input: {
  userId: string;
  name: string;
  query: string;
  target: number;
  metadata: RunMetadataInput;
}): Promise<CreateRunResponse> {
  if (!isCatalogScoutingQuery(input.query)) {
    const hasYoutubeKey = await prisma.userProviderCredential.findUnique({
      where: {
        userId_provider: {
          userId: input.userId,
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
      },
      select: {
        id: true,
      },
    });

    if (!hasYoutubeKey) {
      throw new ServiceError(
        "YOUTUBE_KEY_REQUIRED",
        400,
        "Assigned YouTube API key is required before creating a run",
      );
    }
  }

  const runMetadata = await loadRunCreationMetadata({
    campaignId: input.metadata.campaignId,
    userId: input.userId,
    ...(input.metadata.campaignManagerUserId
      ? { campaignManagerUserId: input.metadata.campaignManagerUserId }
      : {}),
  });

  const runRequestCreateInput: Prisma.RunRequestUncheckedCreateInput = {
    requestedByUserId: input.userId,
    name: input.name.trim(),
    query: input.query.trim(),
    target: input.target,
    status: PrismaRunRequestStatus.QUEUED,
    ...runMetadata,
    clientIndustry: input.metadata.clientIndustry ?? null,
    campaignObjective: input.metadata.campaignObjective ?? null,
    targetAudienceAge: input.metadata.targetAudienceAge ?? null,
    targetAudienceGender: input.metadata.targetAudienceGender ?? null,
    budgetTier: input.metadata.budgetTier ?? null,
    ...(input.metadata.targetGeographies !== undefined
      ? {
          targetGeographies:
            input.metadata.targetGeographies === null
              ? Prisma.DbNull
              : toJsonValue(input.metadata.targetGeographies),
        }
      : {}),
    ...(input.metadata.contentRestrictions !== undefined
      ? {
          contentRestrictions:
            input.metadata.contentRestrictions === null
              ? Prisma.DbNull
              : toJsonValue(input.metadata.contentRestrictions),
        }
      : {}),
    ...(input.metadata.deliverables !== undefined
      ? {
          deliverables:
            input.metadata.deliverables === null
              ? Prisma.DbNull
              : toJsonValue(input.metadata.deliverables),
        }
      : {}),
  };

  const runRequest = await prisma.runRequest.create({
    data: runRequestCreateInput,
    select: {
      id: true,
      status: true,
    },
  });

  try {
    await enqueueRunsDiscoverJob({
      runRequestId: runRequest.id,
      requestedByUserId: input.userId,
    });
  } catch (error) {
    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.FAILED,
        lastError: formatErrorMessage(error),
      },
    });
    throw new ServiceError(
      "RUN_ENQUEUE_FAILED",
      500,
      "Failed to enqueue run processing job",
    );
  }

  return {
    runId: runRequest.id,
    status: toRunRequestStatus(runRequest.status),
  };
}

export async function listRecentRuns(input: {
  userId: string;
  role: "admin" | "user";
  limit?: number;
  campaignManagerUserId?: string;
  client?: string;
  market?: string;
}): Promise<ListRecentRunsResponse> {
  const limit = Math.max(1, Math.floor(input.limit ?? 50));

  // Run both queries in parallel instead of sequentially.
  const [runRequests, filterOptions] = await Promise.all([
    prisma.runRequest.findMany({
      where: buildRunListWhere(input),
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      take: limit,
      select: {
        id: true,
        name: true,
        query: true,
        target: true,
        status: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        ...runMetadataSelect,
        _count: {
          select: {
            results: true,
          },
        },
        hubspotImportBatches: {
          orderBy: { createdAt: "desc" },
          select: { status: true },
        },
      },
    }),
    getRunFilterOptions({
      userId: input.userId,
      role: input.role,
    }),
  ]);

  return {
    items: runRequests.map((runRequest) => ({
      id: runRequest.id,
      name: runRequest.name,
      query: runRequest.query,
      target: runRequest.target,
      status: toRunRequestStatus(runRequest.status),
      lastError: runRequest.lastError,
      createdAt: runRequest.createdAt.toISOString(),
      updatedAt: runRequest.updatedAt.toISOString(),
      startedAt: runRequest.startedAt?.toISOString() ?? null,
      completedAt: runRequest.completedAt?.toISOString() ?? null,
      resultCount: runRequest._count.results,
      hubspotSyncStatus: selectRunHubspotSyncStatus(runRequest.hubspotImportBatches),
      metadata: toRunMetadata(runRequest),
    })),
    filterOptions,
  };
}

export async function getRunStatus(input: {
  runId: string;
  userId: string;
  role: "admin" | "user";
}): Promise<RunStatusResponse> {
  const runRequest = await prisma.runRequest.findUnique({
    where: {
      id: input.runId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      name: true,
      query: true,
      target: true,
      status: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      ...runMetadataSelect,
      results: {
        orderBy: {
          rank: "asc",
        },
        select: {
          id: true,
          channelId: true,
          rank: true,
          source: true,
          rating: true,
          ratedAt: true,
          createdAt: true,
          channel: {
            select: {
              id: true,
              youtubeChannelId: true,
              title: true,
              handle: true,
              thumbnailUrl: true,
            },
          },
        },
      },
      channelAssessments: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!runRequest) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && runRequest.requestedByUserId !== input.userId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "Forbidden");
  }

  return {
    id: runRequest.id,
    requestedByUserId: runRequest.requestedByUserId,
    name: runRequest.name,
    query: runRequest.query,
    target: runRequest.target,
    status: toRunRequestStatus(runRequest.status),
    lastError: runRequest.lastError,
    createdAt: runRequest.createdAt.toISOString(),
    updatedAt: runRequest.updatedAt.toISOString(),
    startedAt: runRequest.startedAt?.toISOString() ?? null,
    completedAt: runRequest.completedAt?.toISOString() ?? null,
    metadata: toRunMetadata(runRequest),
    results: runRequest.results.map((result) => ({
      id: result.id,
      channelId: result.channelId,
      rank: result.rank,
      source: toRunResultSource(result.source),
      rating: result.rating,
      ratedAt: result.ratedAt?.toISOString() ?? null,
      createdAt: result.createdAt.toISOString(),
      channel: {
        id: result.channel.id,
        youtubeChannelId: result.channel.youtubeChannelId,
        title: result.channel.title,
        handle: result.channel.handle,
        thumbnailUrl: result.channel.thumbnailUrl,
      },
    })),
    assessments: runRequest.channelAssessments.map(toRunChannelAssessmentItem),
  };
}

export async function updateRunResultRating(input: {
  runId: string;
  resultId: string;
  userId: string;
  role: "admin" | "user";
  rating: number | null;
}): Promise<UpdateRunResultRatingResponse> {
  if (
    input.rating !== null &&
    (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
  ) {
    throw new ServiceError("RUN_RESULT_RATING_INVALID", 400, "Rating must be between 1 and 5");
  }

  const runResult = await prisma.runResult.findUnique({
    where: {
      id: input.resultId,
    },
    select: {
      id: true,
      runRequestId: true,
      channelId: true,
      runRequest: {
        select: {
          requestedByUserId: true,
          status: true,
        },
      },
    },
  });

  if (!runResult || runResult.runRequestId !== input.runId) {
    throw new ServiceError("RUN_RESULT_NOT_FOUND", 404, "Run result not found");
  }

  if (input.role !== "admin" && runResult.runRequest.requestedByUserId !== input.userId) {
    throw new ServiceError("RUN_RESULT_FORBIDDEN", 403, "Forbidden");
  }

  if (runResult.runRequest.status !== PrismaRunRequestStatus.COMPLETED) {
    throw new ServiceError(
      "RUN_RESULT_RATING_NOT_READY",
      409,
      "Channels can be rated after the scouting run completes",
    );
  }

  const ratedAt = input.rating === null ? null : new Date();
  const updated = await prisma.runResult.update({
    where: {
      id: runResult.id,
    },
    data: {
      rating: input.rating,
      ratedAt,
      ratedByUserId: input.rating === null ? null : input.userId,
    },
    select: {
      id: true,
      runRequestId: true,
      channelId: true,
      rating: true,
      ratedAt: true,
    },
  });

  return {
    runId: updated.runRequestId,
    resultId: updated.id,
    channelId: updated.channelId,
    rating: updated.rating,
    ratedAt: updated.ratedAt?.toISOString() ?? null,
  };
}

async function enqueueAutomaticRunAssessmentJobs(input: {
  runRequestId: string;
  requestedByUserId: string;
  channelIds: readonly string[];
}): Promise<void> {
  for (const channelId of input.channelIds) {
    try {
      await enqueueJob("runs.assess.channel-fit", {
        runRequestId: input.runRequestId,
        channelId,
        requestedByUserId: input.requestedByUserId,
      });
    } catch (error) {
      await prisma.runChannelAssessment.update({
        where: {
          runRequestId_channelId: {
            runRequestId: input.runRequestId,
            channelId,
          },
        },
        data: {
          status: PrismaRunChannelAssessmentStatus.FAILED,
          lastError: formatErrorMessage(error),
        },
      });
    }
  }

  await finalizeRunAssessmentRankingIfReady({
    runRequestId: input.runRequestId,
  });
}

export async function finalizeRunAssessmentRankingIfReady(input: {
  runRequestId: string;
}): Promise<void> {
  const runRequest = await prisma.runRequest.findUnique({
    where: {
      id: input.runRequestId,
    },
    select: {
      id: true,
      status: true,
      target: true,
      results: {
        orderBy: {
          rank: "asc",
        },
        select: {
          id: true,
          channelId: true,
          rank: true,
        },
      },
      channelAssessments: {
        select: {
          channelId: true,
          status: true,
          fitScore: true,
        },
      },
    },
  });

  if (!runRequest || runRequest.status !== PrismaRunRequestStatus.RUNNING) {
    return;
  }

  if (runRequest.results.length === 0) {
    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.COMPLETED,
        completedAt: new Date(),
        lastError: null,
      },
    });
    return;
  }

  if (runRequest.channelAssessments.length === 0) {
    return;
  }

  const pendingAssessment = runRequest.channelAssessments.some(
    (assessment) =>
      assessment.status === PrismaRunChannelAssessmentStatus.QUEUED ||
      assessment.status === PrismaRunChannelAssessmentStatus.RUNNING,
  );

  if (pendingAssessment) {
    return;
  }

  const assessmentByChannelId = new Map(
    runRequest.channelAssessments.map((assessment) => [assessment.channelId, assessment] as const),
  );
  const rankedResults = runRequest.results
    .map((result) => {
      const assessment = assessmentByChannelId.get(result.channelId);
      const fitScore =
        assessment?.status === PrismaRunChannelAssessmentStatus.COMPLETED &&
        typeof assessment.fitScore === "number"
          ? assessment.fitScore
          : null;

      return {
        ...result,
        fitScore,
      };
    })
    .sort((left, right) => {
      if (left.fitScore !== null && right.fitScore !== null && left.fitScore !== right.fitScore) {
        return right.fitScore - left.fitScore;
      }

      if (left.fitScore !== null && right.fitScore === null) {
        return -1;
      }

      if (left.fitScore === null && right.fitScore !== null) {
        return 1;
      }

      return left.rank - right.rank;
    });
  const eligibleResults = rankedResults.filter(
    (result) => result.fitScore !== null && result.fitScore >= MIN_AUTOMATIC_FIT_SCORE,
  );
  const target = runRequest.target && runRequest.target > 0 ? runRequest.target : eligibleResults.length;
  const selectedResults = eligibleResults.slice(0, target);
  const selectedResultIds = selectedResults.map((result) => result.id);

  await prisma.$transaction(async (tx) => {
    await tx.runResult.deleteMany({
      where: selectedResultIds.length > 0
        ? {
            runRequestId: runRequest.id,
            id: {
              notIn: selectedResultIds,
            },
          }
        : {
            runRequestId: runRequest.id,
          },
    });

    for (const [index, result] of selectedResults.entries()) {
      await tx.runResult.update({
        where: {
          id: result.id,
        },
        data: {
          rank: index + 1,
        },
      });
    }

    await tx.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.COMPLETED,
        completedAt: new Date(),
        lastError: null,
      },
    });
  });
}

export async function executeRunDiscover(input: {
  runRequestId: string;
  requestedByUserId: string;
}): Promise<void> {
  const runRequest = await prisma.runRequest.findUnique({
    where: {
      id: input.runRequestId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      status: true,
      query: true,
      target: true,
      clientIndustry: true,
      campaignObjective: true,
      targetAudienceAge: true,
      targetAudienceGender: true,
      targetGeographies: true,
      contentRestrictions: true,
      budgetTier: true,
      deliverables: true,
    },
  });

  if (!runRequest) {
    return;
  }

  if (runRequest.requestedByUserId !== input.requestedByUserId) {
    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.FAILED,
        lastError: "Run payload user mismatch",
        completedAt: new Date(),
      },
    });
    return;
  }

  if (
    runRequest.status === PrismaRunRequestStatus.RUNNING ||
    runRequest.status === PrismaRunRequestStatus.COMPLETED
  ) {
    return;
  }

  const claimed = await prisma.runRequest.updateMany({
    where: {
      id: runRequest.id,
      status: {
        in: [PrismaRunRequestStatus.QUEUED, PrismaRunRequestStatus.FAILED],
      },
    },
    data: {
      status: PrismaRunRequestStatus.RUNNING,
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    const catalogCandidates = await getCatalogCandidatesForQuery(runRequest.query);
    const isStructuredCatalogRun = isCatalogScoutingQuery(runRequest.query);
    const shouldAutoAssess =
      isStructuredCatalogRun &&
      hasAutomaticAssessmentBrief(runRequest) &&
      catalogCandidates.length > 0;
    const rankedResults: RankedRunResult[] = isStructuredCatalogRun
      ? catalogCandidates
          .slice(
            0,
            shouldAutoAssess ? catalogCandidates.length : runRequest.target ?? catalogCandidates.length,
          )
          .map((channel) => ({
            channelId: channel.id,
            source: PrismaRunResultSource.CATALOG,
          }))
      : await (async () => {
          const youtubeKey = await getUserYoutubeApiKey(input.requestedByUserId);

          if (!youtubeKey) {
            throw new ServiceError(
              "YOUTUBE_KEY_REQUIRED",
              400,
              "Assigned YouTube API key is required for discovery",
            );
          }

          const catalogCandidateIds = new Set(catalogCandidates.map((candidate) => candidate.id));
          const MAX_RESULTS = 50;
          const now = new Date();
          const cacheKey = buildDiscoveryCacheKey(
            runRequest.query,
            input.requestedByUserId,
            MAX_RESULTS,
          );
          const cacheHit = await prisma.youtubeDiscoveryCache.findUnique({
            where: {
              cacheKey,
            },
            select: {
              payload: true,
              expiresAt: true,
            },
          });

          let discovered: YoutubeDiscoveredChannel[];

          if (cacheHit && cacheHit.expiresAt > now) {
            discovered = cacheHit.payload as YoutubeDiscoveredChannel[];
            logProviderSpend({
              provider: "youtube_discovery",
              operation: "discover_channels",
              outcome: "cache_hit",
              retryAttempt: false,
              durationMs: 0,
            });
          } else {
            const providerCallStartedAt = Date.now();

            try {
              const rawDiscovered = await discoverYoutubeChannels({
                apiKey: youtubeKey,
                query: runRequest.query,
                maxResults: MAX_RESULTS,
              });

              discovered = rawDiscovered;

              logProviderSpend({
                provider: "youtube_discovery",
                operation: "discover_channels",
                outcome: "fresh_call",
                retryAttempt: false,
                durationMs: Date.now() - providerCallStartedAt,
              });

              const expiresAt = new Date(
                Date.now() + YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES * 60 * 1000,
              );

              await prisma.youtubeDiscoveryCache.upsert({
                where: {
                  cacheKey,
                },
                create: {
                  cacheKey,
                  userId: input.requestedByUserId,
                  query: runRequest.query,
                  maxResults: MAX_RESULTS,
                  payload: toJsonValue(rawDiscovered),
                  fetchedAt: now,
                  expiresAt,
                },
                update: {
                  payload: toJsonValue(rawDiscovered),
                  fetchedAt: now,
                  expiresAt,
                },
              });
            } catch (error) {
              logProviderSpend({
                provider: "youtube_discovery",
                operation: "discover_channels",
                outcome: "error",
                retryAttempt: false,
                durationMs: Date.now() - providerCallStartedAt,
              });

              if (isYoutubeDiscoveryProviderError(error)) {
                throw new ServiceError(error.code, error.status, error.message);
              }

              throw error;
            }
          }

          const existingDiscoveredChannels = await prisma.channel.findMany({
            where: {
              youtubeChannelId: {
                in: discovered.map((channel) => channel.youtubeChannelId),
              },
            },
            select: {
              id: true,
              youtubeChannelId: true,
            },
          });
          const existingDiscoveredChannelIds = new Set(
            existingDiscoveredChannels.map((channel) => channel.id),
          );
          const additionalCatalogChannelIds: string[] = [];
          const addedAdditionalCatalog = new Set<string>();
          const discoveryOnlyChannelIds: string[] = [];
          const addedDiscoveryOnly = new Set<string>();

          for (const channel of discovered) {
            const upserted = await upsertChannelSkeleton(channel);

            if (catalogCandidateIds.has(upserted.id)) {
              continue;
            }

            if (existingDiscoveredChannelIds.has(upserted.id)) {
              if (addedAdditionalCatalog.has(upserted.id)) {
                continue;
              }

              addedAdditionalCatalog.add(upserted.id);
              additionalCatalogChannelIds.push(upserted.id);
              continue;
            }

            if (addedDiscoveryOnly.has(upserted.id)) {
              continue;
            }

            addedDiscoveryOnly.add(upserted.id);
            discoveryOnlyChannelIds.push(upserted.id);
          }

          return [
            ...catalogCandidates.map((channelId) => ({
              channelId: channelId.id,
              source: PrismaRunResultSource.CATALOG,
            })),
            ...additionalCatalogChannelIds.map((channelId) => ({
              channelId,
              source: PrismaRunResultSource.CATALOG,
            })),
            ...discoveryOnlyChannelIds.map((channelId) => ({
              channelId,
              source: PrismaRunResultSource.DISCOVERY,
            })),
          ];
        })();

    await prisma.$transaction(async (tx) => {
      await tx.runResult.deleteMany({
        where: {
          runRequestId: runRequest.id,
        },
      });
      await tx.runChannelAssessment.deleteMany({
        where: {
          runRequestId: runRequest.id,
        },
      });

      if (rankedResults.length > 0) {
        await tx.runResult.createMany({
          data: rankedResults.map((result, index) => ({
            runRequestId: runRequest.id,
            channelId: result.channelId,
            rank: index + 1,
            source: result.source,
          })),
        });
      }

      if (shouldAutoAssess) {
        await tx.runChannelAssessment.createMany({
          data: rankedResults.map((result) => ({
            runRequestId: runRequest.id,
            channelId: result.channelId,
            status: PrismaRunChannelAssessmentStatus.QUEUED,
          })),
        });
      }

      await tx.runRequest.update({
        where: {
          id: runRequest.id,
        },
        data: {
          status: shouldAutoAssess
            ? PrismaRunRequestStatus.RUNNING
            : PrismaRunRequestStatus.COMPLETED,
          completedAt: shouldAutoAssess ? null : new Date(),
          lastError: null,
        },
      });
    });

    if (shouldAutoAssess) {
      await enqueueAutomaticRunAssessmentJobs({
        runRequestId: runRequest.id,
        requestedByUserId: input.requestedByUserId,
        channelIds: rankedResults.map((result) => result.channelId),
      });
    }
  } catch (error) {
    await prisma.runRequest.update({
      where: {
        id: runRequest.id,
      },
      data: {
        status: PrismaRunRequestStatus.FAILED,
        completedAt: new Date(),
        lastError: formatErrorMessage(error),
      },
    });
    throw error;
  }
}
