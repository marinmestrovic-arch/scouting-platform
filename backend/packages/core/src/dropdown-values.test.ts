import { describe, expect, it } from "vitest";

import {
  extractHubspotDropdownOptions,
  getHubspotDropdownSources,
} from "./dropdown-values";

describe("HubSpot dropdown references", () => {
  it("uses configured custom object identifiers instead of portal-specific literals", () => {
    const sources = getHubspotDropdownSources({
      activationObjectType: "2-ACTIVATION",
    });

    expect(sources.activationType).toEqual({
      kind: "property",
      objectType: "2-ACTIVATION",
      propertyName: "activation_type",
    });
  });

  it("preserves a display label that differs from the HubSpot internal value", () => {
    expect(
      extractHubspotDropdownOptions({
        name: "dealstage",
        label: "Deal stage",
        type: "enumeration",
        options: [
          {
            label: "Scouted",
            value: "appointmentscheduled",
          },
        ],
        hasUniqueValue: false,
        archived: false,
      }),
    ).toEqual([
      {
        label: "Scouted",
        internalValue: "appointmentscheduled",
      },
    ]);
  });
});
