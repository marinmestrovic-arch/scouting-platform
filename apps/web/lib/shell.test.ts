import { describe, expect, it } from "vitest";
import { APP_TITLE } from "./shell";

describe("web shell constants", () => {
  it("defines the app title", () => {
    expect(APP_TITLE).toBe("Scouting Platform");
  });
});
