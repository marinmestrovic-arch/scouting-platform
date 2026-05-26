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

type ButtonElement = ReactElement<{
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
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

function findButtonByText(element: ReactElement, text: string): ButtonElement {
  const matches: ButtonElement[] = [];

  function readText(node: ReactNode): string {
    if (typeof node === "string") {
      return node;
    }

    if (Array.isArray(node)) {
      return node.map(readText).join("");
    }

    if (!node || typeof node !== "object" || !("props" in node)) {
      return "";
    }

    return readText((node as ButtonElement).props.children);
  }

  function visit(node: ReactNode): void {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (!node || typeof node !== "object" || !("props" in node)) {
      return;
    }

    const candidate = node as ButtonElement;

    if (candidate.type === "button" && readText(candidate.props.children).trim() === text) {
      matches.push(candidate);
    }

    visit(candidate.props.children);
  }

  visit(element);

  const [button] = matches;

  if (!button) {
    throw new Error(`Could not find button with text: ${text}`);
  }

  return button;
}

function getElementText(element: ReactElement): string {
  function readText(node: ReactNode): string {
    if (typeof node === "string") {
      return node;
    }

    if (Array.isArray(node)) {
      return node.map(readText).join("");
    }

    if (!node || typeof node !== "object" || !("props" in node)) {
      return "";
    }

    return readText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }

  return readText(element);
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

  it("explains that Google Sheets export waits for pending prep changes to be saved", () => {
    const preview = createHubspotPreview();
    const pendingDrafts = {
      defaults: {
        currency: "EUR",
        dealType: "",
        activationType: "",
        influencerType: "",
        influencerVertical: "",
        countryRegion: "",
        language: "",
      },
      touchedDefaults: new Set(["currency"]),
      rowValues: {},
      touchedRowFields: {},
    };

    useStateMock
      .mockReturnValueOnce([preview, vi.fn()])
      .mockReturnValueOnce([pendingDrafts, vi.fn()])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()])
      .mockReturnValueOnce([
        {
          spreadsheetIdOrUrl: "https://docs.google.com/spreadsheets/d/sheet-id",
          sheetName: "Prepared rows",
        },
        vi.fn(),
      ])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()]);

    const element = ExportPreparationWorkspace({
      preview,
    }) as ReactElement;
    const googleSheetsButton = findButtonByText(element, "Export to Google Sheets");

    expect(googleSheetsButton.props.disabled).toBe(true);
    expect(getElementText(element)).toContain(
      "Save your edits before exporting to Google Sheets.",
    );
  });

  it("enables Google Sheets export when the target is filled and prep changes are saved", () => {
    const preview = createHubspotPreview();
    const savedDrafts = {
      defaults: {
        currency: "EUR",
        dealType: "Flat Fee",
        activationType: "YTI (Integration)",
        influencerType: "",
        influencerVertical: "",
        countryRegion: "",
        language: "",
      },
      touchedDefaults: new Set<string>(),
      rowValues: {},
      touchedRowFields: {},
    };

    useStateMock
      .mockReturnValueOnce([preview, vi.fn()])
      .mockReturnValueOnce([savedDrafts, vi.fn()])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()])
      .mockReturnValueOnce([
        {
          spreadsheetIdOrUrl: "https://docs.google.com/spreadsheets/d/sheet-id",
          sheetName: "Prepared rows",
        },
        vi.fn(),
      ])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()]);

    const element = ExportPreparationWorkspace({
      preview,
    }) as ReactElement;
    const googleSheetsButton = findButtonByText(element, "Export to Google Sheets");

    expect(googleSheetsButton.props.disabled).toBe(false);
    expect(getElementText(element)).not.toContain(
      "Save your edits before exporting to Google Sheets.",
    );
  });

  it("renders a CSV Download button left of Save in the run defaults header", () => {
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

    useStateMock
      .mockReturnValueOnce([preview, vi.fn()])
      .mockReturnValueOnce([emptyDrafts, vi.fn()])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()])
      .mockReturnValueOnce([
        { spreadsheetIdOrUrl: "", sheetName: "" },
        vi.fn(),
      ])
      .mockReturnValueOnce(["idle", vi.fn()])
      .mockReturnValueOnce(["", vi.fn()]);

    const element = ExportPreparationWorkspace({
      preview,
    }) as ReactElement;

    const csvButton = findButtonByText(element, "CSV Download");
    const saveButton = findButtonByText(element, "Save");

    expect(csvButton).toBeDefined();
    expect(saveButton).toBeDefined();
  });
});
