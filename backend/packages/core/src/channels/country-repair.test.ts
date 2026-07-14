import { ChannelCountrySource, Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchYoutubeDeclaredCountriesMock,
  getUserYoutubeApiKeyMock,
  listDropdownOptionsMock,
  prismaMock,
} = vi.hoisted(() => ({
  fetchYoutubeDeclaredCountriesMock: vi.fn(),
  getUserYoutubeApiKeyMock: vi.fn(),
  listDropdownOptionsMock: vi.fn(),
  prismaMock: {
    user: {
      findFirst: vi.fn(),
    },
    channel: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@scouting-platform/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@scouting-platform/integrations", () => ({
  fetchYoutubeDeclaredCountries: fetchYoutubeDeclaredCountriesMock,
  isYoutubeChannelCountryProviderError: () => false,
}));

vi.mock("../auth", () => ({
  getUserYoutubeApiKey: getUserYoutubeApiKeyMock,
}));

vi.mock("../dropdown-values", () => ({
  listDropdownOptions: listDropdownOptionsMock,
}));

import { repairChannelCountries } from "./country-repair";

describe("channel country repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findFirst.mockResolvedValue({ id: "admin-1" });
    prismaMock.channel.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auditEvent.create.mockResolvedValue({ id: "audit-1" });
    getUserYoutubeApiKeyMock.mockResolvedValue("youtube-key");
    listDropdownOptionsMock.mockResolvedValue({
      countryRegion: ["Croatia", "Czechia", "United States"],
    });
  });

  it("dry-runs YouTube replacements without writing catalog data", async () => {
    prismaMock.channel.findMany.mockResolvedValue([
      {
        id: "channel-1",
        youtubeChannelId: "UC-1",
        title: "Wrong legacy country",
        countryRegion: "United States",
        countryRegionSource: ChannelCountrySource.LLM,
      },
      {
        id: "channel-2",
        youtubeChannelId: "UC-2",
        title: "Missing country",
        countryRegion: null,
        countryRegionSource: null,
      },
    ]);
    fetchYoutubeDeclaredCountriesMock.mockResolvedValue(new Map([
      ["UC-1", "HR"],
      ["UC-2", "CZ"],
    ]));

    const result = await repairChannelCountries({
      requestedByUserId: "admin-1",
      limit: 100,
    });

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: Role.ADMIN, isActive: true }),
    }));
    expect(result).toMatchObject({
      dryRun: true,
      inspected: 2,
      changed: 2,
      failed: 0,
      items: [
        expect.objectContaining({
          action: "replace_with_youtube_declared",
          nextCountry: "Croatia",
        }),
        expect.objectContaining({
          action: "set_youtube_declared",
          nextCountry: "Czechia",
        }),
      ],
    });
    expect(prismaMock.channel.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
    expect(fetchYoutubeDeclaredCountriesMock).toHaveBeenCalledTimes(1);
  });

  it("applies and audits an explicit clear of an unverified LLM country", async () => {
    prismaMock.channel.findMany.mockResolvedValue([
      {
        id: "channel-1",
        youtubeChannelId: "UC-1",
        title: "Unverified country",
        countryRegion: "United States",
        countryRegionSource: ChannelCountrySource.LLM,
      },
    ]);
    fetchYoutubeDeclaredCountriesMock.mockResolvedValue(new Map([["UC-1", null]]));

    const result = await repairChannelCountries({
      requestedByUserId: "admin-1",
      apply: true,
      clearUnverified: true,
    });

    expect(result.items[0]).toMatchObject({
      action: "clear_unverified",
      nextCountry: null,
    });
    expect(prismaMock.channel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        countryRegion: null,
        countryRegionSource: null,
      },
    }));
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "channel.country_repair.completed",
      }),
    }));
  });

  it("rejects non-admin repair callers before fetching provider data", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expect(repairChannelCountries({
      requestedByUserId: "user-1",
    })).rejects.toMatchObject({
      code: "COUNTRY_REPAIR_FORBIDDEN",
      status: 403,
    });
    expect(fetchYoutubeDeclaredCountriesMock).not.toHaveBeenCalled();
  });
});
