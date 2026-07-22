import { describe, expect, it } from "vitest";

import {
  formatHubspotImportBatchStatusLabel,
  isActiveHubspotImportBatchStatus,
} from "./hubspot-status-presentation";

describe("HubSpot import status presentation", () => {
  it("keeps every prepare-page label in one shared map", () => {
    expect(formatHubspotImportBatchStatusLabel("queued")).toBe("Queued");
    expect(formatHubspotImportBatchStatusLabel("preparing")).toBe("Preparing records");
    expect(formatHubspotImportBatchStatusLabel("running")).toBe("Preparing records");
    expect(formatHubspotImportBatchStatusLabel("submitting")).toBe("Submitting to HubSpot");
    expect(formatHubspotImportBatchStatusLabel("submitted")).toBe("Submitted to HubSpot");
    expect(formatHubspotImportBatchStatusLabel("processing")).toBe("Finalizing associations");
    expect(formatHubspotImportBatchStatusLabel("completed")).toBe("Completed");
    expect(formatHubspotImportBatchStatusLabel("completed_with_errors")).toBe(
      "Completed with errors",
    );
    expect(formatHubspotImportBatchStatusLabel("failed")).toBe("Failed");
  });

  it("identifies active provider work", () => {
    expect(isActiveHubspotImportBatchStatus("processing")).toBe(true);
    expect(isActiveHubspotImportBatchStatus("completed")).toBe(false);
    expect(isActiveHubspotImportBatchStatus("completed_with_errors")).toBe(false);
    expect(isActiveHubspotImportBatchStatus("failed")).toBe(false);
  });
});
