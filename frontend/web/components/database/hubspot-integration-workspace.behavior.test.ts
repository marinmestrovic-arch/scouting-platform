import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchHubspotConflictsMock,
  fetchHubspotHealthMock,
  requestHubspotHealthCheckMock,
  useEffectMock,
  useStateMock,
} = vi.hoisted(() => ({
  fetchHubspotConflictsMock: vi.fn(),
  fetchHubspotHealthMock: vi.fn(),
  requestHubspotHealthCheckMock: vi.fn(),
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

vi.mock("../../lib/hubspot-conflicts-api", () => ({
  fetchHubspotConflicts: fetchHubspotConflictsMock,
}));

vi.mock("../../lib/hubspot-health-api", () => ({
  fetchHubspotHealth: fetchHubspotHealthMock,
  requestHubspotHealthCheck: requestHubspotHealthCheckMock,
}));

import {
  HubspotIntegrationWorkspace,
  HUBSPOT_HEALTH_POLL_INTERVAL_MS,
} from "./hubspot-integration-workspace";

const baseState = {
  status: "unknown",
  portalId: null,
  displayName: null,
  directSyncEnabled: false,
  webhooksEnabled: false,
  checkedAt: null,
  lastReferenceSyncAt: null,
  lastObjectSyncAt: null,
  lastWebhookProcessedAt: null,
  checks: [],
  blockers: [],
  requiredActions: [],
  lastError: null,
} as const;
const queuedState = {
  ...baseState,
  latestRun: {
    id: "11111111-1111-4111-8111-111111111111",
    status: "queued" as const,
    queuedAt: "2026-07-20T10:00:00.000Z",
    startedAt: null,
    completedAt: null,
    lastError: null,
  },
};
const completedState = {
  ...baseState,
  status: "healthy" as const,
  checkedAt: "2026-07-20T10:01:00.000Z",
  latestRun: {
    ...queuedState.latestRun,
    status: "completed" as const,
    startedAt: "2026-07-20T10:00:01.000Z",
    completedAt: "2026-07-20T10:01:00.000Z",
  },
};

describe("HubSpot integration health polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchHubspotConflictsMock.mockResolvedValue([]);
  });

  it("polls an active run, applies terminal state, and aborts on cleanup", async () => {
    const setHealth = vi.fn();
    const cleanups: Array<() => void> = [];
    useStateMock
      .mockReturnValueOnce([queuedState, setHealth])
      .mockReturnValueOnce(["", vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([[], vi.fn()])
      .mockReturnValueOnce(["open", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()])
      .mockReturnValueOnce([true, vi.fn()]);
    useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (typeof cleanup === "function") {
        cleanups.push(cleanup);
      }
    });
    fetchHubspotHealthMock
      .mockResolvedValueOnce(queuedState)
      .mockResolvedValueOnce(completedState);
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation((handler) => {
      void handler();
      return 123 as unknown as ReturnType<typeof setInterval>;
    });
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(
      () => undefined,
    );

    HubspotIntegrationWorkspace();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      HUBSPOT_HEALTH_POLL_INTERVAL_MS,
    );
    expect(fetchHubspotHealthMock).toHaveBeenCalledTimes(2);
    expect(setHealth).toHaveBeenLastCalledWith(completedState);

    const signals = fetchHubspotHealthMock.mock.calls
      .map((call) => call[0])
      .filter((signal): signal is AbortSignal => signal instanceof AbortSignal);
    cleanups.forEach((cleanup) => cleanup());
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
  });
});
