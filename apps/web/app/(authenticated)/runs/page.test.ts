import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import RunsPage from "./page";

describe("runs page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects the deprecated runs route back to dashboard", () => {
    RunsPage();

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});
