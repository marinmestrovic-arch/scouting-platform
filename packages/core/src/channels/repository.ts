import type { Prisma } from "@prisma/client";
import { prisma } from "@scouting-platform/db";

export type ListChannelsInput = {
  page: number;
  pageSize: number;
  query?: string;
};

export type ChannelSummary = {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
};

export type ChannelDetail = ChannelSummary & {
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

function toChannelSummary(channel: {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
}): ChannelSummary {
  return {
    id: channel.id,
    youtubeChannelId: channel.youtubeChannelId,
    title: channel.title,
    handle: channel.handle,
    thumbnailUrl: channel.thumbnailUrl,
  };
}

function toChannelDetail(channel: {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ChannelDetail {
  return {
    ...toChannelSummary(channel),
    description: channel.description,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

export async function listChannels(input: ListChannelsInput): Promise<{
  items: ChannelSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const skip = (input.page - 1) * input.pageSize;
  const query = input.query?.trim();
  const where: Prisma.ChannelWhereInput | undefined = query
    ? {
        OR: [
          {
            title: {
              contains: query,
              mode: "insensitive" as const,
            },
          },
          {
            handle: {
              contains: query,
              mode: "insensitive" as const,
            },
          },
          {
            youtubeChannelId: {
              contains: query,
              mode: "insensitive" as const,
            },
          },
        ],
      }
    : undefined;
  const countArgs: Prisma.ChannelCountArgs = where ? { where } : {};
  const findManyArgs: Prisma.ChannelFindManyArgs = {
    skip,
    take: input.pageSize,
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
      handle: true,
      thumbnailUrl: true,
    },
    ...(where ? { where } : {}),
  };

  const [total, channels] = await prisma.$transaction([
    prisma.channel.count(countArgs),
    prisma.channel.findMany(findManyArgs),
  ]);

  return {
    items: channels.map((channel) => toChannelSummary(channel)),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function getChannelById(id: string): Promise<ChannelDetail | null> {
  const channel = await prisma.channel.findUnique({
    where: { id },
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
      handle: true,
      description: true,
      thumbnailUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!channel) {
    return null;
  }

  return toChannelDetail(channel);
}

export async function getChannelByYoutubeId(youtubeChannelId: string): Promise<ChannelDetail | null> {
  const channel = await prisma.channel.findUnique({
    where: { youtubeChannelId },
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
      handle: true,
      description: true,
      thumbnailUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!channel) {
    return null;
  }

  return toChannelDetail(channel);
}

export async function upsertChannelSkeleton(input: {
  youtubeChannelId: string;
  title: string;
  handle?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
}): Promise<ChannelDetail> {
  const channel = await prisma.channel.upsert({
    where: { youtubeChannelId: input.youtubeChannelId },
    create: {
      youtubeChannelId: input.youtubeChannelId,
      title: input.title,
      handle: input.handle ?? null,
      description: input.description ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
    },
    update: {
      title: input.title,
      handle: input.handle ?? null,
      description: input.description ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
    },
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
      handle: true,
      description: true,
      thumbnailUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return toChannelDetail(channel);
}
