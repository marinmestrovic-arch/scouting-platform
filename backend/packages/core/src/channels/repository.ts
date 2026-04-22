import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  ChannelManualOverrideField as PrismaChannelManualOverrideField,
  Prisma,
} from "@prisma/client";
import {
  channelAudienceCountrySchema,
  channelAudienceGenderAgeSchema,
  channelAudienceInterestSchema,
  channelBrandMentionSchema,
  structuredChannelProfileSchema,
  type ChannelAdvancedReportDetail as ContractChannelAdvancedReportDetail,
  type ChannelAdvancedReportStatus,
  type ChannelAdvancedReportSummary as ContractChannelAdvancedReportSummary,
  type ChannelEnrichmentStatus as ContractChannelEnrichmentStatus,
  type ChannelInsights as ContractChannelInsights,
  type ChannelManualOverrideField,
  type ChannelManualOverrideOperation,
  type LatestCompletedAdvancedReport,
  type PatchChannelManualOverridesResponse,
  type StructuredChannelProfile,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

import {
  toLatestCompletedAdvancedReport,
  resolveChannelAdvancedReportStatus,
} from "../approvals/status";
import { ServiceError } from "../errors";
import {
  CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS,
  resolveChannelEnrichmentStatus,
} from "../enrichment/status";

export type ListChannelsInput = {
  page: number;
  pageSize: number;
  query?: string;
  countryRegion?: string[];
  influencerVertical?: string[];
  influencerType?: string[];
  youtubeVideoMedianViewsMin?: number;
  youtubeVideoMedianViewsMax?: number;
  youtubeShortsMedianViewsMin?: number;
  youtubeShortsMedianViewsMax?: number;
  youtubeFollowersMin?: number;
  youtubeFollowersMax?: number;
  enrichmentStatus?: ContractChannelEnrichmentStatus[];
  advancedReportStatus?: ChannelAdvancedReportStatus[];
};

export type ChannelEnrichmentSummary = {
  status: ContractChannelEnrichmentStatus;
  updatedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
};

export type ChannelEnrichmentDetail = ChannelEnrichmentSummary & {
  summary: string | null;
  topics: string[] | null;
  brandFitNotes: string | null;
  confidence: number | null;
  structuredProfile: StructuredChannelProfile | null;
};

export type ChannelAdvancedReportSummary = ContractChannelAdvancedReportSummary;
export type ChannelAdvancedReportDetail = ContractChannelAdvancedReportDetail;
export type ChannelInsights = ContractChannelInsights;

export type ChannelSummary = {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  youtubeUrl: string | null;
  socialMediaLink: string | null;
  platforms: string[];
  countryRegion: string | null;
  email: string | null;
  influencerVertical: string | null;
  influencerType: string | null;
  youtubeEngagementRate: number | null;
  youtubeFollowers: string | null;
  youtubeVideoMedianViews: string | null;
  youtubeShortsMedianViews: string | null;
  thumbnailUrl: string | null;
  enrichment: ChannelEnrichmentSummary;
  advancedReport: ChannelAdvancedReportSummary;
};

export type ChannelDetail = ChannelSummary & {
  description: string | null;
  createdAt: string;
  updatedAt: string;
  enrichment: ChannelEnrichmentDetail;
  advancedReport: ChannelAdvancedReportDetail;
  insights: ChannelInsights;
};

type MutableChannelField = "title" | "handle" | "description" | "thumbnailUrl";

type MutableChannelValues = {
  title: string;
  handle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
};

type ManualOverrideFieldConfig = {
  contractField: ChannelManualOverrideField;
  prismaField: PrismaChannelManualOverrideField;
  channelField: MutableChannelField;
  nullable: boolean;
};

type LatestAdvancedReportRow = {
  id: string;
  status: PrismaAdvancedReportRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  decisionNote: string | null;
};

type ChannelInsightsRow = {
  audienceCountries: Prisma.JsonValue | null;
  audienceGenderAge: Prisma.JsonValue | null;
  audienceInterests: Prisma.JsonValue | null;
  estimatedPriceCurrencyCode: string | null;
  estimatedPriceMin: number | null;
  estimatedPriceMax: number | null;
  brandMentions: Prisma.JsonValue | null;
};

const channelEnrichmentListSelect = {
  status: true,
  updatedAt: true,
  completedAt: true,
  lastError: true,
} as const;

const channelEnrichmentDetailSelect = {
  ...channelEnrichmentListSelect,
  summary: true,
  topics: true,
  brandFitNotes: true,
  confidence: true,
  structuredProfile: true,
} as const;

const latestAdvancedReportSelect = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  completedAt: true,
  lastError: true,
  decisionNote: true,
} as const;

const latestCompletedAdvancedReportSelect = {
  id: true,
  completedAt: true,
} as const;

