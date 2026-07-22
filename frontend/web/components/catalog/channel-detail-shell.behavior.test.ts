import type { ChannelDetail } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cancelChannelEnrichmentMock,
  fetchChannelDetailMock,
  requestChannelEnrichmentMock,
  useEffectMock,
  useRefMock,
  useStateMock,
} = vi.hoisted(() => ({
  cancelChannelEnrichmentMock: vi.fn(),
  fetchChannelDetailMock: vi.fn(),
  requestChannelEnrichmentMock: vi.fn(),
  useEffectMock: vi.fn(),
  useRefMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: "img",
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useRef: useRefMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/channels-api", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiRequestError";
      this.status = status;
    }
  },
  fetchChannelDetail: fetchChannelDetailMock,
  cancelChannelEnrichment: cancelChannelEnrichmentMock,
  requestChannelEnrichment: requestChannelEnrichmentMock,
}));

import { ApiRequestError } from "../../lib/channels-api";
import {
  ChannelDetailShell,
  ENRICHMENT_STATUS_POLL_INTERVAL_MS,
} from "./channel-detail-shell";

type ChannelDetailShellElement = ReactElement<{
  onRetry: () => void;
  onRequestEnrichment: () => void | Promise<void>;
}>;

function createChannelDetail(overrides?: Partial<ChannelDetail>): ChannelDetail {
  return {
    id: "53adac17-f39d-4731-a61f-194150fbc431",
    youtubeChannelId: "UC123",
    title: "Orbital Deep Dive",
    handle: "@orbitaldeepdive",
    youtubeUrl: "https://www.youtube.com/channel/UC123",
    socialMediaLink: "https://instagram.com/orbitaldeepdive",
    platforms: ["YouTube", "Instagram"],
    countryRegion: "United States",
    email: "creator@example.com",
    influencerVertical: "Tech",
    influencerType: "Creator",
    contentLanguage: "English",
    youtubeEngagementRate: 3.2,
    youtubeFollowers: "500000",
    youtubeVideoMedianViews: "220000",
    youtubeShortsMedianViews: "180000",
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
      structuredProfile: null,
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
    workedWith: false,
    collaborations: [],
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
  enrichmentActionState?: {
    type: "idle" | "submitting" | "success" | "error";
    message: string;
  };
  initialData?: ChannelDetail | null;
  reloadOriginChannelId?: string | null;
  runEffects?: boolean;
}) {
  const setRequestState = vi.fn();
  const setReloadToken = vi.fn();
  const setEnrichmentActionState = vi.fn();
  const cleanups: Array<() => void> = [];
  const reloadOriginChannelIdRef = {
    current: options?.reloadOriginChannelId ?? null,
  };

  useStateMock.mockReset();
  useEffectMock.mockReset();
  useRefMock.mockReset();
  useRefMock.mockReturnValueOnce(reloadOriginChannelIdRef);
  useStateMock
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "loading",
        data: null,
        error: null,
      },
      setRequestState,
    ])
    .mockReturnValueOnce([options?.reloadToken ?? 0, setReloadToken])
    .mockReturnValueOnce([
      options?.enrichmentActionState ?? {
        type: "idle",
        message: "",
      },
      setEnrichmentActionState,
    ]);
  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    if (options?.runEffects === false) {
      return;
    }

    const maybeCleanup = effect();

    if (typeof maybeCleanup === "function") {
      cleanups.push(maybeCleanup);
    }
  });

  const props: Parameters<typeof ChannelDetailShell>[0] =
    options?.initialData !== undefined
      ? {
          channelId: options.channelId ?? "53adac17-f39d-4731-a61f-194150fbc431",
          initialData: options.initialData,
        }
      : {
          channelId: options?.channelId ?? "53adac17-f39d-4731-a61f-194150fbc431",
        };

  const element = ChannelDetailShell(props) as ChannelDetailShellElement;

  return {
    cleanups,
    element,
    reloadOriginChannelIdRef,
    setEnrichmentActionState,
    setReloadToken,
    setRequestState,
  };
}

