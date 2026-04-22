import {
  listChannelsQuerySchema,
  listChannelsResponseSchema,
} from "@scouting-platform/contracts";
import { listChannels } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import {
  cachedJson,
  requireAuthenticatedSession,
  toRouteErrorResponse,
} from "../../../lib/api";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireAuthenticatedSession();

  if (!session.ok) {
    return session.response;
  }

  try {
    const url = new URL(request.url);
    const countryRegion = url.searchParams.getAll("countryRegion");
    const influencerVertical = url.searchParams.getAll("influencerVertical");
    const influencerType = url.searchParams.getAll("influencerType");
    const enrichmentStatus = url.searchParams.getAll("enrichmentStatus");
    const advancedReportStatus = url.searchParams.getAll("advancedReportStatus");
    const parsedQuery = listChannelsQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
      ...(countryRegion.length > 0 ? { countryRegion } : {}),
      ...(influencerVertical.length > 0 ? { influencerVertical } : {}),
      ...(influencerType.length > 0 ? { influencerType } : {}),
      youtubeVideoMedianViewsMin: url.searchParams.get("youtubeVideoMedianViewsMin") ?? undefined,
      youtubeVideoMedianViewsMax: url.searchParams.get("youtubeVideoMedianViewsMax") ?? undefined,
      youtubeShortsMedianViewsMin: url.searchParams.get("youtubeShortsMedianViewsMin") ?? undefined,
      youtubeShortsMedianViewsMax: url.searchParams.get("youtubeShortsMedianViewsMax") ?? undefined,
      youtubeFollowersMin: url.searchParams.get("youtubeFollowersMin") ?? undefined,
      youtubeFollowersMax: url.searchParams.get("youtubeFollowersMax") ?? undefined,
      ...(enrichmentStatus.length > 0 ? { enrichmentStatus } : {}),
      ...(advancedReportStatus.length > 0 ? { advancedReportStatus } : {}),
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: parsedQuery.error.flatten(),
        },
        { status: 400 },
      );
    }

    const listInput = {
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
      ...(parsedQuery.data.query ? { query: parsedQuery.data.query } : {}),
      ...(parsedQuery.data.countryRegion ? { countryRegion: parsedQuery.data.countryRegion } : {}),
      ...(parsedQuery.data.influencerVertical
        ? { influencerVertical: parsedQuery.data.influencerVertical }
        : {}),
      ...(parsedQuery.data.influencerType ? { influencerType: parsedQuery.data.influencerType } : {}),
      ...(parsedQuery.data.youtubeVideoMedianViewsMin !== undefined
        ? { youtubeVideoMedianViewsMin: parsedQuery.data.youtubeVideoMedianViewsMin }
        : {}),
      ...(parsedQuery.data.youtubeVideoMedianViewsMax !== undefined
        ? { youtubeVideoMedianViewsMax: parsedQuery.data.youtubeVideoMedianViewsMax }
        : {}),
      ...(parsedQuery.data.youtubeShortsMedianViewsMin !== undefined
        ? { youtubeShortsMedianViewsMin: parsedQuery.data.youtubeShortsMedianViewsMin }
        : {}),
      ...(parsedQuery.data.youtubeShortsMedianViewsMax !== undefined
        ? { youtubeShortsMedianViewsMax: parsedQuery.data.youtubeShortsMedianViewsMax }
        : {}),
      ...(parsedQuery.data.youtubeFollowersMin !== undefined
        ? { youtubeFollowersMin: parsedQuery.data.youtubeFollowersMin }
        : {}),
      ...(parsedQuery.data.youtubeFollowersMax !== undefined
        ? { youtubeFollowersMax: parsedQuery.data.youtubeFollowersMax }
        : {}),
      ...(parsedQuery.data.enrichmentStatus
        ? { enrichmentStatus: parsedQuery.data.enrichmentStatus }
        : {}),
      ...(parsedQuery.data.advancedReportStatus
        ? { advancedReportStatus: parsedQuery.data.advancedReportStatus }
        : {}),
    };
    const result = await listChannels(listInput);
    const payload = listChannelsResponseSchema.parse(result);

    return cachedJson(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
