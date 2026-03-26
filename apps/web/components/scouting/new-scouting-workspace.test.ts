import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

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
  it("renders the campaign-centric scouting field set", () => {
    const html = renderToStaticMarkup(
      createElement(NewScoutingWorkspaceView, {
        initialCampaignManagers: [
          {
            id: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
            email: "manager@example.com",
            name: "Manager",
          },
        ],
        initialCampaigns: [
          {
            id: "e7b43f40-20f9-4862-9cee-517e3ea3668a",
            name: "Spring Launch 2026",
            client: {
              id: "d12fe8b4-0b1f-49f1-af6e-0e0cc4ce783d",
              name: "Sony",
            },
            market: {
              id: "0f66ea67-411a-4a86-8ed9-d3d9477a5b66",
              name: "Germany",
            },
            briefLink: "https://example.com/brief",
            month: "march",
            year: 2026,
            isActive: true,
            createdAt: "2026-03-26T12:00:00.000Z",
            updatedAt: "2026-03-26T12:00:00.000Z",
          },
        ],
        showLegacyNotice: true,
      }),
    );

    expect(html).toContain("Influencer List");
    expect(html).toContain("Campaign");
    expect(html).toContain("Campaign Manager");
    expect(html).toContain("Target");
    expect(html).toContain("Prompt");
    expect(html).toContain("Legacy route");
    expect(html).toContain('href="/database?tab=campaigns"');
    expect(html).toContain("Start scouting");
    expect(html).not.toContain("Deal owner");
    expect(html).not.toContain("Currency");
  });

  it("keeps the current fields interactive once campaigns and campaign managers are available", () => {
    const tree = createElement(NewScoutingWorkspaceView, {
      initialCampaignManagers: [
        {
          id: "3f5d07e1-2cc4-4b33-a4ed-f95d8f90c7e0",
          email: "manager@example.com",
          name: "Manager",
        },
      ],
      initialCampaigns: [
        {
          id: "e7b43f40-20f9-4862-9cee-517e3ea3668a",
          name: "Spring Launch 2026",
          client: {
            id: "d12fe8b4-0b1f-49f1-af6e-0e0cc4ce783d",
            name: "Sony",
          },
          market: {
            id: "0f66ea67-411a-4a86-8ed9-d3d9477a5b66",
            name: "Germany",
          },
          briefLink: "https://example.com/brief",
          month: "march",
          year: 2026,
          isActive: true,
          createdAt: "2026-03-26T12:00:00.000Z",
          updatedAt: "2026-03-26T12:00:00.000Z",
        },
      ],
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
    expect(textareas[0]?.props.disabled).not.toBe(true);
  });
});
