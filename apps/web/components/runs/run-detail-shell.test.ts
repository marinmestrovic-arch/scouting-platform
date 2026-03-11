import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const react = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children: ReactNode;
    }) => react.createElement("a", { href, className }, children),
  };
});

vi.mock("next/image", async () => {
  const react = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      alt,
      className,
      height,
      src,
      width,
    }: {
      alt: string;
      className?: string;
      height: number;
      src: string;
      width: number;
    }) => react.createElement("img", { alt, className, height, src, width }),
  };
});

import { RunDetailShellView, formatRunResultCount, getRunFailureMessage, shouldPollRunStatus } from "./run-detail-shell";

type RunResultPayload = {
  id: string;
  channelId: string;
  rank: number;
  source: "catalog" | "discovery";
  createdAt: string;
  channel: {
    id: string;
    youtubeChannelId: string;
    title: string;
    handle: string | null;
    thumbnailUrl: string | null;
  };
};

function buildRunStatusPayload(
  overrides?: Partial<{
    status: "queued" | "running" | "completed" | "failed";
    lastError: string | null;
    updatedAt: string;
    completedAt: string | null;
    results: RunResultPayload[];
  }>,
) {
  const status = overrides?.status ?? "completed";

  return {
    id: "53adac17-f39d-4731-a61f-194150fbc431",
    requestedByUserId: "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b",
    name: "Gaming Run",
    query: "gaming creators",
    status,
    lastError: overrides?.lastError ?? null,
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: overrides?.updatedAt ?? "2026-03-10T10:03:00.000Z",
    startedAt: "2026-03-10T10:01:00.000Z",
    completedAt:
      overrides?.completedAt ??
      (status === "completed" || status === "failed" ? "2026-03-10T10:03:00.000Z" : null),
    results: overrides?.results ?? [
      {
        id: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
        channelId: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
        rank: 1,
        source: "catalog" as const,
        createdAt: "2026-03-10T10:02:00.000Z",
        channel: {
          id: "24a57b02-3008-4af1-9b3a-340bd0db7d1c",
          youtubeChannelId: "UC_RUN_RESULT",
          title: "Run Result Channel",
          handle: "@runresult",
          thumbnailUrl: "https://example.com/thumb.jpg",
        },
      },
    ],
  };
}

function renderView(requestState: Parameters<typeof RunDetailShellView>[0]["requestState"]) {
  return renderToStaticMarkup(
    createElement(RunDetailShellView, {
      onRetry: () => undefined,
      requestState,
      runId: "53adac17-f39d-4731-a61f-194150fbc431",
    }),
  );
}

describe("run detail shell", () => {
  it("polls only while queued or running", () => {
    expect(shouldPollRunStatus("queued")).toBe(true);
    expect(shouldPollRunStatus("running")).toBe(true);
    expect(shouldPollRunStatus("completed")).toBe(false);
    expect(shouldPollRunStatus("failed")).toBe(false);
  });

  it("formats result counts", () => {
    expect(formatRunResultCount({ results: [] })).toBe("0 results");
    expect(formatRunResultCount({ results: [buildRunStatusPayload().results[0]!]})).toBe("1 result");
  });

  it("maps quota failures to actionable copy", () => {
    expect(
      getRunFailureMessage({
        lastError: "YouTube API quota exceeded",
      }),
    ).toBe(
      "YouTube API quota was exhausted before discovery completed. Retry later or ask an admin to rotate the assigned key.",
    );
  });

  it("renders loading and not-found states", () => {
    const loadingHtml = renderView({
      status: "loading",
      data: null,
      error: null,
    });
    const notFoundHtml = renderView({
      status: "notFound",
      data: null,
      error: null,
    });

    expect(loadingHtml).toContain("Loading run status");
    expect(notFoundHtml).toContain("Run not found");
  });

  it("renders ready state with result cards and catalog links", () => {
    const html = renderView({
      status: "ready",
      data: buildRunStatusPayload(),
      error: null,
    });

    expect(html).toContain("Gaming Run");
    expect(html).toContain("Snapshot complete and ready for review.");
    expect(html).toContain("Discovery job completed");
    expect(html).toContain("The worker finished and locked this snapshot so it stays reproducible during review.");
    expect(html).toContain("Open any catalog detail to review");
    expect(html).toContain("Snapshot results");
    expect(html).toContain("Updated");
    expect(html).toContain("Run Result Channel");
    expect(html).toContain('href="/catalog/24a57b02-3008-4af1-9b3a-340bd0db7d1c"');
  });

  it("renders explicit failed job feedback and empty snapshot guidance", () => {
    const html = renderView({
      status: "ready",
      data: buildRunStatusPayload({
        status: "failed",
        lastError: "Assigned YouTube API key is required before creating a run",
        results: [],
      }),
      error: null,
    });

    expect(html).toContain("Run needs attention before you try again.");
    expect(html).toContain("Discovery job failed");
    expect(html).toContain("This account needs an assigned YouTube API key before the worker can run discovery.");
    expect(html).toContain("Fix the underlying issue, then start a new run.");
    expect(html).toContain("No snapshot results were stored because the discovery job failed.");
    expect(html).toContain("Retry status check");
  });
});
