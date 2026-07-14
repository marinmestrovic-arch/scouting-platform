import {
  ChannelCountrySource,
  Role,
} from "@prisma/client";
import { prisma } from "@scouting-platform/db";
import {
  fetchYoutubeDeclaredCountries,
  isYoutubeChannelCountryProviderError,
} from "@scouting-platform/integrations";

import { getUserYoutubeApiKey } from "../auth";
import { listDropdownOptions } from "../dropdown-values";
import {
  isProtectedCountrySource,
  normalizeCountryRegionOption,
} from "../enrichment/country-resolution";
import { ServiceError } from "../errors";

const DEFAULT_REPAIR_LIMIT = 100;
const MAX_REPAIR_LIMIT = 1_000;
const YOUTUBE_BATCH_SIZE = 50;

export type ChannelCountryRepairAction =
  | "set_youtube_declared"
  | "replace_with_youtube_declared"
  | "clear_unverified"
  | "unchanged"
  | "youtube_country_missing"
  | "youtube_country_unmapped"
  | "failed";

export type ChannelCountryRepairItem = {
  channelId: string;
  youtubeChannelId: string;
  title: string;
  previousCountry: string | null;
  previousSource: ChannelCountrySource | null;
  youtubeCountryCode: string | null;
  nextCountry: string | null;
  action: ChannelCountryRepairAction;
  error: string | null;
};