describe("channel detail shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchChannelDetailMock.mockResolvedValue(createChannelDetail());
    requestChannelEnrichmentMock.mockResolvedValue({
      channelId: "53adac17-f39d-4731-a61f-194150fbc431",
      enrichment: createChannelDetail().enrichment,
    });
    cancelChannelEnrichmentMock.mockResolvedValue({
      channelId: "53adac17-f39d-4731-a61f-194150fbc431",
      enrichment: {
        ...createChannelDetail().enrichment,
        status: "cancelled",
      },
    });
  });

  it("loads channel detail on mount, polls while enrichment is active, and aborts on cleanup", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 321 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    fetchChannelDetailMock.mockResolvedValueOnce(
      createChannelDetail({
        enrichment: {
          ...createChannelDetail().enrichment,
          status: "queued",
          completedAt: null,
        },
      }),
    );
    fetchChannelDetailMock.mockResolvedValueOnce(createChannelDetail());

    const { cleanups, setEnrichmentActionState, setRequestState } = renderShell();

    expect(setRequestState).toHaveBeenNthCalledWith(1, {
      status: "loading",
      data: null,
      error: null,
    });
    expect(setEnrichmentActionState).toHaveBeenCalledWith({
      type: "idle",
      message: "",
    });
    expect(fetchChannelDetailMock).toHaveBeenCalledWith(
      "53adac17-f39d-4731-a61f-194150fbc431",
      expect.any(AbortSignal),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(2, {
      status: "ready",
      data: createChannelDetail({
        enrichment: {
          ...createChannelDetail().enrichment,
          status: "queued",
          completedAt: null,
        },
      }),
      error: null,
    });
    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      ENRICHMENT_STATUS_POLL_INTERVAL_MS,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(3, {
      status: "ready",
      data: createChannelDetail(),
      error: null,
    });

    const signal = fetchChannelDetailMock.mock.calls[0]?.[1] as AbortSignal | undefined;

    cleanups.forEach((cleanup) => {
      cleanup();
    });

    expect(signal?.aborted).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(321);
  });

  it("keeps visible data in place during same-channel reloads", async () => {
    const currentChannel = createChannelDetail();
    const refreshedChannel = createChannelDetail({
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    fetchChannelDetailMock.mockResolvedValueOnce(refreshedChannel);

    const { setRequestState } = renderShell({
      channelId: currentChannel.id,
      initialData: currentChannel,
      reloadOriginChannelId: currentChannel.id,
      reloadToken: 1,
      requestState: {
        status: "ready",
        data: currentChannel,
        error: null,
      },
    });

    expect(setRequestState).not.toHaveBeenCalledWith({
      status: "loading",
      data: null,
      error: null,
    });
    expect(fetchChannelDetailMock).toHaveBeenCalledWith(currentChannel.id, expect.any(AbortSignal));

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenCalledWith({
      status: "ready",
      data: refreshedChannel,
      error: null,
    });
  });

  it("treats channel changes after a prior reload as a fresh load", async () => {
    const previousChannel = createChannelDetail();
    const nextChannel = createChannelDetail({
      id: "404e4567-e89b-12d3-a456-426614174000",
      youtubeChannelId: "UC999",
      title: "Fresh Channel",
      handle: "@freshchannel",
    });
    fetchChannelDetailMock.mockResolvedValueOnce(nextChannel);

    const { setRequestState } = renderShell({
      channelId: nextChannel.id,
      initialData: nextChannel,
      reloadOriginChannelId: previousChannel.id,
      reloadToken: 1,
      requestState: {
        status: "ready",
        data: previousChannel,
        error: null,
      },
    });

    expect(setRequestState).toHaveBeenNthCalledWith(1, {
      status: "loading",
      data: null,
      error: null,
    });
    expect(fetchChannelDetailMock).toHaveBeenCalledWith(nextChannel.id, expect.any(AbortSignal));

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(2, {
      status: "ready",
      data: nextChannel,
      error: null,
    });
  });

  it("maps 404 detail responses into a not-found request state", async () => {
    fetchChannelDetailMock.mockRejectedValueOnce(new ApiRequestError("Channel not found.", 404));

    const { setRequestState } = renderShell();

    await Promise.resolve();
    await Promise.resolve();

    expect(setRequestState).toHaveBeenLastCalledWith({
      status: "notFound",
      data: null,
      error: null,
    });
  });

  it("requests enrichment, merges the returned state, and triggers a refresh cycle", async () => {
    const currentChannel = createChannelDetail();
    requestChannelEnrichmentMock.mockResolvedValueOnce({
      channelId: currentChannel.id,
      enrichment: {
        status: "queued",
        updatedAt: "2026-03-09T10:00:00.000Z",
        completedAt: null,
        lastError: null,
        summary: null,
        topics: null,
        brandFitNotes: null,
        confidence: null,
        structuredProfile: null,
      },
    });

    const { element, setEnrichmentActionState, setReloadToken, setRequestState } = renderShell({
      requestState: {
        status: "ready",
        data: currentChannel,
        error: null,
      },
      runEffects: false,
    });

    await element.props.onRequestEnrichment();

    expect(requestChannelEnrichmentMock).toHaveBeenCalledWith(currentChannel.id);
    expect(setEnrichmentActionState).toHaveBeenNthCalledWith(1, {
      type: "submitting",
      message: "",
    });
    expect(setEnrichmentActionState).toHaveBeenNthCalledWith(2, {
      type: "success",
      message:
        "Enrichment request recorded. This page refreshes automatically while the worker runs, and the current result stays visible below until the refresh completes.",
    });
    expect(setRequestState).toHaveBeenCalledWith(expect.any(Function));
    expect(setReloadToken).toHaveBeenCalledWith(expect.any(Function));

    const requestStateUpdater = setRequestState.mock.calls[0]?.[0] as
      | ((current: {
          status: "ready";
          data: ChannelDetail;
          error: null;
        }) => unknown)
      | undefined;
    expect(requestStateUpdater).toBeTypeOf("function");
    expect(
      requestStateUpdater?.({
        status: "ready",
        data: currentChannel,
        error: null,
      }),
    ).toEqual({
      status: "ready",
      data: {
        ...currentChannel,
        enrichment: {
          ...currentChannel.enrichment,
          status: "queued",
          updatedAt: "2026-03-09T10:00:00.000Z",
          completedAt: null,
          lastError: null,
        },
      },
      error: null,
    });

    const reloadTokenUpdater = setReloadToken.mock.calls[0]?.[0] as ((value: number) => number) | undefined;
    expect(reloadTokenUpdater?.(4)).toBe(5);
  });

  it("stops an active enrichment and preserves the retained result", async () => {
    const currentChannel = createChannelDetail({
      enrichment: {
        ...createChannelDetail().enrichment,
        status: "running",
      },
    });
    const { element, setEnrichmentActionState, setRequestState } = renderShell({
      requestState: {
        status: "ready",
        data: currentChannel,
        error: null,
      },
      runEffects: false,
    });

    await element.props.onRequestEnrichment();

    expect(cancelChannelEnrichmentMock).toHaveBeenCalledWith(currentChannel.id);
    expect(requestChannelEnrichmentMock).not.toHaveBeenCalled();
    expect(setRequestState).toHaveBeenCalledWith(expect.any(Function));
    expect(setEnrichmentActionState).toHaveBeenLastCalledWith({
      type: "success",
      message:
        "Enrichment stopped. Any provider request already in flight may finish, but its result will not be saved.",
    });
  });

  it("shows enrichment request errors without clearing the loaded detail state", async () => {
    requestChannelEnrichmentMock.mockRejectedValueOnce(
      new ApiRequestError(
        "Assigned YouTube API key is required before requesting enrichment",
        400,
      ),
    );

    const { element, setEnrichmentActionState, setRequestState } = renderShell({
      requestState: {
        status: "ready",
        data: createChannelDetail(),
        error: null,
      },
      runEffects: false,
    });

    await element.props.onRequestEnrichment();

    expect(setEnrichmentActionState).toHaveBeenNthCalledWith(1, {
      type: "submitting",
      message: "",
    });
    expect(setEnrichmentActionState).toHaveBeenNthCalledWith(2, {
      type: "error",
      message: "Assigned YouTube API key is required before requesting enrichment",
    });
    expect(setRequestState).not.toHaveBeenCalled();
  });

  it("exposes a retry callback that triggers a reload token increment", () => {
    const { element, setReloadToken } = renderShell({
      requestState: {
        status: "error",
        data: null,
        error: "Catalog temporarily unavailable.",
      },
      runEffects: false,
    });

    element.props.onRetry();

    expect(setReloadToken).toHaveBeenCalledTimes(1);
    const updater = setReloadToken.mock.calls[0]?.[0] as ((value: number) => number) | undefined;
    expect(typeof updater).toBe("function");
    expect(updater?.(4)).toBe(5);
  });
});
