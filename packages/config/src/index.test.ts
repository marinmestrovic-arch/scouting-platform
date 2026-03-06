import { describe, expect, it } from "vitest";

import { parseWorkerEnvironment } from "./index";

describe("parseWorkerEnvironment", () => {
  it("applies defaults for optional worker environment values", () => {
    const environment = parseWorkerEnvironment({
      DATABASE_URL: "postgresql://scouting:scouting@localhost:5432/scouting_platform",
    });

    expect(environment.PG_BOSS_SCHEMA).toBe("pgboss");
    expect(environment.LOG_LEVEL).toBe("info");
  });

  it("rejects invalid database urls", () => {
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "https://not-a-postgres-url",
      }),
    ).toThrow();
  });
});
