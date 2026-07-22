import { describe, expect, it } from "vitest";

import {
  buildHubspotContactExternalKey,
  buildHubspotDealExternalKey,
  buildHubspotOutboundProperties,
  classifyHubspotPropertyOwnership,
  resolveHubspotInternalValue,
  resolveHubspotOwnerByEmail,
} from "./direct-sync-domain";

describe("HubSpot direct-sync domain rules", () => {
  it("builds stable namespaced identities", () => {
    expect(buildHubspotContactExternalKey(" ABC-123 ")).toBe("contact:abc-123");
    expect(buildHubspotDealExternalKey(" RUN-456 ")).toBe("run:run-456");
  });

  it("omits absent and empty values unless clearing is explicit", () => {
    expect(
      buildHubspotOutboundProperties({
        values: {
          email: "creator@example.com",
          phone: "",
          firstname: null,
          followers: 0,
        },
      }),
    ).toEqual({ email: "creator@example.com", followers: "0" });

    expect(
      buildHubspotOutboundProperties({
        values: { phone: undefined },
        explicitlyClear: ["phone"],
      }),
    ).toEqual({ phone: "" });
  });

  it("classifies shared fields conservatively", () => {
    expect(classifyHubspotPropertyOwnership("youtube_url")).toBe("platform");
    expect(classifyHubspotPropertyOwnership("dealstage")).toBe("hubspot");
    expect(classifyHubspotPropertyOwnership("worked_with")).toBe("hubspot");
    expect(classifyHubspotPropertyOwnership("amount")).toBe("hubspot");
    expect(classifyHubspotPropertyOwnership("email")).toBe("shared");
    expect(classifyHubspotPropertyOwnership("new_portal_field")).toBe("shared");
  });

  it("maps owners only when one active normalized email matches", () => {
    const owners = [
      { id: "1", email: "manager@example.com", active: true },
      { id: "2", email: "retired@example.com", active: false },
    ];

    expect(resolveHubspotOwnerByEmail(" Manager@Example.com ", owners)).toEqual({
      status: "resolved",
      ownerId: "1",
    });
    expect(resolveHubspotOwnerByEmail("missing@example.com", owners).status).toBe("missing");
  });

  it("uses internal values when labels differ", () => {
    const references = [{ label: "Scouted", internalValue: "appointmentscheduled" }];

    expect(
      resolveHubspotInternalValue({ displayOrInternalValue: "Scouted", references }),
    ).toBe("appointmentscheduled");
    expect(
      resolveHubspotInternalValue({
        displayOrInternalValue: "appointmentscheduled",
        references,
      }),
    ).toBe("appointmentscheduled");
  });
});
