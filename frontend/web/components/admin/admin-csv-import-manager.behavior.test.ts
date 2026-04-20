import type {
  CsvImportBatchDetail,
  CsvImportBatchSummary,
} from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  useEffectMock,
  useStateMock,
  fetchAdminCsvImportBatchesMock,
  fetchAdminCsvImportBatchDetailMock,
  createAdminCsvImportBatchMock,
} = vi.hoisted(() => ({
  useEffectMock: vi.fn(),
  useStateMock: vi.fn(),
  fetchAdminCsvImportBatchesMock: vi.fn(),
  fetchAdminCsvImportBatchDetailMock: vi.fn(),
  createAdminCsvImportBatchMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/admin-csv-imports-api", () => ({
  AdminCsvImportsApiError: class AdminCsvImportsApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "AdminCsvImportsApiError";
      this.status = status;
    }
  },
  fetchAdminCsvImportBatches: fetchAdminCsvImportBatchesMock,
  fetchAdminCsvImportBatchDetail: fetchAdminCsvImportBatchDetailMock,
  createAdminCsvImportBatch: createAdminCsvImportBatchMock,
}));

import { AdminCsvImportsApiError } from "../../lib/admin-csv-imports-api";
import {
  ADMIN_CSV_IMPORT_POLL_INTERVAL_MS,
  AdminCsvImportManager,
  AdminCsvImportManagerView,
} from "./admin-csv-import-manager";

type ManagerViewProps = Parameters<typeof AdminCsvImportManagerView>[0];
type ManagerShellElement = ReactElement<ManagerViewProps>;

function buildSummary(overrides?: Partial<CsvImportBatchSummary>): CsvImportBatchSummary {
  return {
    id: "61fb5f09-0f45-4d1d-a87f-fb595b8d1d7d",
    fileName: "contacts.csv",
    templateVersion: "v2",
    status: "queued",
    totalRowCount: 2,
    importedRowCount: 0,
    failedRowCount: 1,
    lastError: null,
    requestedBy: {
      id: "ee8827ee-53df-4eef-aa7b-67218ef25f91",
      email: "admin@example.com",
      name: "Admin",
    },
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function buildDetail(overrides?: Partial<CsvImportBatchDetail>): CsvImportBatchDetail {
  return {
    ...buildSummary(),
    page: 1,
    pageSize: 100,
    rows: [
      {
        id: "afcdbdf7-cbb3-4947-8eef-2ff73b19b0b4",
        rowNumber: 2,
        status: "imported",
        youtubeChannelId: "UC-CSV-1",
        channelTitle: "Imported Creator",
        contactEmail: "creator@example.com",
        firstName: "Imported",
        lastName: "Creator",
        subscriberCount: "1000",
        viewCount: "20000",
        videoCount: "50",
        notes: "Imported from ops sheet",
        sourceLabel: "ops",
        influencerType: "Male",
        influencerVertical: "Gaming",
        countryRegion: "Croatia",
        language: "Croatian",
        channelId: "58f68d7a-c916-4b13-8afa-61845e490463",
        errorMessage: null,
      },
    ],
    ...overrides,
  };
}

function buildFile(name = "contacts.csv"): File {
  return new File(["header\nvalue"], name, {
    type: "text/csv",
  });
}

function createShellState(options?: {
  selectedFile?: File | null;
  fileInputResetToken?: number;
  uploadState?: ManagerViewProps["uploadState"];
  listState?: ManagerViewProps["listState"];
  detailState?: ManagerViewProps["detailState"];
  selectedBatchId?: string | null;
  detailPage?: number;
  listReloadToken?: number;
  detailReloadToken?: number;
  isRefreshingList?: boolean;
  isRefreshingDetail?: boolean;
}) {
  return {
    selectedFile: options?.selectedFile ?? null,
    fileInputResetToken: options?.fileInputResetToken ?? 0,
    uploadState:
      options?.uploadState ??
      {
        type: "idle" as const,
        message: "",
      },
    listState:
      options?.listState ??
      {
        status: "loading" as const,
        items: [],
        error: null,
      },
    detailState:
      options?.detailState ??
      {
        status: "idle" as const,
        data: null,
        error: null,
      },
    selectedBatchId: options?.selectedBatchId ?? null,
    detailPage: options?.detailPage ?? 1,
    listReloadToken: options?.listReloadToken ?? 0,
    detailReloadToken: options?.detailReloadToken ?? 0,
    isRefreshingList: options?.isRefreshingList ?? false,
    isRefreshingDetail: options?.isRefreshingDetail ?? false,
  };
}

function renderShell(options?: Parameters<typeof createShellState>[0] & { runEffects?: boolean }) {
  const state = createShellState(options);
  const setters = {
    setSelectedFile: vi.fn(),
    setFileInputResetToken: vi.fn(),
    setUploadState: vi.fn(),
    setListState: vi.fn(),
    setDetailState: vi.fn(),
    setSelectedBatchId: vi.fn(),
    setDetailPage: vi.fn(),
    setListReloadToken: vi.fn(),
    setDetailReloadToken: vi.fn(),
    setIsRefreshingList: vi.fn(),
    setIsRefreshingDetail: vi.fn(),
  };
  const cleanups: Array<() => void> = [];

  useStateMock.mockReset();
  useEffectMock.mockReset();
  useStateMock
    .mockReturnValueOnce([state.selectedFile, setters.setSelectedFile])
    .mockReturnValueOnce([state.fileInputResetToken, setters.setFileInputResetToken])
    .mockReturnValueOnce([state.uploadState, setters.setUploadState])
    .mockReturnValueOnce([state.listState, setters.setListState])
    .mockReturnValueOnce([state.detailState, setters.setDetailState])
    .mockReturnValueOnce([state.selectedBatchId, setters.setSelectedBatchId])
    .mockReturnValueOnce([state.detailPage, setters.setDetailPage])
    .mockReturnValueOnce([state.listReloadToken, setters.setListReloadToken])
    .mockReturnValueOnce([state.detailReloadToken, setters.setDetailReloadToken])
    .mockReturnValueOnce([state.isRefreshingList, setters.setIsRefreshingList])
    .mockReturnValueOnce([state.isRefreshingDetail, setters.setIsRefreshingDetail]);
  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    if (options?.runEffects === false) {
      return;
    }

    const cleanup = effect();

    if (typeof cleanup === "function") {
      cleanups.push(cleanup);
    }
  });

  const element = AdminCsvImportManager() as ManagerShellElement;

  return {
    cleanups,
    element,
    setters,
  };
}