const channelInsightsSelect = {
  audienceCountries: true,
  audienceGenderAge: true,
  audienceInterests: true,
  estimatedPriceCurrencyCode: true,
  estimatedPriceMin: true,
  estimatedPriceMax: true,
  brandMentions: true,
} as const;

const channelListSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  youtubeUrl: true,
  thumbnailUrl: true,
  influencerType: true,
  influencerVertical: true,
  countryRegion: true,
  updatedAt: true,
  metrics: {
    select: {
      youtubeEngagementRate: true,
      youtubeFollowers: true,
      youtubeVideoMedianViews: true,
      youtubeShortsMedianViews: true,
    },
  },
  contacts: {
    orderBy: {
      createdAt: "asc",
    },
    take: 1,
    select: {
      email: true,
    },
  },
  enrichment: {
    select: {
      ...channelEnrichmentListSelect,
      topics: true,
    },
  },
  insights: {
    select: {
      audienceCountries: true,
    },
  },
  advancedReportRequests: {
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
    select: latestAdvancedReportSelect,
  },
} as const;

const channelDetailSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  youtubeUrl: true,
  description: true,
  thumbnailUrl: true,
  influencerType: true,
  influencerVertical: true,
  countryRegion: true,
  createdAt: true,
  updatedAt: true,
  metrics: {
    select: {
      youtubeEngagementRate: true,
      youtubeFollowers: true,
      youtubeVideoMedianViews: true,
      youtubeShortsMedianViews: true,
    },
  },
  contacts: {
    orderBy: {
      createdAt: "asc",
    },
    take: 1,
    select: {
      email: true,
    },
  },
  enrichment: {
    select: channelEnrichmentDetailSelect,
  },
  insights: {
    select: channelInsightsSelect,
  },
  advancedReportRequests: {
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
    select: latestAdvancedReportSelect,
  },
} as const;

const manualOverrideFieldConfigs: Record<ChannelManualOverrideField, ManualOverrideFieldConfig> = {
  title: {
    contractField: "title",
    prismaField: PrismaChannelManualOverrideField.TITLE,
    channelField: "title",
    nullable: false,
  },
  handle: {
    contractField: "handle",
    prismaField: PrismaChannelManualOverrideField.HANDLE,
    channelField: "handle",
    nullable: true,
  },
  description: {
    contractField: "description",
    prismaField: PrismaChannelManualOverrideField.DESCRIPTION,
    channelField: "description",
    nullable: true,
  },
  thumbnailUrl: {
    contractField: "thumbnailUrl",
    prismaField: PrismaChannelManualOverrideField.THUMBNAIL_URL,
    channelField: "thumbnailUrl",
    nullable: true,
  },
};

const manualOverrideConfigByPrismaField = new Map<
  PrismaChannelManualOverrideField,
  ManualOverrideFieldConfig
>(Object.values(manualOverrideFieldConfigs).map((config) => [config.prismaField, config]));

function getManualOverrideConfigByContractField(
  field: ChannelManualOverrideField,
): ManualOverrideFieldConfig {
  return manualOverrideFieldConfigs[field];
}

function getManualOverrideConfigByPrismaField(
  field: PrismaChannelManualOverrideField,
): ManualOverrideFieldConfig {
  const config = manualOverrideConfigByPrismaField.get(field);

  if (!config) {
    throw new ServiceError("INVALID_OVERRIDE_FIELD", 500, "Invalid manual override field");
  }

  return config;
}

function getMutableChannelFieldValue(
  source: MutableChannelValues,
  field: MutableChannelField,
): string | null {
  return source[field];
}

function setMutableChannelFieldValue(
  target: Prisma.ChannelUpdateInput,
  field: MutableChannelField,
  value: string | null,
): void {
  if (field === "title") {
    if (value === null) {
      throw new ServiceError("INVALID_OVERRIDE_VALUE", 400, "Title cannot be null");
    }

    target.title = value;
    return;
  }

  if (field === "handle") {
    target.handle = value;
    return;
  }

  if (field === "description") {
    target.description = value;
    return;
  }

  target.thumbnailUrl = value;
}

function normalizeManualSetValue(
  operation: Extract<ChannelManualOverrideOperation, { op: "set" }>,
): string | null {
  const config = getManualOverrideConfigByContractField(operation.field);
  const rawValue = operation.value;

  if (rawValue === null) {
    if (!config.nullable) {
      throw new ServiceError(
        "INVALID_OVERRIDE_VALUE",
        400,
        `${operation.field} override cannot be null`,
      );
    }

    return null;
  }

  const value = rawValue.trim();

  if (!value) {
    throw new ServiceError(
      "INVALID_OVERRIDE_VALUE",
      400,
      `${operation.field} override cannot be empty`,
    );
  }

  return value;
}

