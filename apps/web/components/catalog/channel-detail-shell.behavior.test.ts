import type { ChannelDetail } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchChannelDetailMock,
  setRequestStateMock,
  setReloadTokenMock,
  useEffectMock,
  useStateMock,
} = vi.hoisted(() => ({
  fetchChannelDetailMock: vi.fn(),
  setRequestStateMock: vi.fn(),
  setReloadTokenMock: vi.fn(),
  useEffectMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: "img",
}));

vi.mock("next/link", () => ({
  default: "a",
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/channels-api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/channels-api")>("../../lib/channels-api");

  return {
    ...actual,
    fetchChannelDetail: fetchChannelDetailMock,
  };
});

import { ApiRequestError } from "../../lib/channels-api";
import { ChannelDetailShell } from "./channel-detail-shell";

type ChannelDetailShellElement = ReactElement<{
  channelId: string;
  requestState: {
    status: "loading" | "error" | "notFound" | "ready";
  };
  onRetry: () => void;
}>;

function createChannelDetail(overrides?: Partial<ChannelDetail>): ChannelDetail {
  return {
    id: "53adac17-f39d-4731-a61f-194150fbc431",
    youtubeChannelId: "UC123",
    title: "Orbital Deep Dive",
    handle: "@orbitaldeepdive",
    description: "Weekly coverage of launch systems and creator strategy.",
    thumbnailUrl: "https://example.com/thumb.jpg",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-08T10:00:00.000Z",
    enrichment: {
      status: "completed",
      updatedAt: "2026-03-08T10:00:00.000Z",
      completedAt: "2026-03-08T10:00:00.000Z",
      lastError: null,
      summary: "Creator focused on launches and industry analysis.",
      topics: ["space", "launches"],
      brandFitNotes: "Strong fit for launch providers.",
      confidence: 0.82,
    },
    advancedReport: {
      requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
      status: "completed",
      updatedAt: "2026-03-08T10:00:00.000Z",
      completedAt: "2026-03-08T10:00:00.000Z",
      lastError: null,
      requestedAt: "2026-03-07T08:00:00.000Z",
      reviewedAt: "2026-03-07T09:00:00.000Z",
      decisionNote: "Approved.",
      lastCompletedReport: {
        requestId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
        completedAt: "2026-03-08T10:00:00.000Z",
        ageDays: 12,
        withinFreshWindow: true,
      },
    },
    insights: {
      audienceCountries: [],
      audienceGenderAge: [],
      audienceInterests: [],
      estimatedPrice: null,
      brandMentions: [],
    },
    ...overrides,
  };
}

function renderShell(options?: {
  channelId?: string;
  requestState?: {
    status: "loading" | "error" | "notFound" | "ready";
    data: ChannelDetail | null;
    error: string | null;
  };
  reloadToken?: number;
}) {
  let cleanup: (() => void) | undefined;

  useStateMock.mockReset();
  useEffectMock.mockReset();
  setRequestStateMock.mockReset();
  setReloadTokenMock.mockReset();

  useStateMock
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "loading",
        data: null,
        error: null,
      },
      setRequestStateMock,
    ])
    .mockReturnValueOnce([options?.reloadToken ?? 0, setReloadTokenMock]);

  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    const maybeCleanup = effect();
    cleanup = typeof maybeCleanup === "function" ? maybeCleanup : undefined;
  });

  const element = ChannelDetailShell({
    channelId: options?.channelId ?? "53adac17-f39d-4731-a61f-194150fbc431",
  }) as ChannelDetailShellElement;

  return {
    cleanup,
    element,
  };
}

describe("channel detail shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchChannelDetailMock.mockResolvedValue(createChannelDetail());
  });

  it("loads the current channel detail on mount and aborts on cleanup", async () => {
    const response = createChannelDetail();
    fetchChannelDetailMock.mockResolvedValueOnce(response);

    const { cleanup } = renderShell();

    expect(fetchChannelDetailMock).toHaveBeenCalledWith(
      "53adac17-f39d-4731-a61f-194150fbc431",
      expect.any(AbortSignal),
    );
    expect(setRequestStateMock).toHaveBeenNthCalledWith(1, {
      status: "loading",
      data: null,
      error: null,
    });

    await Promise.resolve();

    expect(setRequestStateMock).toHaveBeenNthCalledWith(2, {
      status: "ready",
      data: response,
      error: null,
    });

    const signal = fetchChannelDetailMock.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);

    cleanup?.();

    expect(signal?.aborted).toBe(true);
  });

  it("maps 404 detail responses into a not-found request state", async () => {
    fetchChannelDetailMock.mockRejectedValueOnce(new ApiRequestError("Channel not found.", 404));

    renderShell();

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestStateMock).toHaveBeenNthCalledWith(2, {
      status: "notFound",
      data: null,
      error: null,
    });
  });

  it("exposes a retry callback that triggers a reload token increment", () => {
    const { element } = renderShell({
      requestState: {
        status: "error",
        data: null,
        error: "Catalog temporarily unavailable.",
      },
    });

    element.props.onRetry();

    expect(setReloadTokenMock).toHaveBeenCalledTimes(1);
    const updater = setReloadTokenMock.mock.calls[0]?.[0] as ((value: number) => number) | undefined;
    expect(typeof updater).toBe("function");
    expect(updater?.(4)).toBe(5);
  });
});