describe("admin csv import manager behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAdminCsvImportBatchesMock.mockResolvedValue([buildSummary()]);
    fetchAdminCsvImportBatchDetailMock.mockResolvedValue(buildDetail());
    createAdminCsvImportBatchMock.mockResolvedValue(
      buildSummary({
        id: "ff604163-f7a9-4b44-a0d4-d7a0933067b1",
        fileName: "fresh.csv",
        status: "queued",
        totalRowCount: 3,
        failedRowCount: 0,
      }),
    );
  });

  it("loads batches on mount and auto-selects the first batch", async () => {
    const { setters } = renderShell();

    expect(fetchAdminCsvImportBatchesMock).toHaveBeenCalledWith(expect.any(AbortSignal));

    await Promise.resolve();
    await Promise.resolve();

    expect(setters.setListState).toHaveBeenCalledWith({
      status: "ready",
      items: [buildSummary()],
      error: null,
    });
    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(buildSummary().id);
    expect(setters.setDetailPage).toHaveBeenCalledWith(1);
  });

  it("loads detail for the selected batch and current page", async () => {
    const selectedBatchId = buildSummary().id;

    renderShell({
      listState: {
        status: "ready",
        items: [buildSummary()],
        error: null,
      },
      detailState: {
        status: "loading",
        data: null,
        error: null,
      },
      selectedBatchId,
      detailPage: 2,
    });

    expect(fetchAdminCsvImportBatchDetailMock).toHaveBeenCalledWith(
      selectedBatchId,
      { page: 2 },
      expect.any(AbortSignal),
    );
  });

  it("polls only queued or running batches", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
      void handler();
      return 321 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);
    const { cleanups, setters } = renderShell({
      listState: {
        status: "ready",
        items: [buildSummary({ status: "running" })],
        error: null,
      },
      detailState: {
        status: "ready",
        data: buildDetail({ status: "running" }),
        error: null,
      },
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), ADMIN_CSV_IMPORT_POLL_INTERVAL_MS);
    expect(setters.setListReloadToken).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setDetailReloadToken).toHaveBeenCalledWith(expect.any(Function));

    cleanups.forEach((cleanup) => cleanup());
    expect(clearTimeoutSpy).toHaveBeenCalledWith(321);
  });

  it("uploads a batch, resets file input, and refreshes list and detail state", async () => {
    const file = buildFile();
    const createdBatch = buildSummary({
      id: "ff604163-f7a9-4b44-a0d4-d7a0933067b1",
      fileName: "fresh.csv",
      status: "queued",
      totalRowCount: 3,
      failedRowCount: 0,
    });
    createAdminCsvImportBatchMock.mockResolvedValueOnce(createdBatch);
    const { element, setters } = renderShell({
      runEffects: false,
      selectedFile: file,
      listState: {
        status: "ready",
        items: [buildSummary()],
        error: null,
      },
      selectedBatchId: buildSummary().id,
      detailPage: 3,
    });

    await element.props.onUpload();

    expect(createAdminCsvImportBatchMock).toHaveBeenCalledWith(file);
    expect(setters.setUploadState).toHaveBeenNthCalledWith(1, {
      type: "submitting",
      message: "",
    });
    expect(setters.setUploadState).toHaveBeenLastCalledWith({
      type: "success",
      message: "CSV import queued. Row results refresh automatically while processing continues.",
    });
    expect(setters.setSelectedFile).toHaveBeenCalledWith(null);
    expect(setters.setSelectedBatchId).toHaveBeenCalledWith(createdBatch.id);
    expect(setters.setDetailPage).toHaveBeenCalledWith(1);
    expect(setters.setDetailState).toHaveBeenCalledWith({
      status: "loading",
      data: null,
      error: null,
    });
    expect(setters.setFileInputResetToken).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setListReloadToken).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setDetailReloadToken).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setListState).toHaveBeenCalledWith(expect.any(Function));

    const listUpdater = setters.setListState.mock.calls[0]?.[0] as
      | ((value: ManagerViewProps["listState"]) => ManagerViewProps["listState"])
      | undefined;

    expect(
      listUpdater?.({
        status: "ready",
        items: [buildSummary()],
        error: null,
      }),
    ).toEqual({
      status: "ready",
      items: [createdBatch, buildSummary()],
      error: null,
    });
  });

  it("surfaces session-specific upload errors", async () => {
    createAdminCsvImportBatchMock.mockRejectedValueOnce(
      new AdminCsvImportsApiError("Forbidden", 403),
    );
    const { element, setters } = renderShell({
      runEffects: false,
      selectedFile: buildFile(),
    });

    await element.props.onUpload();

    expect(setters.setUploadState).toHaveBeenLastCalledWith({
      type: "error",
      message: "Your session does not allow CSV import uploads anymore. Sign in again and retry.",
    });
  });

  it("validates that a file is selected before uploading", async () => {
    const { element, setters } = renderShell({
      runEffects: false,
      selectedFile: null,
    });

    await element.props.onUpload();

    expect(createAdminCsvImportBatchMock).not.toHaveBeenCalled();
    expect(setters.setUploadState).toHaveBeenCalledWith({
      type: "error",
      message: "Choose a CSV file to import.",
    });
  });

  it("resets page and detail state when selecting a new batch", () => {
    const { element, setters } = renderShell({
      runEffects: false,
      selectedBatchId: buildSummary().id,
      detailPage: 4,
    });

    element.props.onSelectBatch("71af5f56-c1fd-431f-9b06-4e7bfafcaef0");

    expect(setters.setSelectedBatchId).toHaveBeenCalledWith("71af5f56-c1fd-431f-9b06-4e7bfafcaef0");
    expect(setters.setDetailPage).toHaveBeenCalledWith(1);
    expect(setters.setDetailState).toHaveBeenCalledWith({
      status: "loading",
      data: null,
      error: null,
    });
  });

  it("advances pagination only when another page exists", () => {
    const { element, setters } = renderShell({
      runEffects: false,
      detailState: {
        status: "ready",
        data: buildDetail({
          page: 1,
          pageSize: 100,
          totalRowCount: 150,
        }),
        error: null,
      },
    });

    element.props.onNextPage();
    element.props.onPreviousPage();

    expect(setters.setDetailPage).toHaveBeenNthCalledWith(1, expect.any(Function));
    expect(setters.setDetailPage).toHaveBeenNthCalledWith(2, expect.any(Function));

    const nextUpdater = setters.setDetailPage.mock.calls[0]?.[0] as ((value: number) => number) | undefined;
    const previousUpdater = setters.setDetailPage.mock.calls[1]?.[0] as ((value: number) => number) | undefined;

    expect(nextUpdater?.(1)).toBe(2);
    expect(previousUpdater?.(2)).toBe(1);
  });
});