function toTopics(topics: Prisma.JsonValue | null): string[] | null {
  if (!Array.isArray(topics)) {
    return null;
  }

  const normalized: string[] = [];

  for (const topic of topics) {
    if (typeof topic !== "string") {
      return null;
    }

    const trimmed = topic.trim();

    if (trimmed) {
      normalized.push(trimmed);
    }
  }

  return normalized;
}

function toStructuredChannelProfile(value: Prisma.JsonValue | null): StructuredChannelProfile | null {
  const parsed = structuredChannelProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toChannelEnrichmentSummary(
  channelUpdatedAt: Date,
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
  } | null,
): ChannelEnrichmentSummary {
  return {
    status: resolveChannelEnrichmentStatus({
      channelUpdatedAt,
      enrichment,
    }),
    updatedAt: enrichment?.updatedAt.toISOString() ?? null,
    completedAt: enrichment?.completedAt?.toISOString() ?? null,
    lastError: enrichment?.lastError ?? null,
  };
}

function toChannelEnrichmentDetail(
  channelUpdatedAt: Date,
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
    summary: string | null;
    topics: Prisma.JsonValue | null;
    brandFitNotes: string | null;
    confidence: number | null;
    structuredProfile: Prisma.JsonValue | null;
  } | null,
): ChannelEnrichmentDetail {
  const base = toChannelEnrichmentSummary(channelUpdatedAt, enrichment);

  return {
    ...base,
    summary: enrichment?.summary ?? null,
    topics: enrichment ? toTopics(enrichment.topics) : null,
    brandFitNotes: enrichment?.brandFitNotes ?? null,
    confidence: enrichment?.confidence ?? null,
    structuredProfile: enrichment ? toStructuredChannelProfile(enrichment.structuredProfile) : null,
  };
}

