import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const react = await vi.importActual<typeof import("react")>("react");

  return {
    default: ({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children: ReactNode;
    }) => react.createElement("a", { href, className }, children),
  };
});

import { NewScoutingWorkspaceView } from "./new-scouting-workspace";

function buildDraft() {
  return {
    name: "Gaming run",
    prompt: "gaming creators",
    target: "20",
    client: "Sony",
    market: "DACH",
    campaignManagerUserId: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
    briefLink: "https://example.com/brief",
    campaignName: "Spring Launch 2026",
    month: "march" as const,
    year: "2026",
    dealOwner: "Marin",
    dealName: "Sony Gaming Q2",
    pipeline: "New business",
    dealStage: "Contract sent",
    currency: "EUR",
    dealType: "Paid social",
    activationType: "YouTube integration",
  };
}

function findElementsByType(node: ReactNode, type: string): ReactElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElementsByType(child, type));
  }

  if (!isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<{ children?: ReactNode }>;

  return [
    ...(element.type === type ? [element] : []),
    ...findElementsByType(element.props.children, type),
  ];
}

describe("new scouting workspace", () => {
  it("renders the Week 7 live metadata field set", () => {
    const html = renderToStaticMarkup(
      createElement(NewScoutingWorkspaceView, {
        campaignManagersState: {
          status: "ready",
          items: [
            {
              id: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
              email: "manager@example.com",
              name: "Manager",
            },
          ],
          error: null,
        },
        draft: buildDraft(),
        onFieldChange: () => undefined,
        onSubmit: () => undefined,
        requestState: {
          status: "idle",
          message:
            "This workspace now stores the live campaign metadata required for Dashboard filtering and HubSpot import readiness.",
        },
        showLegacyNotice: true,
      }),
    );

    expect(html).toContain("Influencer List");
    expect(html).toContain("Client");
    expect(html).toContain("Market");
    expect(html).toContain("Campaign manager");
    expect(html).toContain("Brief link");
    expect(html).toContain("Campaign name");
    expect(html).toContain("Month");
    expect(html).toContain("Year");
    expect(html).toContain("Deal owner");
    expect(html).toContain("Deal name");
    expect(html).toContain("Pipeline");
    expect(html).toContain("Deal stage");
    expect(html).toContain("Currency");
    expect(html).toContain("Deal type");
    expect(html).toContain("Activation type");
    expect(html).toContain("Target");
    expect(html).toContain("Prompt");
    expect(html).toContain("Legacy route");
    expect(html).toContain('href="/database?tab=runs"');
    expect(html).toContain("Start scouting");
    expect(html).not.toContain(">Week<");
  });

  it("keeps all fields interactive once campaign managers are loaded", () => {
    const tree = createElement(NewScoutingWorkspaceView, {
      campaignManagersState: {
        status: "ready",
        items: [
          {
            id: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
            email: "manager@example.com",
            name: "Manager",
          },
        ],
        error: null,
      },
      draft: buildDraft(),
      onFieldChange: () => undefined,
      onSubmit: () => undefined,
      requestState: {
        status: "idle",
        message:
          "This workspace now stores the live campaign metadata required for Dashboard filtering and HubSpot import readiness.",
      },
    });
    const rendered = NewScoutingWorkspaceView(tree.props);
    const selects = findElementsByType(rendered, "select") as Array<
      ReactElement<{ disabled?: boolean }>
    >;
    const inputs = findElementsByType(rendered, "input") as Array<
      ReactElement<{ disabled?: boolean }>
    >;
    const textareas = findElementsByType(rendered, "textarea") as Array<
      ReactElement<{ disabled?: boolean }>
    >;

    expect(selects.every((element) => element.props.disabled !== true)).toBe(true);
    expect(inputs.every((element) => element.props.disabled !== true)).toBe(true);
    expect(textareas[0]?.props.disabled).toBe(false);
  });
});
