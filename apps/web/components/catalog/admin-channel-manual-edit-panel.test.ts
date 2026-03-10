import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminChannelManualEditPanelView } from "./admin-channel-manual-edit-panel";

describe("admin channel manual edit panel view", () => {
  it("renders field editors and manual override actions", () => {
    const html = renderToStaticMarkup(
      createElement(AdminChannelManualEditPanelView, {
        drafts: {
          title: "Orbital Deep Dive",
          handle: "@orbitaldeepdive",
          description: "Weekly coverage of launch systems and creator strategy.",
          thumbnailUrl: "https://example.com/thumb.jpg",
        },
        pendingOperation: null,
        operationStatus: {
          type: "idle" as const,
          field: null,
          message: "",
        },
        onDraftChange: () => {},
        onSaveField: () => {},
        onClearField: () => {},
      }),
    );

    expect(html).toContain("Admin manual edits");
    expect(html).toContain("Save override");
    expect(html).toContain("Restore fallback");
    expect(html).toContain("Leaving Handle, Thumbnail URL, or Description blank and saving");
    expect(html).toContain("textarea");
    expect(html).toContain('value="Orbital Deep Dive"');
    expect(html).toContain('value="@orbitaldeepdive"');
  });

  it("renders field-specific status feedback", () => {
    const html = renderToStaticMarkup(
      createElement(AdminChannelManualEditPanelView, {
        drafts: {
          title: "Orbital Deep Dive",
          handle: "@orbitaldeepdive",
          description: "Weekly coverage of launch systems and creator strategy.",
          thumbnailUrl: "https://example.com/thumb.jpg",
        },
        pendingOperation: null,
        operationStatus: {
          type: "success" as const,
          field: "title" as const,
          message: "Title manual override saved.",
        },
        onDraftChange: () => {},
        onSaveField: () => {},
        onClearField: () => {},
      }),
    );

    expect(html).toContain("Title manual override saved.");
  });
});