function toAudienceCountries(value: Prisma.JsonValue | null) {
  const parsed = channelAudienceCountrySchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function toAudienceGenderAge(value: Prisma.JsonValue | null) {
  const parsed = channelAudienceGenderAgeSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function toAudienceInterests(value: Prisma.JsonValue | null) {
  const parsed = channelAudienceInterestSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function toBrandMentions(value: Prisma.JsonValue | null) {
  const parsed = channelBrandMentionSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function toNullableBigIntString(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function resolveSocialMediaLink(channel: {
  youtubeChannelId: string;
  youtubeUrl: string | null;
  handle: string | null;
}): string {
  const youtubeUrl = channel.youtubeUrl?.trim();

  if (youtubeUrl) {
    return youtubeUrl;
  }

  const handle = channel.handle?.trim();

  if (handle?.startsWith("@")) {
    return `https://www.youtube.com/${handle}`;
  }

  return `https://www.youtube.com/channel/${channel.youtubeChannelId}`;
}

function toChannelInsights(row: ChannelInsightsRow | null): ChannelInsights {
  return {
    audienceCountries: row ? toAudienceCountries(row.audienceCountries) : [],
    audienceGenderAge: row ? toAudienceGenderAge(row.audienceGenderAge) : [],
    audienceInterests: row ? toAudienceInterests(row.audienceInterests) : [],
    estimatedPrice:
      row &&
      (row.estimatedPriceCurrencyCode ||
        row.estimatedPriceMin !== null ||
        row.estimatedPriceMax !== null)
        ? {
            currencyCode: row.estimatedPriceCurrencyCode,
            min: row.estimatedPriceMin,
            max: row.estimatedPriceMax,
          }
        : null,
    brandMentions: row ? toBrandMentions(row.brandMentions) : [],
  };
}

function toChannelAdvancedReportSummary(
  advancedReportRequest: LatestAdvancedReportRow | null,
): ChannelAdvancedReportSummary {
  return {
    requestId: advancedReportRequest?.id ?? null,
    status: resolveChannelAdvancedReportStatus({
      request: advancedReportRequest,
    }),
    updatedAt: advancedReportRequest?.updatedAt.toISOString() ?? null,
    completedAt: advancedReportRequest?.completedAt?.toISOString() ?? null,
    lastError: advancedReportRequest?.lastError ?? null,
  };
}

function toChannelAdvancedReportDetail(
  advancedReportRequest: LatestAdvancedReportRow | null,
  lastCompletedReport: LatestCompletedAdvancedReport | null,
): ChannelAdvancedReportDetail {
  const base = toChannelAdvancedReportSummary(advancedReportRequest);

  return {
    ...base,
    requestedAt: advancedReportRequest?.createdAt.toISOString() ?? null,
    reviewedAt: advancedReportRequest?.reviewedAt?.toISOString() ?? null,
    decisionNote: advancedReportRequest?.decisionNote ?? null,
    lastCompletedReport,
  };
}

function toChannelSummary(channel: {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  youtubeUrl: string | null;
  thumbnailUrl: string | null;
  influencerType: string | null;
  influencerVertical: string | null;
  countryRegion: string | null;
  updatedAt: Date;
  metrics: {
    youtubeEngagementRate: number | null;
    youtubeFollowers: bigint | null;
    youtubeVideoMedianViews: bigint | null;
    youtubeShortsMedianViews: bigint | null;
  } | null;
  contacts: Array<{
    email: string;
  }>;
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
    topics: Prisma.JsonValue | null;
  } | null;
  insights: {
    audienceCountries: Prisma.JsonValue | null;
  } | null;
  advancedReportRequests: LatestAdvancedReportRow[];
}): ChannelSummary {
  const audienceCountries = toAudienceCountries(channel.insights?.audienceCountries ?? null);
  const primaryCountry =
    audienceCountries.slice().sort((left, right) => right.percentage - left.percentage)[0]?.countryName ?? null;
  const topics = Array.isArray(channel.enrichment?.topics)
    ? channel.enrichment.topics.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];

  return {
    id: channel.id,
    youtubeChannelId: channel.youtubeChannelId,
    title: channel.title,
    handle: channel.handle,
    youtubeUrl: channel.youtubeUrl,
    socialMediaLink: resolveSocialMediaLink(channel),
    platforms: ["YouTube"],
    countryRegion: channel.countryRegion ?? primaryCountry,
    email: channel.contacts[0]?.email ?? null,
    influencerVertical: channel.influencerVertical ?? topics[0] ?? null,
    influencerType: channel.influencerType,
    youtubeEngagementRate: channel.metrics?.youtubeEngagementRate ?? null,
    youtubeFollowers: toNullableBigIntString(channel.metrics?.youtubeFollowers),
    youtubeVideoMedianViews: toNullableBigIntString(channel.metrics?.youtubeVideoMedianViews),
    youtubeShortsMedianViews: toNullableBigIntString(channel.metrics?.youtubeShortsMedianViews),
    thumbnailUrl: channel.thumbnailUrl,
    enrichment: toChannelEnrichmentSummary(channel.updatedAt, channel.enrichment),
    advancedReport: toChannelAdvancedReportSummary(channel.advancedReportRequests[0] ?? null),
  };
}

function toChannelDetail(channel: {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  youtubeUrl: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  influencerType: string | null;
  influencerVertical: string | null;
  countryRegion: string | null;
  createdAt: Date;
  updatedAt: Date;
  metrics: {
    youtubeEngagementRate: number | null;
    youtubeFollowers: bigint | null;
    youtubeVideoMedianViews: bigint | null;
    youtubeShortsMedianViews: bigint | null;
  } | null;
  contacts: Array<{
    email: string;
  }>;
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
    summary: string | null;
    topics: Prisma.JsonValue | null;
    brandFitNotes: string | null;
    confidence: number | null;
    structuredProfile: Prisma.JsonValue | null;
  } | null;
  insights: ChannelInsightsRow | null;
  advancedReportRequests: LatestAdvancedReportRow[];
}, lastCompletedReport: LatestCompletedAdvancedReport | null): ChannelDetail {
  return {
    ...toChannelSummary(channel),
    description: channel.description,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    enrichment: toChannelEnrichmentDetail(channel.updatedAt, channel.enrichment),
    advancedReport: toChannelAdvancedReportDetail(
      channel.advancedReportRequests[0] ?? null,
      lastCompletedReport,
    ),
    insights: toChannelInsights(channel.insights),
  };
}

type ChannelDbClient = Prisma.TransactionClient | typeof prisma;
type ChannelListIdRow = {
  id: string;
};
type ChannelCountRow = {
  total: bigint;
};

function buildChannelListSearchWhereSql(query: string | undefined): Prisma.Sql {
  if (!query) {
    return Prisma.empty;
  }

  const normalizedQuery = `%${query}%`;

  return Prisma.sql`
    AND (
      c.title ILIKE ${normalizedQuery}
      OR c.handle ILIKE ${normalizedQuery}
      OR c.youtube_channel_id ILIKE ${normalizedQuery}
    )
  `;
}

function normalizeTextFilterValues(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function hasMetricRangeFilters(input: ListChannelsInput): boolean {
  return (
    input.youtubeVideoMedianViewsMin !== undefined ||
    input.youtubeVideoMedianViewsMax !== undefined ||
    input.youtubeShortsMedianViewsMin !== undefined ||
    input.youtubeShortsMedianViewsMax !== undefined ||
    input.youtubeFollowersMin !== undefined ||
    input.youtubeFollowersMax !== undefined
  );
}

function toBigIntRangeBound(value: number | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}

function buildMetricRangeFilter(
  min: number | undefined,
  max: number | undefined,
): Prisma.BigIntNullableFilter | undefined {
  const filter: Prisma.BigIntNullableFilter = {};
  const minValue = toBigIntRangeBound(min);
  const maxValue = toBigIntRangeBound(max);

  if (minValue !== undefined) {
    filter.gte = minValue;
  }

  if (maxValue !== undefined) {
    filter.lte = maxValue;
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

function buildChannelListWhere(input: ListChannelsInput): Prisma.ChannelWhereInput | undefined {
  const query = input.query?.trim();
  const countryRegion = normalizeTextFilterValues(input.countryRegion);
  const influencerVertical = normalizeTextFilterValues(input.influencerVertical);
  const influencerType = normalizeTextFilterValues(input.influencerType);
  const filters: Prisma.ChannelWhereInput[] = [];

  if (query) {
    filters.push({
      OR: [
        {
          title: {
            contains: query,
            mode: "insensitive",
          },
        },
        {
          handle: {
            contains: query,
            mode: "insensitive",
          },
        },
        {
          youtubeChannelId: {
            contains: query,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  if (countryRegion.length > 0) {
    filters.push({
      countryRegion: {
        in: countryRegion,
      },
    });
  }

  if (influencerVertical.length > 0) {
    filters.push({
      influencerVertical: {
        in: influencerVertical,
      },
    });
  }

  if (influencerType.length > 0) {
    filters.push({
      influencerType: {
        in: influencerType,
      },
    });
  }

  if (hasMetricRangeFilters(input)) {
    const metricWhere: Prisma.ChannelMetricWhereInput = {};
    const videoMedianRange = buildMetricRangeFilter(
      input.youtubeVideoMedianViewsMin,
      input.youtubeVideoMedianViewsMax,
    );
    const shortsMedianRange = buildMetricRangeFilter(
      input.youtubeShortsMedianViewsMin,
      input.youtubeShortsMedianViewsMax,
    );
    const followersRange = buildMetricRangeFilter(input.youtubeFollowersMin, input.youtubeFollowersMax);

    if (videoMedianRange) {
      metricWhere.youtubeVideoMedianViews = videoMedianRange;
    }

    if (shortsMedianRange) {
      metricWhere.youtubeShortsMedianViews = shortsMedianRange;
    }

    if (followersRange) {
      metricWhere.youtubeFollowers = followersRange;
    }

    filters.push({
      metrics: {
        is: metricWhere,
      },
    });
  }

  return filters.length > 0
    ? {
        AND: filters,
      }
    : undefined;
}

function buildChannelListCreatorFilterJoinSql(input: ListChannelsInput): Prisma.Sql {
  return hasMetricRangeFilters(input)
    ? Prisma.sql`
        INNER JOIN channel_metrics cm
          ON cm.channel_id = c.id
      `
    : Prisma.empty;
}

function buildChannelListCreatorFilterWhereSql(input: ListChannelsInput): Prisma.Sql {
  const countryRegion = normalizeTextFilterValues(input.countryRegion);
  const influencerVertical = normalizeTextFilterValues(input.influencerVertical);
  const influencerType = normalizeTextFilterValues(input.influencerType);
  const countryRegionFilter =
    countryRegion.length > 0
      ? Prisma.sql`AND c.country_region = ANY(ARRAY[${Prisma.join(countryRegion)}]::text[])`
      : Prisma.empty;
  const influencerVerticalFilter =
    influencerVertical.length > 0
      ? Prisma.sql`AND c.influencer_vertical = ANY(ARRAY[${Prisma.join(influencerVertical)}]::text[])`
      : Prisma.empty;
  const influencerTypeFilter =
    influencerType.length > 0
      ? Prisma.sql`AND c.influencer_type = ANY(ARRAY[${Prisma.join(influencerType)}]::text[])`
      : Prisma.empty;
  const videoMedianMinFilter =
    input.youtubeVideoMedianViewsMin !== undefined
      ? Prisma.sql`AND cm.youtube_video_median_views >= ${BigInt(input.youtubeVideoMedianViewsMin)}`
      : Prisma.empty;
  const videoMedianMaxFilter =
    input.youtubeVideoMedianViewsMax !== undefined
      ? Prisma.sql`AND cm.youtube_video_median_views <= ${BigInt(input.youtubeVideoMedianViewsMax)}`
      : Prisma.empty;
  const shortsMedianMinFilter =
    input.youtubeShortsMedianViewsMin !== undefined
      ? Prisma.sql`AND cm.youtube_shorts_median_views >= ${BigInt(input.youtubeShortsMedianViewsMin)}`
      : Prisma.empty;
  const shortsMedianMaxFilter =
    input.youtubeShortsMedianViewsMax !== undefined
      ? Prisma.sql`AND cm.youtube_shorts_median_views <= ${BigInt(input.youtubeShortsMedianViewsMax)}`
      : Prisma.empty;
  const followersMinFilter =
    input.youtubeFollowersMin !== undefined
      ? Prisma.sql`AND cm.youtube_followers >= ${BigInt(input.youtubeFollowersMin)}`
      : Prisma.empty;
  const followersMaxFilter =
    input.youtubeFollowersMax !== undefined
      ? Prisma.sql`AND cm.youtube_followers <= ${BigInt(input.youtubeFollowersMax)}`
      : Prisma.empty;

  return Prisma.sql`
    ${countryRegionFilter}
    ${influencerVerticalFilter}
    ${influencerTypeFilter}
    ${videoMedianMinFilter}
    ${videoMedianMaxFilter}
    ${shortsMedianMinFilter}
    ${shortsMedianMaxFilter}
    ${followersMinFilter}
    ${followersMaxFilter}
  `;
}

function buildChannelListResolvedStatusWhereSql(input: {
  enrichmentStatus?: ContractChannelEnrichmentStatus[];
  advancedReportStatus?: ChannelAdvancedReportStatus[];
}): Prisma.Sql {
  const now = new Date();
  const enrichmentStaleThreshold = new Date(
    now.getTime() - CHANNEL_ENRICHMENT_STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const advancedReportFreshThreshold = new Date(
    now.getTime() - 120 * 24 * 60 * 60 * 1000,
  );
  const enrichmentStatusFilter =
    input.enrichmentStatus && input.enrichmentStatus.length > 0
      ? Prisma.sql`
          AND (
            CASE
              WHEN ce.channel_id IS NULL THEN 'missing'
              WHEN ce.status::text = 'stale' THEN 'stale'
              WHEN ce.status::text = 'completed'
                AND (
                  ce.completed_at IS NULL
                  OR c.updated_at > ce.completed_at
                  OR ce.completed_at <= ${enrichmentStaleThreshold}
                ) THEN 'stale'
              WHEN ce.status::text = 'completed' THEN 'completed'
              WHEN ce.status::text = 'running' THEN 'running'
              WHEN ce.status::text = 'failed' THEN 'failed'
              ELSE 'queued'
            END
          ) = ANY(ARRAY[${Prisma.join(input.enrichmentStatus)}]::text[])
        `
      : Prisma.empty;
  const advancedReportStatusFilter =
    input.advancedReportStatus && input.advancedReportStatus.length > 0
      ? Prisma.sql`
          AND (
            CASE
              WHEN latest_arr.status IS NULL THEN 'missing'
              WHEN latest_arr.status = 'completed'
                AND (
                  latest_arr.completed_at IS NULL
                  OR latest_arr.completed_at <= ${advancedReportFreshThreshold}
                ) THEN 'stale'
              ELSE latest_arr.status
            END
          ) = ANY(ARRAY[${Prisma.join(input.advancedReportStatus)}]::text[])
        `
      : Prisma.empty;

  return Prisma.sql`${enrichmentStatusFilter} ${advancedReportStatusFilter}`;
}

function buildChannelListResolvedStatusJoinSql(input: {
  enrichmentStatus?: ContractChannelEnrichmentStatus[];
  advancedReportStatus?: ChannelAdvancedReportStatus[];
}): Prisma.Sql {
  const enrichmentJoin =
    input.enrichmentStatus && input.enrichmentStatus.length > 0
      ? Prisma.sql`
          LEFT JOIN channel_enrichments ce
            ON ce.channel_id = c.id
        `
      : Prisma.empty;
  const advancedReportJoin =
    input.advancedReportStatus && input.advancedReportStatus.length > 0
      ? Prisma.sql`
          LEFT JOIN LATERAL (
            SELECT
              arr.status::text AS status,
              arr.completed_at
            FROM advanced_report_requests arr
            WHERE arr.channel_id = c.id
            ORDER BY arr.created_at DESC, arr.id DESC
            LIMIT 1
          ) latest_arr ON true
        `
      : Prisma.empty;

  return Prisma.sql`${enrichmentJoin} ${advancedReportJoin}`;
}

async function listChannelIdsForResolvedFilters(input: ListChannelsInput): Promise<{
  ids: string[];
  total: number;
}> {
  const query = input.query?.trim();
  const skip = (input.page - 1) * input.pageSize;
  const searchWhereSql = buildChannelListSearchWhereSql(query);
  const joinSql = buildChannelListResolvedStatusJoinSql(input);
  const creatorFilterJoinSql = buildChannelListCreatorFilterJoinSql(input);
  const creatorFilterWhereSql = buildChannelListCreatorFilterWhereSql(input);
  const resolvedStatusWhereSql = buildChannelListResolvedStatusWhereSql(input);
  const baseSql = Prisma.sql`
    FROM channels c
    ${joinSql}
    ${creatorFilterJoinSql}
    WHERE 1 = 1
    ${searchWhereSql}
    ${creatorFilterWhereSql}
    ${resolvedStatusWhereSql}
  `;
  const countRows = await prisma.$queryRaw<ChannelCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS total
    ${baseSql}
  `);
  const idRows = await prisma.$queryRaw<ChannelListIdRow[]>(Prisma.sql`
    SELECT c.id
    ${baseSql}
    ORDER BY c.created_at DESC, c.id DESC
    OFFSET ${skip}
    LIMIT ${input.pageSize}
  `);

  return {
    ids: idRows.map((row) => row.id),
    total: Number(countRows[0]?.total ?? 0n),
  };
}

async function getLatestCompletedAdvancedReport(
  dbClient: ChannelDbClient,
  channelId: string,
): Promise<LatestCompletedAdvancedReport | null> {
  const request = await dbClient.advancedReportRequest.findFirst({
    where: {
      channelId,
      status: PrismaAdvancedReportRequestStatus.COMPLETED,
      completedAt: {
        not: null,
      },
    },
    orderBy: [
      {
        completedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: latestCompletedAdvancedReportSelect,
  });

  return toLatestCompletedAdvancedReport({
    request,
  });
}

export async function listChannels(input: ListChannelsInput): Promise<{
  items: ChannelSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const hasResolvedStatusFilters =
    (input.enrichmentStatus?.length ?? 0) > 0 || (input.advancedReportStatus?.length ?? 0) > 0;
  const where = buildChannelListWhere(input);

  if (hasResolvedStatusFilters) {
    const { ids, total } = await listChannelIdsForResolvedFilters(input);

    if (ids.length === 0) {
      return {
        items: [],
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }

    const channels = await prisma.channel.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: channelListSelect,
    });
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
    const orderedItems = ids
      .map((id) => channelsById.get(id))
      .filter((channel): channel is typeof channels[number] => Boolean(channel))
      .map((channel) => toChannelSummary(channel));

    return {
      items: orderedItems,
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  const skip = (input.page - 1) * input.pageSize;
  const findManyArgs = {
    skip,
    take: input.pageSize,
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    select: channelListSelect,
    ...(where ? { where } : {}),
  } satisfies Prisma.ChannelFindManyArgs;

  const total = await prisma.channel.count(where ? { where } : undefined);
  const channels = await prisma.channel.findMany(findManyArgs);

  return {
    items: channels.map((channel) => toChannelSummary(channel)),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}
export async function getChannelById(id: string): Promise<ChannelDetail | null> {
  const [channel, lastCompletedReport] = await Promise.all([
    prisma.channel.findUnique({
      where: { id },
      select: channelDetailSelect,
    }),
    getLatestCompletedAdvancedReport(prisma, id),
  ]);

  if (!channel) {
    return null;
  }

  return toChannelDetail(channel, lastCompletedReport);
}

export async function getChannelByYoutubeId(youtubeChannelId: string): Promise<ChannelDetail | null> {
  const channel = await prisma.channel.findUnique({
    where: { youtubeChannelId },
    select: channelDetailSelect,
  });

  if (!channel) {
    return null;
  }

  const lastCompletedReport = await getLatestCompletedAdvancedReport(prisma, channel.id);

  return toChannelDetail(channel, lastCompletedReport);
}

export async function upsertChannelSkeleton(input: {
  youtubeChannelId: string;
  title: string;
  handle?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
}): Promise<ChannelDetail> {
  const automatedValues: MutableChannelValues = {
    title: input.title,
    handle: input.handle ?? null,
    description: input.description ?? null,
    thumbnailUrl: input.thumbnailUrl ?? null,
  };

  const channelId = await withDbTransaction(async (tx) => {
    const existing = await tx.channel.findUnique({
      where: {
        youtubeChannelId: input.youtubeChannelId,
      },
      select: {
        id: true,
        title: true,
        handle: true,
        description: true,
        thumbnailUrl: true,
      },
    });

    if (!existing) {
      const created = await tx.channel.create({
        data: {
          youtubeChannelId: input.youtubeChannelId,
          title: automatedValues.title,
          handle: automatedValues.handle,
          youtubeUrl: `https://www.youtube.com/channel/${input.youtubeChannelId}`,
          description: automatedValues.description,
          thumbnailUrl: automatedValues.thumbnailUrl,
        },
        select: {
          id: true,
        },
      });

      return created.id;
    }

    const updateData: Prisma.ChannelUpdateInput = {
      title: automatedValues.title,
      handle: automatedValues.handle,
      youtubeUrl: `https://www.youtube.com/channel/${input.youtubeChannelId}`,
      description: automatedValues.description,
      thumbnailUrl: automatedValues.thumbnailUrl,
    };
    const manualOverrides = await tx.channelManualOverride.findMany({
      where: {
        channelId: existing.id,
      },
      select: {
        id: true,
        field: true,
        value: true,
        fallbackValue: true,
      },
    });

    for (const manualOverride of manualOverrides) {
      const config = getManualOverrideConfigByPrismaField(manualOverride.field);
      const automatedValue = getMutableChannelFieldValue(automatedValues, config.channelField);

      if (manualOverride.fallbackValue !== automatedValue) {
        await tx.channelManualOverride.update({
          where: {
            id: manualOverride.id,
          },
          data: {
            fallbackValue: automatedValue,
          },
        });
      }

      if (config.channelField === "title") {
        updateData.title = manualOverride.value ?? existing.title;
      } else {
        setMutableChannelFieldValue(updateData, config.channelField, manualOverride.value);
      }
    }

    const updated = await tx.channel.update({
      where: {
        id: existing.id,
      },
      data: updateData,
      select: {
        id: true,
      },
    });

    return updated.id;
  });
  const detail = await getChannelById(channelId);

  if (!detail) {
    throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
  }

  return detail;
}

export async function patchChannelManualOverrides(input: {
  channelId: string;
  actorUserId: string;
  operations: ChannelManualOverrideOperation[];
}): Promise<PatchChannelManualOverridesResponse> {
  const applied = await withDbTransaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: {
        id: input.channelId,
      },
      select: {
        id: true,
        title: true,
        handle: true,
        description: true,
        thumbnailUrl: true,
      },
    });

    if (!channel) {
      throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
    }

    const operationsByField = new Set<ChannelManualOverrideField>();

    for (const operation of input.operations) {
      if (operationsByField.has(operation.field)) {
        throw new ServiceError(
          "INVALID_OVERRIDE_PAYLOAD",
          400,
          "Each field can be patched at most once per request",
        );
      }

      operationsByField.add(operation.field);
    }

    const requestedPrismaFields = input.operations.map(
      (operation) => getManualOverrideConfigByContractField(operation.field).prismaField,
    );
    const existingOverrides = await tx.channelManualOverride.findMany({
      where: {
        channelId: input.channelId,
        field: {
          in: requestedPrismaFields,
        },
      },
      select: {
        id: true,
        field: true,
        value: true,
        fallbackValue: true,
      },
    });
    const existingOverridesByField = new Map(
      existingOverrides.map((manualOverride) => [manualOverride.field, manualOverride]),
    );

    const channelUpdateData: Prisma.ChannelUpdateInput = {};
    const applied: PatchChannelManualOverridesResponse["applied"] = [];

    for (const operation of input.operations) {
      const config = getManualOverrideConfigByContractField(operation.field);
      const existingManualOverride = existingOverridesByField.get(config.prismaField);

      if (operation.op === "set") {
        const value = normalizeManualSetValue(operation);
        const fallbackValue =
          existingManualOverride?.fallbackValue ??
          getMutableChannelFieldValue(channel, config.channelField);

        if (existingManualOverride) {
          await tx.channelManualOverride.update({
            where: {
              id: existingManualOverride.id,
            },
            data: {
              value,
              fallbackValue,
              updatedByUserId: input.actorUserId,
            },
          });
        } else {
          await tx.channelManualOverride.create({
            data: {
              channelId: input.channelId,
              field: config.prismaField,
              value,
              fallbackValue,
              createdByUserId: input.actorUserId,
              updatedByUserId: input.actorUserId,
            },
          });
        }

        setMutableChannelFieldValue(channelUpdateData, config.channelField, value);
      } else if (existingManualOverride) {
        await tx.channelManualOverride.delete({
          where: {
            id: existingManualOverride.id,
          },
        });

        if (config.channelField === "title") {
          channelUpdateData.title = existingManualOverride.fallbackValue ?? channel.title;
        } else {
          setMutableChannelFieldValue(
            channelUpdateData,
            config.channelField,
            existingManualOverride.fallbackValue,
          );
        }
      }

      applied.push({
        field: operation.field,
        op: operation.op,
      });
    }

    if (Object.keys(channelUpdateData).length > 0) {
      await tx.channel.update({
        where: {
          id: input.channelId,
        },
        data: channelUpdateData,
        select: {
          id: true,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "channel.manual_override.patched",
        entityType: "channel",
        entityId: input.channelId,
        metadata: {
          operations: applied,
        },
      },
    });

    return applied;
  });
  const channel = await getChannelById(input.channelId);

  if (!channel) {
    throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
  }

  return {
    channel,
    applied,
  };
}
