import { describe, expect, it, vi } from "vitest";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock
}));

import AdminPage from "./page";

describe("admin page", () => {
  it("enforces route protection for the default role baseline", () => {
    AdminPage();

    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
