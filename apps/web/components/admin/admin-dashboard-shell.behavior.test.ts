import type { AdminDashboardResponse } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useEffectMock, useStateMock, fetchAdminDashboardMock } = vi.hoisted(() => ({
  useEffectMock: vi.fn(),
  useStateMock: vi.fn(),
  fetchAdminDashboardMock: vi.fn(),
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

vi.mock("../../lib/admin-dashboard-api", () => ({
  AdminDashboardApiError: class AdminDashboardApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "AdminDashboardApiError";
      this.status = status;
    }
  },
  fetchAdminDashboard: fetchAdminDashboardMock,
}));

import { AdminDashboardApiError } from "../../lib/admin-dashboard-api";
import {
  ADMIN_DASHBOARD_POLL_INTERVAL_MS,
  AdminDashboardShell,
  AdminDashboardShellView,
} from "./admin-dashboard-shell";

type DashboardViewProps = Parameters<typeof AdminDashboardShellView>[0];
type DashboardShellElement = ReactElement<DashboardViewProps>;

function buildDashboard(overrides?: Partial<AdminDashboardResponse>): AdminDashboardResponse {
  return {
    generatedAt: "2026-03-12T09:30:00.000Z",
    approvals: {
      counts: {
        pendingApproval: 2,
        approved: 1,
        queued: 1,
        running: 0,
        failed: 1,
      },
      pendingPreview: [],
    },
    imports: {
      counts: {
        queued: 1,
        running: 0,
        failed: 1,
      },
      attentionPreview: [],
    },
    users: {
      totalCount: 4,
      activeCount: 3,
      adminCount: 1,
      missingYoutubeKeyCount: 1,
      missingYoutubeKeyPreview: [],
    },
    ...overrides,
  };
}

function createShellState(options?: {
  dashboardState?: DashboardViewProps["dashboardState"];
  reloadToken?: number;
  isRefreshing?: boolean;
}) {
  return {
    dashboardState:
      options?.dashboardState ??
      {
        status: "loading" as const,
        data: null,
        error: null,
      },
    reloadToken: options?.reloadToken ?? 0,
    isRefreshing: options?.isRefreshing ?? false,
  };
}

function renderShell(options?: Parameters<typeof createShellState>[0] & { runEffects?: boolean }) {
  const state = createShellState(options);
  const setters = {
    setDashboardState: vi.fn(),
    setReloadToken: vi.fn(),
    setIsRefreshing: vi.fn(),
  };
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  useStateMock
    .mockReturnValueOnce([state.dashboardState, setters.setDashboardState])
    .mockReturnValueOnce([state.reloadToken, setters.setReloadToken])
    .mockReturnValueOnce([state.isRefreshing, setters.setIsRefreshing]);
  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    if (options?.runEffects === false) {
      return;
    }

    const cleanup = effect();

    if (typeof cleanup === "function") {
      cleanups.push(cleanup);
    }
  });

  const element = AdminDashboardShell() as DashboardShellElement;

  return {
    cleanups,
    element,
    setters,
  };
}

describe("admin dashboard shell behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAdminDashboardMock.mockResolvedValue(buildDashboard());
  });

  it("loads the dashboard on mount", async () => {
    const { setters } = renderShell();

    expect(fetchAdminDashboardMock).toHaveBeenCalledWith(expect.any(AbortSignal));

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setDashboardState).toHaveBeenCalledWith({
      status: "ready",
      data: buildDashboard(),
      error: null,
    });
    expect(setters.setIsRefreshing).toHaveBeenCalledWith(false);
  });

  it("surfaces authorization errors from the dashboard API", async () => {
    fetchAdminDashboardMock.mockRejectedValueOnce(
      new AdminDashboardApiError("You are not authorized to view the admin dashboard.", 403),
    );

    const { setters } = renderShell();

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setDashboardState).toHaveBeenCalledWith({
      status: "error",
      data: null,
      error: "Your session does not allow admin dashboard review anymore. Sign in again and retry.",
    });
  });

  it("polls while the dashboard still has active approvals or imports", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 123 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    const { cleanups, setters } = renderShell({
      dashboardState: {
        status: "ready",
        data: buildDashboard(),
        error: null,
      },
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), ADMIN_DASHBOARD_POLL_INTERVAL_MS);
    expect(setters.setReloadToken).toHaveBeenCalledWith(expect.any(Function));

    const reloadUpdater = setters.setReloadToken.mock.calls[0]?.[0] as ((value: number) => number) | undefined;
    expect(reloadUpdater?.(4)).toBe(5);

    cleanups.forEach((cleanup) => cleanup());
    expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
  });

  it("increments the reload token for manual refresh", () => {
    const { element, setters } = renderShell({
      runEffects: false,
      dashboardState: {
        status: "ready",
        data: buildDashboard(),
        error: null,
      },
    });

    element.props.onReload();

    expect(setters.setReloadToken).toHaveBeenCalledWith(expect.any(Function));
  });

  it("resets the shell state before retrying an error", () => {
    const { element, setters } = renderShell({
      runEffects: false,
      dashboardState: {
        status: "error",
        data: null,
        error: "Unable to load the admin dashboard.",
      },
    });

    element.props.onRetry();

    expect(setters.setDashboardState).toHaveBeenCalledWith({
      status: "loading",
      data: null,
      error: null,
    });
    expect(setters.setReloadToken).toHaveBeenCalledWith(expect.any(Function));
  });
});