export type ChannelCountryRepairResult = {
  dryRun: boolean;
  clearUnverified: boolean;
  inspected: number;
  changed: number;
  failed: number;
  nextAfterId: string | null;
  items: ChannelCountryRepairItem[];
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function repairChannelCountries(input: {
  requestedByUserId: string;
  apply?: boolean;
  clearUnverified?: boolean;
  limit?: number;
  afterId?: string;
}): Promise<ChannelCountryRepairResult> {
  const limit = Math.min(MAX_REPAIR_LIMIT, Math.max(1, input.limit ?? DEFAULT_REPAIR_LIMIT));
  const apply = input.apply ?? false;
  const clearUnverified = input.clearUnverified ?? false;
  const actor = await prisma.user.findFirst({
    where: {
      id: input.requestedByUserId,
      role: Role.ADMIN,
      isActive: true,
    },
    select: { id: true },
  });

  if (!actor) {
    throw new ServiceError("COUNTRY_REPAIR_FORBIDDEN", 403, "An active admin is required");
  }

  const youtubeApiKey = await getUserYoutubeApiKey(actor.id);

  if (!youtubeApiKey) {
    throw new ServiceError(
      "YOUTUBE_KEY_REQUIRED",
      400,
      "The selected admin must have an assigned YouTube API key",
    );
  }

  const dropdownOptions = await listDropdownOptions();

  if (dropdownOptions.countryRegion.length === 0) {
    throw new ServiceError(
      "COUNTRY_OPTIONS_REQUIRED",
      409,
      "Country/Region dropdown values must be synced before country repair",
    );
  }

  const channels = await prisma.channel.findMany({
    where: {
      ...(input.afterId ? { id: { gt: input.afterId } } : {}),
      OR: [
        { countryRegionSource: null },
        {
          countryRegionSource: {
            in: [ChannelCountrySource.LLM, ChannelCountrySource.YOUTUBE_DECLARED],
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    take: limit,
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
      countryRegion: true,
      countryRegionSource: true,
    },
  });

  const items: ChannelCountryRepairItem[] = [];
  const youtubeCountries = new Map<string, string | null>();
  const lookupErrors = new Map<string, string>();
  let changed = 0;
  let failed = 0;

  for (let index = 0; index < channels.length; index += YOUTUBE_BATCH_SIZE) {
    const batch = channels.slice(index, index + YOUTUBE_BATCH_SIZE);

    try {
      const countries = await fetchYoutubeDeclaredCountries({
        apiKey: youtubeApiKey,
        channelIds: batch.map((channel) => channel.youtubeChannelId),
      });

      for (const channel of batch) {
        if (countries.has(channel.youtubeChannelId)) {
          youtubeCountries.set(
            channel.youtubeChannelId,
            countries.get(channel.youtubeChannelId) ?? null,
          );
        } else {
          lookupErrors.set(channel.youtubeChannelId, "YouTube channel not found");
        }
      }
    } catch (error) {
      if (
        isYoutubeChannelCountryProviderError(error)
        && (error.code === "YOUTUBE_AUTH_FAILED" || error.code === "YOUTUBE_QUOTA_EXCEEDED")
      ) {
        throw new ServiceError(error.code, error.status, error.message);
      }

      for (const channel of batch) {
        lookupErrors.set(channel.youtubeChannelId, formatError(error));
      }
    }
  }

  for (const channel of channels) {
    if (isProtectedCountrySource(channel.countryRegionSource)) {
      continue;
    }

    const lookupError = lookupErrors.get(channel.youtubeChannelId);

    if (lookupError) {
      failed += 1;
      items.push({
        channelId: channel.id,
        youtubeChannelId: channel.youtubeChannelId,
        title: channel.title,
        previousCountry: channel.countryRegion,
        previousSource: channel.countryRegionSource,
        youtubeCountryCode: null,
        nextCountry: channel.countryRegion,
        action: "failed",
        error: lookupError,
      });
      continue;
    }

    try {
      const countryCode = youtubeCountries.get(channel.youtubeChannelId) ?? null;
      const normalizedCountry = normalizeCountryRegionOption(
        dropdownOptions.countryRegion,
        countryCode,
      );
      let action: ChannelCountryRepairAction;
      let nextCountry = channel.countryRegion;
      let nextSource = channel.countryRegionSource;

      if (normalizedCountry) {
        nextCountry = normalizedCountry;
        nextSource = ChannelCountrySource.YOUTUBE_DECLARED;
        action = channel.countryRegion
          ? channel.countryRegion === normalizedCountry
            && channel.countryRegionSource === ChannelCountrySource.YOUTUBE_DECLARED
            ? "unchanged"
            : "replace_with_youtube_declared"
          : "set_youtube_declared";
      } else if (countryCode) {
        action = "youtube_country_unmapped";
      } else if (
        clearUnverified
        && channel.countryRegion
        && (
          channel.countryRegionSource === null
          || channel.countryRegionSource === ChannelCountrySource.LLM
        )
      ) {
        action = "clear_unverified";
        nextCountry = null;
        nextSource = null;
      } else {
        action = "youtube_country_missing";
      }

      const shouldChange = action === "set_youtube_declared"
        || action === "replace_with_youtube_declared"
        || action === "clear_unverified";

      if (shouldChange) {
        if (apply) {
          const updateResult = await prisma.channel.updateMany({
            where: {
              id: channel.id,
              OR: [
                { countryRegionSource: null },
                {
                  countryRegionSource: {
                    in: [ChannelCountrySource.LLM, ChannelCountrySource.YOUTUBE_DECLARED],
                  },
                },
              ],
            },
            data: {
              countryRegion: nextCountry,
              countryRegionSource: nextSource,
            },
          });

          changed += updateResult.count;
        } else {
          changed += 1;
        }
      }

      items.push({
        channelId: channel.id,
        youtubeChannelId: channel.youtubeChannelId,
        title: channel.title,
        previousCountry: channel.countryRegion,
        previousSource: channel.countryRegionSource,
        youtubeCountryCode: countryCode,
        nextCountry,
        action,
        error: null,
      });
    } catch (error) {
      failed += 1;
      items.push({
        channelId: channel.id,
        youtubeChannelId: channel.youtubeChannelId,
        title: channel.title,
        previousCountry: channel.countryRegion,
        previousSource: channel.countryRegionSource,
        youtubeCountryCode: null,
        nextCountry: channel.countryRegion,
        action: "failed",
        error: formatError(error),
      });
    }
  }

  if (apply) {
    await prisma.auditEvent.create({
      data: {
        actorUserId: actor.id,
        action: "channel.country_repair.completed",
        entityType: "channel_country_repair",
        entityId: actor.id,
        metadata: {
          inspected: channels.length,
          changed,
          failed,
          clearUnverified,
          afterId: input.afterId ?? null,
        },
      },
    });
  }

  return {
    dryRun: !apply,
    clearUnverified,
    inspected: channels.length,
    changed,
    failed,
    nextAfterId: channels.length === limit ? channels.at(-1)?.id ?? null : null,
    items,
  };
}
