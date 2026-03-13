import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { csvExportManagerMock } = vi.hoisted(() => ({
  csvExportManagerMock: vi.fn(() => "csv-export-manager"),
}));

vi.mock("../../../components/exports/csv-export-manager", () => ({
  CsvExportManager: csvExportManagerMock,
}));

import ExportsPage from "./page";

describe("exports page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the export manager workspace", () => {
    const html = renderToStaticMarkup(ExportsPage());

    expect(html).toContain("Exports");
    expect(html).toContain(
      "Create filtered CSV exports from catalog criteria and review your export batch history without leaving the authenticated workspace.",
    );
    expect(csvExportManagerMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("csv-export-manager");
  });
});
