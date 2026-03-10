import type { ChannelDetail } from "@scouting-platform/contracts";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  patchAdminChannelManualOverridesMock,
  setDraftsMock,
  setPendingOperationMock,
  setOperationStatusMock,
  useEffectMock,
  useStateMock,
} = vi.hoisted(() => ({
  patchAdminChannelManualOverridesMock: vi.fn(),
  setDraftsMock: vi.fn(),
  setPendingOperationMock: vi.fn(),
  setOperationStatusMock: vi.fn(),
  useEffectMock: vi.fn(),
  useStateMock: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useEffect: useEffectMock,
    useState: useStateMock,
  };
});

vi.mock("../../lib/admin-channels-api", () => ({
  patchAdminChannelManualOverrides: patchAdminChannelManualOverridesMock,
}));

import { AdminChannelManualEditPanel } from "./admin-channel-manual-edit-panel";

type AdminChannelManualEditPanelElement = ReactElement<{
  drafts: {
    title: string;
    handle: string;
    description: string;
    thumbnailUrl: string;
  };
  onSaveField: (field: "title" | "handle" | "description" | "thumbnailUrl") => void | Promise<void>;
  onClearField: (field: "title" | "handle" | "description" | "thumbnailUrl") => void | Promise<void>;
}>;

function createChannelDetail(overrides?: Partial<ChannelDetail>): ChannelDetail {
  return {
    id: "53adac17-f39d-4731-a61f-194150fbc431",
    youtubeChannelId: "UC123",
    title: "Orbital Deep Dive",
    handle: "@orbitaldeepdive",
    description: "Weekly coverage of launch systems and creator strategy.",
    thumbnailUrl: "https://example.com/thumb.jpg",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-08T10:00:00.000Z",
    enrichment: {
      status: "completed",
      updatedAt: "2026-03-08T10:00:00.000Z",
      completedAt: "2026-03-08T10:00:00.000Z",
      lastError: null,
      summary: "Creator focused on launches and industry analysis.",
      topics: ["space", "launches"],
      brandFitNotes: "Strong fit for launch providers.",
      confidence: 0.82,
    },
    advancedReport: {
      requestId: null,
      status: "missing",
      updatedAt: null,
      completedAt: null,
      lastError: null,
      requestedAt: null,
      reviewedAt: null,
      decisionNote: null,
      lastCompletedReport: null,
    },
    insights: {
      audienceCountries: [],
      audienceGenderAge: [],
      audienceInterests: [],
      estimatedPrice: null,
      brandMentions: [],
    },
    ...overrides,
  };
}

function renderPanel(options?: {
  channel?: ChannelDetail;
  drafts?: {
    title: string;
    handle: string;
    description: string;
    thumbnailUrl: string;
  };
}) {
  useStateMock.mockReset();
  useEffectMock.mockReset();
  setDraftsMock.mockReset();
  setPendingOperationMock.mockReset();
  setOperationStatusMock.mockReset();

  useStateMock
    .mockReturnValueOnce([
      options?.drafts ?? {
        title: "Orbital Deep Dive",
        handle: "@orbitaldeepdive",
        description: "Weekly coverage of launch systems and creator strategy.",
        thumbnailUrl: "https://example.com/thumb.jpg",
      },
      setDraftsMock,
    ])
    .mockReturnValueOnce([null, setPendingOperationMock])
    .mockReturnValueOnce([
      {
        type: "idle",
        field: null,
        message: "",
      },
      setOperationStatusMock,
    ]);

  useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
    effect();
  });

  const onChannelUpdated = vi.fn();
  const element = AdminChannelManualEditPanel({
    channel: options?.channel ?? createChannelDetail(),
    onChannelUpdated,
  }) as AdminChannelManualEditPanelElement;

  return {
    element,
    onChannelUpdated,
  };
}

describe("admin channel manual edit panel behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchAdminChannelManualOverridesMock.mockResolvedValue({
      channel: createChannelDetail({
        description: null,
      }),
      applied: [
        {
          field: "description",
          op: "set",
        },
      ],
    });
  });

  it("syncs local drafts from the incoming channel detail", () => {
    renderPanel({
      channel: createChannelDetail({
        title: "Manual title",
        handle: null,
      }),
    });

    expect(setDraftsMock).toHaveBeenCalledWith({
      title: "Manual title",
      handle: "",
      description: "Weekly coverage of launch systems and creator strategy.",
      thumbnailUrl: "https://example.com/thumb.jpg",
    });
  });

  it("saves nullable blank drafts as null manual overrides", async () => {
    const responseChannel = createChannelDetail({
      description: null,
    });
    patchAdminChannelManualOverridesMock.mockResolvedValueOnce({
      channel: responseChannel,
      applied: [
        {
          field: "description",
          op: "set",
        },
      ],
    });

    const { element, onChannelUpdated } = renderPanel({
      drafts: {
        title: "Orbital Deep Dive",
        handle: "@orbitaldeepdive",
        description: "   ",
        thumbnailUrl: "https://example.com/thumb.jpg",
      },
    });

    await element.props.onSaveField("description");

    expect(setPendingOperationMock).toHaveBeenNthCalledWith(1, {
      field: "description",
      op: "set",
    });
    expect(patchAdminChannelManualOverridesMock).toHaveBeenCalledWith(
      "53adac17-f39d-4731-a61f-194150fbc431",
      {
        operations: [
          {
            field: "description",
            op: "set",
            value: null,
          },
        ],
      },
    );
    expect(onChannelUpdated).toHaveBeenCalledWith(responseChannel);
    expect(setDraftsMock).toHaveBeenCalledWith({
      title: "Orbital Deep Dive",
      handle: "@orbitaldeepdive",
      description: "",
      thumbnailUrl: "https://example.com/thumb.jpg",
    });
    expect(setOperationStatusMock).toHaveBeenCalledWith({
      type: "success",
      field: "description",
      message: "Description manual override saved.",
    });
    expect(setPendingOperationMock).toHaveBeenLastCalledWith(null);
  });

  it("rejects blank title overrides before calling the API", async () => {
    const { element } = renderPanel({
      drafts: {
        title: "   ",
        handle: "@orbitaldeepdive",
        description: "Weekly coverage of launch systems and creator strategy.",
        thumbnailUrl: "https://example.com/thumb.jpg",
      },
    });

    await element.props.onSaveField("title");

    expect(patchAdminChannelManualOverridesMock).not.toHaveBeenCalled();
    expect(setOperationStatusMock).toHaveBeenCalledWith({
      type: "error",
      field: "title",
      message: "Title is required.",
    });
    expect(setPendingOperationMock).toHaveBeenLastCalledWith(null);
  });

  it("clears a field override and restores the latest channel detail", async () => {
    const responseChannel = createChannelDetail({
      handle: "@restoredhandle",
    });
    patchAdminChannelManualOverridesMock.mockResolvedValueOnce({
      channel: responseChannel,
      applied: [
        {
          field: "handle",
          op: "clear",
        },
      ],
    });

    const { element, onChannelUpdated } = renderPanel();

    await element.props.onClearField("handle");

    expect(patchAdminChannelManualOverridesMock).toHaveBeenCalledWith(
      "53adac17-f39d-4731-a61f-194150fbc431",
      {
        operations: [
          {
            field: "handle",
            op: "clear",
          },
        ],
      },
    );
    expect(onChannelUpdated).toHaveBeenCalledWith(responseChannel);
    expect(setOperationStatusMock).toHaveBeenCalledWith({
      type: "success",
      field: "handle",
      message: "Handle reverted to the fallback value.",
    });
  });
});
