import { createScheduledHubspotObjectSyncRun } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  ensureHubspotObjectSyncDailySchedule,
  HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE,
  hubspotObjectSyncScheduleWorkerOptions,
  registerHubspotObjectSyncScheduleWorker,
} from "./hubspot-object-sync-schedule-worker";

vi.mock("@scouting-platform/core", () => ({
  createScheduledHubspotObjectSyncRun: vi.fn(async () => ({
    id: "11111111-1111-4111-8111-111111111111",
  })),
}));

describe("hubspot.object-sync.schedule worker registration", () => {
  it("registers the daily midnight Europe/Zagreb schedule", async () => {
    const schedule = vi.fn(async () => undefined);

    await ensureHubspotObjectSyncDailySchedule({
      schedule,
    } as unknown as Pick<PgBoss, "schedule">);

    expect(schedule).toHaveBeenCalledWith(
      HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.name,
      "0 0 * * *",
      {
        initiatedBy: "system",
      },
      expect.objectContaining({
        key: "daily-midnight-europe-zagreb",
        tz: "Europe/Zagreb",
      }),
    );
  });

  it("registers and executes scheduled sync trigger jobs", async () => {
    const work = vi.fn(async () => "hubspot-object-sync-schedule-worker");

    await registerHubspotObjectSyncScheduleWorker({
      work,
    } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected hubspot.object-sync.schedule worker to be registered");
    }

    const [name, options, handler] = call as unknown as [
      string,
      typeof hubspotObjectSyncScheduleWorkerOptions,
      (job: unknown) => Promise<void>,
    ];

    expect(name).toBe(HUBSPOT_OBJECT_SYNC_DAILY_SCHEDULE.name);
    expect(options).toEqual(hubspotObjectSyncScheduleWorkerOptions);

    await handler({
      data: {
        initiatedBy: "system",
      },
    });

    expect(vi.mocked(createScheduledHubspotObjectSyncRun)).toHaveBeenCalledTimes(1);
  });
});
