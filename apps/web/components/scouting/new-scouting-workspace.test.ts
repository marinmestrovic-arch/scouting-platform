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

import {
  buildGeneratedRunName,
  NewScoutingWorkspaceView,
} from "./new-scouting-workspace";

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
  it("builds a readable generated run name from the prompt", () => {
    expect(buildGeneratedRunName("  gaming creators for DACH   ")).toBe(
      "Scouting: gaming creators for DACH",
    );
  });

  it("renders the live prompt field and disabled scaffolded controls", () => {
    const html = renderToStaticMarkup(
      createElement(NewScoutingWorkspaceView, {
        draft: {
          prompt: "gaming creators",
        },
        onPromptChange: () => undefined,
        onSubmit: () => undefined,
        requestState: {
          status: "idle",
          message:
            "Only the prompt is live today. Campaign, week, brief, and targeting controls are scaffolded until the backend stores those fields.",
        },
        showLegacyNotice: true,
      }),
    );

    expect(html).toContain("New scouting");
    expect(html).toContain("Prompt");
    expect(html).toContain("Campaign");
    expect(html).toContain("Source mode");
    expect(html).toContain("Legacy route");
    expect(html).toContain('href="/database?tab=runs"');
    expect(html).toContain("Start scouting");
  });

  it("marks scaffolded fields as disabled while leaving the prompt live", () => {
    const tree = createElement(NewScoutingWorkspaceView, {
      draft: {
        prompt: "gaming creators",
      },
      onPromptChange: () => undefined,
      onSubmit: () => undefined,
      requestState: {
        status: "idle",
        message:
          "Only the prompt is live today. Campaign, week, brief, and targeting controls are scaffolded until the backend stores those fields.",
      },
    });
    const rendered = (tree.type as typeof NewScoutingWorkspaceView)(tree.props);
    const selects = findElementsByType(rendered, "select") as Array<
      ReactElement<{ disabled?: boolean }>
    >;
    const inputs = findElementsByType(rendered, "input") as Array<
      ReactElement<{ disabled?: boolean }>
    >;
    const textareas = findElementsByType(rendered, "textarea") as Array<
      ReactElement<{ disabled?: boolean }>
    >;

    expect(selects.every((element) => element.props.disabled)).toBe(true);
    expect(inputs.every((element) => element.props.disabled)).toBe(true);
    expect(textareas[0]?.props.disabled).toBe(false);
  });
});
