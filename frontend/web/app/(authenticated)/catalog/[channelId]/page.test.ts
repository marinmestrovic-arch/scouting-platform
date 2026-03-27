import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, channelDetailShellMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  channelDetailShellMock: vi.fn(
    ({
      channelId,
      canManageManualEdits,
    }: {
      channelId: string;
      canManageManualEdits?: boolean;
    }) => `channel-detail-shell:${channelId}:${String(canManageManualEdits)}`,
  ),
}));

vi.mock("../../../../auth", () => ({
  auth: authMock,
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
    });
    expect(html).not.toContain("Channel Detail");
    expect(html).toContain("channel-detail-shell:channel-123:true");
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
    });
    expect(html).toContain("channel-detail-shell:channel-123:false");
  });
});
