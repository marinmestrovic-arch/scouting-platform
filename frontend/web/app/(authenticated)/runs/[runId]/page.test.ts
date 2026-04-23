import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStringAsync } from "../../../../lib/test-render";

const { getSessionMock, getRunStatusMock, runDetailShellMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(async () => ({
    user: {
      id: "user-1",
      role: "user",
    },
  })),
  getRunStatusMock: vi.fn(async () => ({ id: "run-123", status: "completed", results: [] })),
  runDetailShellMock: vi.fn(
    ({ runId, initialData }: { runId: string; initialData?: unknown }) =>
      `run-detail-shell:${runId}:${initialData ? "with-data" : "no-data"}`,
  ),
}));

vi.mock("@scouting-platform/core", () => ({
  getRunStatus: getRunStatusMock,
}));

vi.mock("../../../../lib/cached-auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("../../../../components/runs/run-detail-shell", () => ({
  RunDetailShell: runDetailShellMock,
}));

import RunDetailPage from "./page";

describe("run detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the run detail shell from route params without fetching in the page", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const html = await renderToStringAsync(
      await RunDetailPage({
        params: Promise.resolve({ runId: "run-123" }),
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runDetailShellMock.mock.calls[0]?.[0]).toEqual({
      initialData: { id: "run-123", status: "completed", results: [] },
      runId: "run-123",
    });
    expect(html).toContain("page-header__title\">Run Detail");
    expect(html).toContain(
      "Track scouting status, inspect stored snapshot results, and surface queue failures without leaving the runs surface.",
    );
    expect(html).toContain("run-detail-shell:run-123:with-data");
  });
});
