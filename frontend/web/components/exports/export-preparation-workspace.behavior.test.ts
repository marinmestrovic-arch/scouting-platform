import type { ExportRunToGoogleSheetsRequest, HubspotExportPreview } from "@scouting-platform/contracts";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useMemoMock, useStateMock } = vi.hoisted(() => ({
  useMemoMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useMemo: useMemoMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/export-previews-api", () => ({
  updateHubspotExportPreview: vi.fn(),
}));

vi.mock("../../lib/google-sheets-export-api", () => ({
  exportRunToGoogleSheets: vi.fn(),
}));

import { ExportPreparationWorkspace } from "./export-preparation-workspace";

type InputChangeEvent = {
  currentTarget: { value: string } | null;
};

type InputElement = ReactElement<{
  children?: ReactNode;
  onChange?: (event: InputChangeEvent) => void;
  placeholder?: string;
}>;

function createHubspotPreview(): HubspotExportPreview {
  return {
    run: {
      id: "7c5ca8f3-cd0d-42db-b4db-b863bdc3e821",
      name: "Spring Creator Search",
      campaignName: null,
    },
    columns: [],
    requiredColumnKeys: [],
    defaults: {},
    dropdownOptions: {
      currency: [],
      dealType: [],
      activationType: [],
      influencerType: [],
      influencerVertical: [],
      countryRegion: [],
      language: [],
    },
    rows: [],
    validationIssues: [],
  };
}

function findInputByPlaceholder(element: ReactElement, placeholder: string): InputElement {
  const matches: InputElement[] = [];

  function visit(node: ReactNode): void {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (!node || typeof node !== "object" || !("props" in node)) {
      return;
    }

    const candidate = node as InputElement;

    if (candidate.type === "input" && candidate.props.placeholder === placeholder) {
      matches.push(candidate);
    }

    visit(candidate.props.children);
  }

  visit(element);

  const [input] = matches;

  if (!input) {
    throw new Error(`Could not find input with placeholder: ${placeholder}`);
  }

  return input;
}

describe("export preparation workspace behavior", () => {
  beforeEach(() => {
    useMemoMock.mockReset();
    useMemoMock.mockImplementation((factory: () => unknown) => factory());
    useStateMock.mockReset();
  });

  it("keeps Google Sheets input changes when React runs the state updater after the event is cleared", () => {
    const preview = createHubspotPreview();
    const emptyDrafts = {
      defaults: {
        currency: "",
        dealType: "",
        activationType: "",
        influencerType: "",
        influencerVertical: "",
        countryRegion: "",
        language: "",
      },
      touchedDefaults: new Set(),
      rowValues: {},
      touchedRowFields: {},
    };
    let googleSheetsRequest: ExportRunToGoogleSheetsRequest = {
      spreadsheetIdOrUrl: "",
      sheetName: "",
    };
    let activeEvent: InputChangeEvent | null = null;
    const setGoogleSheetsRequest = vi.fn(
      (
        update:
          | ExportRunToGoogleSheetsRequest
          | ((current: ExportRunToGoogleSheetsRequest) => ExportRunToGoogleSheetsRequest),
      ) => {
        if (activeEvent) {
          activeEvent.currentTarget = null;
        }

        googleSheetsRequest =
          typeof update === "function" ? update(googleSheetsRequest) : update;
      },
    );

    useStateMock
      .mockReturnValueOnce([preview, vi.fn()])
      .mockReturnValueOnce([emptyDrafts, vi.fn()])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()])
      .mockReturnValueOnce([googleSheetsRequest, setGoogleSheetsRequest])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()]);

    const element = ExportPreparationWorkspace({
      mode: "hubspot",
      preview,
    }) as ReactElement;
    const spreadsheetInput = findInputByPlaceholder(
      element,
      "https://docs.google.com/spreadsheets/d/... or spreadsheet id",
    );
    const sheetNameInput = findInputByPlaceholder(element, "Sheet1");

    activeEvent = { currentTarget: { value: "https://docs.google.com/spreadsheets/d/sheet-id" } };
    expect(() => spreadsheetInput.props.onChange?.(activeEvent!)).not.toThrow();
    expect(googleSheetsRequest.spreadsheetIdOrUrl).toBe(
      "https://docs.google.com/spreadsheets/d/sheet-id",
    );

    activeEvent = { currentTarget: { value: "Prepared rows" } };
    expect(() => sheetNameInput.props.onChange?.(activeEvent!)).not.toThrow();
    expect(googleSheetsRequest.sheetName).toBe("Prepared rows");
  });
});
