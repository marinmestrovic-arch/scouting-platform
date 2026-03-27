import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, channelDetailShellMock, getChannelByIdMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  channelDetailShellMock: vi.fn(
    ({
      channelId,
      canManageManualEdits,
      initialData,
    }: {
      channelId: string;
      canManageManualEdits?: boolean;
      initialData?: unknown;
    }) => `channel-detail-shell:${channelId}:${String(canManageManualEdits)}:${initialData ? "with-data" : "no-data"}`,
  ),
  getChannelByIdMock: vi.fn(async () => ({ id: "channel-123" })),
}));

vi.mock("../../../../auth", () => ({
  auth: authMock,
}));

vi.mock("@scouting-platform/core", () => ({
  getChannelById: getChannelByIdMock,
}));

vi.mock("../../../../components/catalog/channel-detail-shell", () => ({
  ChannelDetailShell: channelDetailShellMock,
}));

import CatalogChannelDetailPage from "./page";

describe("catalog channel detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: "e3cda197-465d-4483-bad8-4b20df7df098",
        role: "admin",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the channel detail shell from route params without fetching detail data in the page", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const html = renderToStaticMarkup(
      await CatalogChannelDetailPage({
        params: Promise.resolve({ channelId: "channel-123" }),
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(channelDetailShellMock).toHaveBeenCalledTimes(1);
    expect(channelDetailShellMock.mock.calls[0]?.[0]).toEqual({
      channelId: "channel-123",
      canManageManualEdits: true,
      initialData: { id: "channel-123" },
    });
    expect(html).not.toContain("Channel Detail");
    expect(html).toContain("channel-detail-shell:channel-123:true:with-data");
  });

  it("only enables manual edit controls for admins", async () => {
    authMock.mockResolvedValueOnce({
      user: {
        id: "e3cda197-465d-4483-bad8-4b20df7df098",
        role: "user",
      },
    });

    const html = renderToStaticMarkup(
      await CatalogChannelDetailPage({
        params: Promise.resolve({ channelId: "channel-123" }),
      }),
    );

    expect(channelDetailShellMock.mock.calls[0]?.[0]).toEqual({
      channelId: "channel-123",
      canManageManualEdits: false,
      initialData: { id: "channel-123" },
    });
    expect(html).toContain("channel-detail-shell:channel-123:false:with-data");
  });
});
