import type { ListChannelsResponse } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchChannelsMock, useEffectMock, useStateMock } = vi.hoisted(() => ({
  fetchChannelsMock: vi.fn(),
  useEffectMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/channels-api", () => ({
  fetchChannels: fetchChannelsMock,
}));

import { CatalogTableShell } from "./catalog-table-shell";

type CatalogShellElement = ReactElement<{
  onNextPage: () => void;
  onPreviousPage: () => void;
  onRetry: () => void;
  requestState: {
    status: "loading" | "error" | "ready";
  };
}>;

function createReadyState(overrides: Partial<ListChannelsResponse>): {
  status: "ready";
  data: ListChannelsResponse;
  error: null;
} {
  return {
    status: "ready",
    data: {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      ...overrides,
    },
    error: null,
  };
}

function renderShell(options?: {
  page?: number;
  pageSize?: number;
  requestState?: ReturnType<typeof createReadyState> | { status: "loading"; data: null; error: null } | {
    status: "error";
    data: null;
    error: string;
  };
  reloadToken?: number;
}) {
  const setPage = vi.fn();
  const setRequestState = vi.fn();
  const setReloadToken = vi.fn();
  let cleanup: (() => void) | undefined;

  useStateMock.mockReset();
  useEffectMock.mockReset();

  useStateMock
    .mockReturnValueOnce([options?.page ?? 1, setPage])
    .mockReturnValueOnce([
      options?.requestState ?? {
        status: "loading",
        data: null,
        error: null,
      },
      setRequestState,
    ])
    .mockReturnValueOnce([options?.reloadToken ?? 0, setReloadToken]);

  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    const maybeCleanup = effect();
    cleanup = typeof maybeCleanup === "function" ? maybeCleanup : undefined;
  });

  const element = CatalogTableShell(
    options?.pageSize === undefined ? {} : { pageSize: options.pageSize },
  ) as CatalogShellElement;

  return {
    cleanup,
    element,
    setPage,
    setRequestState,
    setReloadToken,
  };
}

describe("catalog table shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchChannelsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } satisfies ListChannelsResponse);
  });

  it("loads the first page on mount and updates ready state from the channels API", async () => {
    const response: ListChannelsResponse = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    };

    fetchChannelsMock.mockResolvedValueOnce(response);

    const { cleanup, setRequestState } = renderShell();

    expect(fetchChannelsMock).toHaveBeenCalledWith(
      {
        page: 1,
        pageSize: 20,
      },
      expect.any(AbortSignal),
    );
    expect(setRequestState).toHaveBeenNthCalledWith(1, {
      status: "loading",
      data: null,
      error: null,
    });

    await Promise.resolve();

    expect(setRequestState).toHaveBeenNthCalledWith(2, {
      status: "ready",
      data: response,
      error: null,
    });

    const signal = fetchChannelsMock.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(signal?.aborted).toBe(false);

    cleanup?.();

    expect(signal?.aborted).toBe(true);
  });

  it("moves to the next and previous pages using the response paging metadata", () => {
    const firstPage = renderShell({
      requestState: createReadyState({
        total: 21,
        page: 1,
        pageSize: 20,
        items: [
          {
            id: "60d6b6ca-a76b-4821-8d3b-c8d9f59f31ec",
            youtubeChannelId: "UC_PAGE_1",
            title: "Page One",
            handle: "@pageone",
            thumbnailUrl: null,
            enrichment: {
              status: "missing",
              updatedAt: null,
              completedAt: null,
              lastError: null,
            },
          },
        ],
      }),
    });

    firstPage.element.props.onNextPage();

    expect(firstPage.setPage).toHaveBeenCalledWith(2);

    const secondPage = renderShell({
      page: 2,
      requestState: createReadyState({
        total: 21,
        page: 2,
        pageSize: 20,
        items: [
          {
            id: "b5b2d6cd-0d0d-42db-a2f1-bd12a7ec5c15",
            youtubeChannelId: "UC_PAGE_2",
            title: "Page Two",
            handle: "@pagetwo",
            thumbnailUrl: null,
            enrichment: {
              status: "completed",
              updatedAt: "2026-03-08T10:00:00.000Z",
              completedAt: "2026-03-08T10:00:00.000Z",
              lastError: null,
            },
          },
        ],
      }),
    });

    secondPage.element.props.onPreviousPage();

    expect(secondPage.setPage).toHaveBeenCalledWith(1);
  });

  it("retries the current page by bumping the reload token", () => {
    const { element, setReloadToken } = renderShell({
      requestState: {
        status: "error",
        data: null,
        error: "Unable to load channels. Please try again.",
      },
    });

    element.props.onRetry();

    expect(setReloadToken).toHaveBeenCalledTimes(1);

    const updateReloadToken = setReloadToken.mock.calls[0]?.[0] as ((current: number) => number) | undefined;
    expect(updateReloadToken?.(0)).toBe(1);
  });
});
